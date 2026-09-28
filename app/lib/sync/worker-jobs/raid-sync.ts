import { createComponentLogger } from '@/app/lib/logging'
import {
  ERASURE_TOMBSTONE_PREFIX,
  isErasureTombstone,
  isUidLikeName,
  synthesizePlayerAlias
} from '@/supabase/functions/_shared/player-name-resolution-core'
import type { GuildConfig } from '@tacticus/app-core/types'
import type { Database as SupabaseDatabase } from '@tacticus/app-core/database.generated'
import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import {
  extractEntries,
  sanitizeRaidEntries,
  processRaidEntry,
  filterProcessedData,
  handleDuplicateDisplayNames,
  type LokiMember,
  type RawRaidEntry,
  type GuildRaidApiResponse
} from '@/app/lib/sync/transformers'
import {
  loadExistingPlayerMappings,
  fetchBossMappings,
  updateBombTracking
} from '@/app/lib/sync/db-operations'
import { fetchTacticusApi } from '../tacticus-api-client'
import {
  runPostSyncHooks,
  refreshGuildRoster,
  checkSeasonCoverage
} from '../post-sync-hooks'
import { runHeraldFromDb } from '@/app/lib/herald/from-db'
import {
  cleanNullString,
  resolveEntryTimestampOrNull,
  resolveSeasonNumber
} from '../worker-utils'
import {
  acquirePipelineAExecutionLock,
  getPipelineAExecutionLockConfig,
  releasePipelineAExecutionLock
} from '../execution-locks'
import { deferSyncJob } from '../sync-job-defer'
import {
  WORKER_CONFIG,
  UPSERT_CONFLICT_KEY,
  type ServiceSupabaseClient,
  type WorkerResult,
  type SyncJob,
  type RaidSyncOptions
} from '../worker-types'
import { collectWrittenIds, reconcileSeasonDelete } from './season-reconcile'

const logger = createComponentLogger('lib.sync.worker-jobs.raid-sync')

const STORED_KEY_PAGE = 1000

function battleKey(row: Record<string, unknown>): string {
  // NULLS DISTINCT: NULL gets its own token instead of collapsing into '' or 0.
  const NULL = '\u0000'
  const text = (v: unknown) => (v == null ? NULL : String(v))
  const num = (v: unknown) => (v == null ? NULL : String(Number(v)))
  const ts = (v: unknown) => {
    if (v == null) return NULL
    const ms = typeof v === 'string' ? Date.parse(v) : NaN
    return Number.isNaN(ms) ? String(v) : String(ms)
  }
  return [
    text(row.Guild),
    text(row.Season),
    text(row.userId),
    num(row.encounterId),
    ts(row.startedOn),
    ts(row.completedOn),
    num(row.damageDealt),
    text(row.damageType)
  ].join('|')
}

/** Stored keys for one guild-season; null (unreadable) means process everything. */
async function loadStoredBattleKeys(
  supabase: ServiceSupabaseClient,
  guildCode: string,
  season: string,
  minCompletedOnMs: number | null
): Promise<Set<string> | null> {
  const keys = new Set<string>()
  try {
    return await readStoredBattleKeys(
      supabase,
      guildCode,
      season,
      minCompletedOnMs,
      keys
    )
  } catch (error) {
    logger.warn(
      { guildCode, error: String(error) },
      'Stored battle keys unavailable; processing full snapshot'
    )
    return null
  }
}

async function readStoredBattleKeys(
  supabase: ServiceSupabaseClient,
  guildCode: string,
  season: string,
  minCompletedOnMs: number | null,
  keys: Set<string>
): Promise<Set<string> | null> {
  let lastId: number | null = null
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('EOT_GR_data')
      .select(`id,${UPSERT_CONFLICT_KEY}`)
      .eq('Guild', guildCode)
      .eq('Season', season)
    // Matching natural keys have completedOn at least the snapshot minimum;
    // the margin absorbs timestamp precision drift.
    if (minCompletedOnMs !== null) {
      query = query.gte(
        'completedOn',
        new Date(minCompletedOnMs - 60 * 60 * 1000).toISOString()
      )
    }
    if (lastId !== null) query = query.gt('id', lastId)
    const { data, error } = await query
      .order('id', { ascending: true })
      .limit(STORED_KEY_PAGE)
    if (error || !Array.isArray(data)) {
      logger.warn(
        { guildCode },
        'Stored battle keys unavailable; processing full snapshot'
      )
      return null
    }
    for (const row of data) keys.add(battleKey(row))
    if (data.length < STORED_KEY_PAGE) return keys
    const pageLastId: unknown = data[data.length - 1]?.id
    // Keyset paging needs a numeric id; anything else falls back to the full snapshot.
    if (typeof pageLastId !== 'number') return null
    lastId = pageLastId
  }
}

export async function runRaidSyncWithOptionalExecutionLock(
  job: SyncJob,
  config: GuildConfig,
  apiKey: string,
  supabase: ServiceSupabaseClient,
  result: WorkerResult,
  workerId: string,
  options: RaidSyncOptions
): Promise<boolean> {
  const lockConfig = getPipelineAExecutionLockConfig()

  if (!lockConfig.enabled) {
    await runRaidSync(job, config, apiKey, supabase, result, options)
    return false
  }

  const lock = await acquirePipelineAExecutionLock(
    supabase,
    lockConfig,
    job.guild_code,
    cleanNullString(config.cluster_code),
    workerId
  )

  if (!lock) {
    await deferSyncJob(job, supabase, workerId, {
      delayMs: 60_000,
      reason: 'execution_lock_unavailable',
      progress: { lock_table: lockConfig.table }
    })
    result.errors.push('execution_lock_unavailable')
    return true
  }

  try {
    await runRaidSync(job, config, apiKey, supabase, result, options)
    return false
  } finally {
    await releasePipelineAExecutionLock(supabase, lockConfig, lock)
  }
}

async function timePhase<T>(
  result: WorkerResult,
  phase: string,
  run: () => Promise<T> | T
): Promise<T> {
  const started = Date.now()
  try {
    return await run()
  } finally {
    result.phaseMs ??= {}
    result.phaseMs[phase] =
      (result.phaseMs[phase] ?? 0) + Math.max(0, Date.now() - started)
  }
}

async function runRaidSync(
  job: SyncJob,
  config: GuildConfig,
  apiKey: string,
  supabase: ServiceSupabaseClient,
  result: WorkerResult,
  options: RaidSyncOptions
) {
  const data = await timePhase(result, 'fetch', async () => {
    const response = await fetchTacticusApi(
      '/guildRaid',
      apiKey,
      job.guild_code
    )
    return (await response.json()) as GuildRaidApiResponse
  })

  const upstreamEntries = extractEntries(data)
  if (!Array.isArray(data.entries) && !Array.isArray(data.body?.entries)) {
    result.errors.push('Raid API response did not contain an entries array')
    logger.warn(
      { guildCode: job.guild_code },
      'Raid API response omitted entries'
    )
    throw new Error('Raid API response did not contain an entries array')
  }
  // Even an empty feed is healthy only if the response identifies its season.
  const currentSeason = resolveSeasonNumber(data)

  // Reject entries without a parseable event time rather than let processRaidEntry synthesize "now".
  let ingestComplete = true
  let missingTimestampCount = 0
  const rawEntries = upstreamEntries.filter((entry) => {
    if (!resolveEntryTimestampOrNull(entry)) {
      missingTimestampCount++
      return false
    }
    return true
  })
  if (missingTimestampCount > 0) {
    ingestComplete = false
    result.errors.push(
      `Raid sync skipped ${missingTimestampCount} entries with invalid timestamps`
    )
  }

  if (rawEntries.length === 0) {
    result.snapshotEntries = 0
    result.newEntries = 0
    result.raidDataLanded = ingestComplete
    logger.info(
      { guildCode: job.guild_code },
      ingestComplete ? 'No entries to sync' : 'No valid entries to sync'
    )
    if (!ingestComplete) {
      throw new Error('Raid sync could not validate every source entry')
    }
    result.syncPath = 'empty'
    await timePhase(result, 'quiet_maintenance', () =>
      runQuietTickMaintenance(job.guild_code, config, supabase)
    )
    return
  }

  const { sanitized: entries, dropped } = sanitizeRaidEntries(
    rawEntries,
    job.guild_code
  )
  if (dropped > 0) {
    result.errors.push(`Sanitization dropped ${dropped} invalid entries`)
    ingestComplete = false
  }
  if (entries.length === 0) {
    logger.info(
      { guildCode: job.guild_code },
      'All entries dropped by sanitization'
    )
    throw new Error('Raid ingest incomplete: all entries failed sanitization')
  }
  result.snapshotEntries = entries.length

  const [playerNameMap, bossMappings] = await timePhase(
    result,
    'mappings',
    () =>
      Promise.all([
        loadExistingPlayerMappings(supabase, job.guild_code),
        fetchBossMappings(supabase)
      ])
  )

  const clusterCode = cleanNullString(config.cluster_code)
  const clusterId = cleanNullString(config.cluster_id)

  // Incremental/realtime write only unstored conflict keys; full_sync writes everything to reconcile.
  let writeEntries = entries
  let allStored = false
  if (!options.deleteBeforeUpsert && entries.length > 0) {
    const keyedEntries = await timePhase(result, 'transform', () =>
      entries.map((entry) => ({
        entry,
        row: processRaidEntry(
          entry,
          job.guild_code,
          String(currentSeason),
          playerNameMap,
          bossMappings,
          clusterCode,
          clusterId
        )
      }))
    )
    const completedOnTimes = keyedEntries.map(({ row }) =>
      row ? Date.parse(String(row.completedOn ?? '')) : NaN
    )
    const minCompletedOnMs = completedOnTimes.every(Number.isFinite)
      ? completedOnTimes.reduce(
          (minimum, completedOn) => Math.min(minimum, completedOn),
          Infinity
        )
      : null
    const stored = await timePhase(result, 'key_read', () =>
      loadStoredBattleKeys(
        supabase,
        job.guild_code,
        String(currentSeason),
        minCompletedOnMs
      )
    )
    if (stored) {
      result.storedKeys = stored.size
      writeEntries = await timePhase(result, 'diff', () =>
        keyedEntries
          .filter(({ row }) => !row || !stored.has(battleKey(row)))
          .map(({ entry }) => entry)
      )
      result.newEntries = writeEntries.length
      allStored = writeEntries.length === 0
    }
  }

  // Quiet guild: skip identity, bombs, hooks and Herald (they make realtime sync
  // several times slower); runQuietTickMaintenance covers what cannot wait.
  if (allStored && ingestComplete) {
    result.syncPath = 'quiet'
    result.raidDataLanded = true
    logger.info({ guildCode: job.guild_code }, 'No new battles to sync')
    await timePhase(result, 'quiet_maintenance', () =>
      runQuietTickMaintenance(job.guild_code, config, supabase)
    )
    return
  }
  result.syncPath = 'write'

  // Resolve identity BEFORE writing raid rows, or string-keyed joins break until
  // the next full sync. Tombstones only fill gaps and their ids are excluded from
  // the mapping write, so erased subjects re-upsert with their tombstone intact.
  const windowPlayerIds = Array.from(
    new Set(
      entries
        .map((entry) => (typeof entry.userId === 'string' ? entry.userId : ''))
        .filter((userId) => userId.length > 0)
    )
  )
  await timePhase(result, 'identity', async () => {
    const erasure = await loadErasureTombstones(
      supabase,
      job.guild_code,
      String(currentSeason),
      windowPlayerIds
    )
    for (const [playerId, tombstone] of erasure.tombstones) {
      if (!playerNameMap.has(playerId)) playerNameMap.set(playerId, tombstone)
      const lowered = playerId.toLowerCase()
      if (!playerNameMap.has(lowered)) playerNameMap.set(lowered, tombstone)
    }
    // Fail closed: unknown erasure status gets the synthesized alias.
    for (const playerId of erasure.withheld) {
      if (playerNameMap.has(playerId)) continue
      const alias = synthesizePlayerAlias(playerId)
      playerNameMap.set(playerId, alias)
      playerNameMap.set(playerId.toLowerCase(), alias)
    }
    const erasedPlayerIds = new Set<string>([
      ...erasure.tombstones.keys(),
      ...erasure.withheld
    ])

    const resolvedNames = await updatePlayerMappings(
      job.guild_code,
      entries,
      supabase,
      result,
      erasedPlayerIds
    )
    for (const [playerId, displayName] of resolvedNames) {
      playerNameMap.set(playerId, displayName)
      playerNameMap.set(playerId.toLowerCase(), displayName)
    }
  })

  const validEntries = filterProcessedData(
    writeEntries.map((entry) =>
      processRaidEntry(
        entry,
        job.guild_code,
        String(currentSeason),
        playerNameMap,
        bossMappings,
        clusterCode,
        clusterId
      )
    ),
    options.strictEntryFilter
  )
  if (validEntries.length !== writeEntries.length) {
    ingestComplete = false
    result.errors.push(
      `Transformation dropped ${writeEntries.length - validEntries.length} entries`
    )
  }

  const writtenIds: number[] = []

  // Only full_sync rewrites existing rows; others insert-or-ignore (an index probe, not a rewrite).
  const skipExistingRows = !options.deleteBeforeUpsert

  await timePhase(result, 'upsert', async () => {
    if (validEntries.length === 0) {
    } else if (
      options.batchedUpsert ||
      validEntries.length > WORKER_CONFIG.batchSize
    ) {
      for (let i = 0; i < validEntries.length; i += WORKER_CONFIG.batchSize) {
        const batch = validEntries.slice(i, i + WORKER_CONFIG.batchSize)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('EOT_GR_data')
          .upsert(batch, {
            onConflict: UPSERT_CONFLICT_KEY,
            ignoreDuplicates: skipExistingRows,
            defaultToNull: false,
            count: 'exact'
          })
          .select('id')
        if (error) {
          result.errors.push(
            `Batch upsert failed (batch ${Math.floor(i / WORKER_CONFIG.batchSize) + 1}): ${error.message}`
          )
          result.upsertFailures++
          ingestComplete = false
        } else {
          const acknowledged = Array.isArray(data) ? data.length : 0
          result.recordsProcessed += acknowledged
          collectWrittenIds(writtenIds, data)
          if (
            skipExistingRows
              ? acknowledged > batch.length
              : acknowledged !== batch.length
          ) {
            result.errors.push(
              `Batch upsert acknowledged ${acknowledged}/${batch.length} records`
            )
            result.upsertFailures++
            ingestComplete = false
          }
        }
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('EOT_GR_data')
        .upsert(validEntries, {
          onConflict: UPSERT_CONFLICT_KEY,
          ignoreDuplicates: skipExistingRows,
          defaultToNull: false,
          count: 'exact'
        })
        .select('id')
      if (error) {
        result.errors.push(`Upsert failed: ${error.message}`)
        result.upsertFailures++
        ingestComplete = false
      } else {
        const acknowledged = Array.isArray(data) ? data.length : 0
        result.recordsProcessed += acknowledged
        collectWrittenIds(writtenIds, data)
        if (
          skipExistingRows
            ? acknowledged > validEntries.length
            : acknowledged !== validEntries.length
        ) {
          result.errors.push(
            `Upsert acknowledged ${acknowledged}/${validEntries.length} records`
          )
          result.upsertFailures++
          ingestComplete = false
        }
      }
    }
  })

  // No reconcile-delete or derived hooks unless every entry transformed and every row was acknowledged.
  if (
    !ingestComplete ||
    (validEntries.length === 0 && !allStored) ||
    (!skipExistingRows && writtenIds.length !== validEntries.length)
  ) {
    result.raidDataLanded = false
    throw new Error(
      `Raid ingest incomplete: ${result.errors.slice(-3).join('; ') || 'write acknowledgement mismatch'}`
    )
  }

  // Never delete rows we failed to replace, and never wipe a season on an empty success.
  if (
    options.deleteBeforeUpsert &&
    ingestComplete &&
    result.upsertFailures === 0 &&
    writtenIds.length > 0
  ) {
    await timePhase(result, 'reconcile', () =>
      reconcileSeasonDelete(
        supabase,
        job.guild_code,
        String(currentSeason),
        writtenIds,
        result
      )
    )
  }

  // Everything below is non-fatal derived bookkeeping.
  result.raidDataLanded =
    ingestComplete &&
    (validEntries.length > 0 || allStored) &&
    (skipExistingRows || writtenIds.length > 0)

  if (result.raidDataLanded && result.recordsProcessed > 0) {
    await stampRaidWrite(supabase, job.guild_code)
  }

  await timePhase(result, 'bombs', () =>
    updateBombTracking(
      supabase,
      entries,
      job.guild_code,
      playerNameMap,
      clusterCode,
      clusterId
    )
  )

  await timePhase(result, 'hooks', () =>
    runPostSyncHooks(job.guild_code, String(currentSeason), config, supabase)
  )

  await timePhase(result, 'herald', () =>
    runHeraldSafely(supabase, job.guild_code)
  )

  if (options.runCoverageCheck) {
    await timePhase(result, 'coverage', () =>
      checkSeasonCoverage(job.guild_code, currentSeason, supabase)
    )
  }
}

/** Quiet ticks refresh the roster/authority at most this often per guild. */
export const QUIET_ROSTER_REFRESH_MS = 60 * 60 * 1000
/** Quiet ticks retry Herald while the last write is at most this old. */
export const QUIET_HERALD_RETRY_MS = 30 * 60 * 1000

// Throttled roster/authority reconciliation plus a dedup-safe Herald retry while the last write is recent.
export async function runQuietTickMaintenance(
  guildCode: string,
  config: GuildConfig,
  supabase: ServiceSupabaseClient,
  now: number = Date.now()
): Promise<void> {
  const row = config as unknown as Record<string, unknown>

  if ('last_roster_refresh_at' in row) {
    const last = Date.parse(String(row.last_roster_refresh_at ?? ''))
    if (!Number.isFinite(last) || now - last >= QUIET_ROSTER_REFRESH_MS) {
      try {
        await refreshGuildRoster(guildCode, config, supabase)
      } catch (err) {
        logger.warn(
          { err, guildCode },
          'Quiet-tick roster refresh failed (non-fatal)'
        )
      }
    }
  }

  if ('last_raid_write_at' in row) {
    const lastWrite = Date.parse(String(row.last_raid_write_at ?? ''))
    if (Number.isFinite(lastWrite) && now - lastWrite < QUIET_HERALD_RETRY_MS) {
      await runHeraldSafely(supabase, guildCode)
    }
  }
}

async function stampRaidWrite(
  supabase: ServiceSupabaseClient,
  guildCode: string
): Promise<void> {
  const { error } = await supabase
    .from('guild_config')
    .update({ last_raid_write_at: new Date().toISOString() })
    .eq('guild_code', guildCode)
  if (error) {
    logger.warn(
      { guildCode, err: error.message },
      'Could not stamp last_raid_write_at (non-fatal)'
    )
  }
}

// Reads EOT_GR_data post-upsert so names are mapping-resolved, never raw privacy aliases.
async function runHeraldSafely(
  supabase: ServiceSupabaseClient,
  guildCode: string
): Promise<void> {
  try {
    const heraldResult = await runHeraldFromDb({
      supabase,
      guildCode: guildCode
    })
    if (
      heraldResult.detected > 0 ||
      heraldResult.availability_detected > 0 ||
      heraldResult.skipped_reason
    ) {
      logger.info(
        {
          guildCode: guildCode,
          defeatsDetected: heraldResult.detected,
          defeatsPosted: heraldResult.posted,
          availabilityDetected: heraldResult.availability_detected,
          availabilityPosted: heraldResult.availability_posted,
          deduped: heraldResult.deduped + heraldResult.availability_deduped,
          failed: heraldResult.failed + heraldResult.availability_failed,
          skippedReason: heraldResult.skipped_reason
        },
        'Herald post-sync result'
      )
    }
  } catch (heraldErr) {
    logger.warn(
      {
        guildCode: guildCode,
        error:
          heraldErr instanceof Error ? heraldErr.message : String(heraldErr)
      },
      'Herald crashed during post-sync processing (non-fatal)'
    )
  }
}

/** `.in()` lists go in the URL; chunking keeps large rosters under proxy limits. */
const MAPPING_ID_CHUNK_SIZE = 200

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += MAPPING_ID_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + MAPPING_ID_CHUNK_SIZE))
  }
  return chunks
}

type PlayerMappingInsert =
  SupabaseDatabase['public']['Tables']['player_mapping']['Insert']
type PlayerMappingUpdate =
  SupabaseDatabase['public']['Tables']['player_mapping']['Update']

type ExistingMappingRow = {
  player_id: string
  display_name: string | null
  original_display_name: string | null
  has_duplicate_name: boolean | null
  /** The read failed: treat the row as existing and untouchable (fail closed). */
  unreadable: boolean
}

// Both suppress name promotion; only `tombstones` holds values safe to write
// back (`withheld` = erasure status unreadable).
type ErasureTombstoneLookup = {
  tombstones: Map<string, string>
  withheld: Set<string>
}

// Article 17 tombstones that must survive this run. player_mapping is read without guild/is_current
// filters on purpose: erasure deactivates the row, and hiding it would let an upstream username
// overwrite the tombstone. Battle rows cover subjects whose mapping row was removed.
async function loadErasureTombstones(
  supabase: ServiceSupabaseClient,
  guildCode: string,
  season: string,
  playerIds: string[]
): Promise<ErasureTombstoneLookup> {
  const tombstones = new Map<string, string>()
  const withheld = new Set<string>()
  if (playerIds.length === 0) return { tombstones, withheld }

  // Coarse LIKE filter (`_` is a wildcard); isErasureTombstone decides exactly.
  const pattern = `${ERASURE_TOMBSTONE_PREFIX}%`

  for (const ids of chunkIds(playerIds)) {
    const { data: mappingRows, error: mappingError } = await supabase
      .from('player_mapping')
      .select('player_id, display_name')
      .like('display_name', pattern)
      .in('player_id', ids)
    if (mappingError) {
      // Fail closed: no name promotion without proof the subject is not erased.
      for (const id of ids) withheld.add(id)
      logger.warn(
        { guildCode, error: mappingError.message },
        'Could not read mapping tombstones; withholding name promotion for this chunk'
      )
      continue
    }
    for (const row of mappingRows ?? []) {
      if (row?.player_id && isErasureTombstone(row.display_name)) {
        tombstones.set(row.player_id, row.display_name)
      }
    }

    const { data: battleRows } = await supabase
      .from('EOT_GR_data')
      .select('userId, displayName')
      .eq('Guild', guildCode)
      .eq('Season', season)
      .like('displayName', pattern)
      .in('userId', ids)
    for (const row of battleRows ?? []) {
      const rowUserId = typeof row?.userId === 'string' ? row.userId : ''
      if (
        rowUserId &&
        isErasureTombstone(row.displayName) &&
        !tombstones.has(rowUserId)
      ) {
        tombstones.set(rowUserId, row.displayName)
      }
    }
  }

  return { tombstones, withheld }
}

// Reads across guilds on purpose: a transferred member's row lives under the
// new guild_code, and any existing row means only the name may change.
async function loadMappingRowsByPlayerId(
  supabase: ServiceSupabaseClient,
  playerIds: string[]
): Promise<Map<string, ExistingMappingRow>> {
  const rows = new Map<string, ExistingMappingRow>()
  for (const ids of chunkIds(playerIds)) {
    const { data, error } = await supabase
      .from('player_mapping')
      .select(
        'player_id, display_name, original_display_name, has_duplicate_name'
      )
      .in('player_id', ids)
    if (error) {
      // Fail closed: treat as existing so membership is never asserted unchecked.
      for (const id of ids) {
        rows.set(id, {
          player_id: id,
          display_name: null,
          original_display_name: null,
          has_duplicate_name: null,
          unreadable: true
        })
      }
      continue
    }
    for (const row of data ?? []) {
      if (row?.player_id) {
        rows.set(row.player_id, {
          player_id: row.player_id,
          display_name: row.display_name ?? null,
          original_display_name: row.original_display_name ?? null,
          has_duplicate_name: row.has_duplicate_name ?? null,
          unreadable: false
        })
      }
    }
  }
  return rows
}

async function loadDuplicateNameCohort(
  supabase: ServiceSupabaseClient,
  guildCode: string
): Promise<LokiMember[]> {
  const { data } = await guildRosterQuery<{
    player_id: string
    display_name: string | null
    original_display_name: string | null
  }>(supabase, guildCode, 'player_id, display_name, original_display_name')
  const cohort: LokiMember[] = []
  for (const row of data ?? []) {
    const base = row.original_display_name ?? row.display_name
    if (row.player_id && base) {
      cohort.push({ userId: row.player_id, displayName: base, role: 'member' })
    }
  }
  return cohort
}

// Raid entries are history, not a roster. RULE 2: the duplicate cohort is roster ∪ window and
// suffixes are never cleared. RULE 3: existing rows get name fields only (no guild reclaim).
// RULE 4: erased subjects are never written. Returns resolved names for the window.
export async function updatePlayerMappings(
  guildCode: string,
  entries: RawRaidEntry[],
  supabase: ServiceSupabaseClient,
  result: WorkerResult,
  erasedPlayerIds: ReadonlySet<string> = new Set<string>()
): Promise<Map<string, string>> {
  const resolvedNames = new Map<string, string>()
  const playerMap = new Map<string, string>()

  entries.forEach((entry) => {
    const userId = typeof entry.userId === 'string' ? entry.userId : ''
    const rawUsername =
      typeof entry.username === 'string'
        ? entry.username
        : typeof entry.displayName === 'string'
          ? entry.displayName
          : ''
    if (!userId || erasedPlayerIds.has(userId)) return
    // Never store a `Player#XXXXXX` privacy alias or tombstone as a real name.
    if (
      rawUsername &&
      !isUidLikeName(rawUsername) &&
      !isErasureTombstone(rawUsername)
    ) {
      playerMap.set(userId, rawUsername)
    }
  })

  if (playerMap.size === 0) return resolvedNames

  const windowIds = Array.from(playerMap.keys())
  const [existingRows, rosterCohort] = await Promise.all([
    loadMappingRowsByPlayerId(supabase, windowIds),
    loadDuplicateNameCohort(supabase, guildCode)
  ])

  // RULE 2: roster members outside the window join the cohort only for collisions; nothing is written.
  const cohort: LokiMember[] = rosterCohort.filter(
    (member) => !playerMap.has(member.userId)
  )
  for (const [userId, displayName] of playerMap) {
    cohort.push({ userId, displayName, role: 'member' })
  }

  const dedupedMembers = handleDuplicateDisplayNames(cohort, guildCode)

  const now = new Date().toISOString()
  const newMappings: PlayerMappingInsert[] = []
  const nameUpdates: Array<{
    playerId: string
    payload: PlayerMappingUpdate
  }> = []

  for (const member of dedupedMembers) {
    if (!playerMap.has(member.userId)) continue

    const displayName = member.displayName
    const hasDuplicateName = member.hasDuplicateName === true
    const originalDisplayName = hasDuplicateName
      ? (member.originalDisplayName ?? null)
      : null
    const existing = existingRows.get(member.userId)

    if (existing) {
      // RULE 4, fail closed: tombstoned or unreadable rows are never renamed.
      if (existing.unreadable || isErasureTombstone(existing.display_name)) {
        if (existing.display_name) {
          resolvedNames.set(member.userId, existing.display_name)
        }
        continue
      }
      // RULE 2: raid history never un-suffixes a duplicate-labelled member.
      if (existing.has_duplicate_name === true && !hasDuplicateName) {
        if (existing.display_name) {
          resolvedNames.set(member.userId, existing.display_name)
        }
        continue
      }
      resolvedNames.set(member.userId, displayName)
      if (
        existing.display_name === displayName &&
        (existing.has_duplicate_name === true) === hasDuplicateName &&
        (existing.original_display_name ?? null) === originalDisplayName
      ) {
        continue
      }
      // RULE 3: name fields ONLY. No guild_code, no is_current, no role.
      nameUpdates.push({
        playerId: member.userId,
        payload: {
          display_name: displayName,
          original_display_name: originalDisplayName,
          has_duplicate_name: hasDuplicateName,
          updated_at: now
        }
      })
      continue
    }

    // No row anywhere: the only case that may assert membership.
    resolvedNames.set(member.userId, displayName)
    newMappings.push({
      player_id: member.userId,
      display_name: displayName,
      original_display_name: originalDisplayName,
      has_duplicate_name: hasDuplicateName,
      guild_code: guildCode,
      is_current: true,
      updated_at: now
    })
  }

  if (newMappings.length > 0) {
    const { error } = await supabase
      .from('player_mapping')
      .upsert(newMappings, {
        onConflict: 'player_id',
        ignoreDuplicates: false
      })

    if (!error) {
      result.playersUpdated += newMappings.length
    }
  }

  // UPDATE, not upsert: an upsert would write column defaults over existing membership (RULE 3).
  for (const update of nameUpdates) {
    const { error } = await supabase
      .from('player_mapping')
      .update(update.payload)
      .eq('player_id', update.playerId)
    if (!error) {
      result.playersUpdated += 1
    }
  }

  return resolvedNames
}
