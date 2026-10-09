import { guildRosterQuery } from '@/app/lib/data/guild-roster'

import type { LokiMember } from '@/app/lib/sync/transformers'
import { normalizeAppRole } from '@/app/lib/sync/transformers'
import {
  logger,
  getErrorMessage,
  type StrictSupabaseClient
} from '@/app/lib/sync/db-operations/shared'
import {
  deactivatePlayerMappings,
  parsePlayerMappingDeactivation
} from '@/app/lib/auth/player-authority-lifecycle'

const APP_DEACTIVATION_SOURCE = 'app.player-mappings.mark-absent'
const FAIL_CLOSED_OBSERVATION = '1970-01-01T00:00:00.000Z'

// record_roster_write_outcome feeds the roster-write failure monitor; a failure to record
// must never throw or otherwise change what the caller sees, matching worker-jobs/player-sync.ts.
async function recordRosterWriteOutcome(
  supabase: StrictSupabaseClient,
  guildCode: string,
  ok: boolean,
  rowsWritten: number,
  reason: string | null
): Promise<void> {
  try {
    const { error } = await supabase.rpc('record_roster_write_outcome', {
      p_guild_code: guildCode,
      p_ok: ok,
      p_rows_written: rowsWritten,
      p_reason: reason
    })
    if (error) {
      logger.error(
        { guildCode, error },
        'Failed to record roster write outcome'
      )
    }
  } catch (error) {
    logger.error(
      { guildCode, error: getErrorMessage(error) },
      'Failed to record roster write outcome'
    )
  }
}

/** Ids the live Tacticus roster lists exactly once; only these can move a claimed player. */
export function tacticusConfirmedIds(
  tacticusMemberIds: string[] | null | undefined
): Set<string> {
  const counts = new Map<string, number>()
  for (const id of tacticusMemberIds ?? []) {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return new Set(
    [...counts.entries()].filter(([, n]) => n === 1).map(([id]) => id)
  )
}

/** Returns player id -> former guild for each claimed player moved in; a failed call moves nobody. */
async function transferRosterConfirmedPlayers(
  supabase: StrictSupabaseClient,
  guildCode: string,
  candidateIds: string[]
): Promise<Map<string, string>> {
  const moved = new Map<string, string>()
  if (candidateIds.length === 0) return moved
  try {
    const { data, error } = await supabase.rpc(
      'transfer_roster_confirmed_players',
      { p_target_guild_code: guildCode, p_player_ids: candidateIds }
    )
    if (error) {
      logger.warn(
        { guildCode, error, candidates: candidateIds.length },
        'Could not move Tacticus-confirmed claimed players into this guild'
      )
      return moved
    }
    for (const row of data ?? []) {
      moved.set(row.player_id, row.from_guild_code)
    }
  } catch (error) {
    logger.warn(
      { guildCode, error: getErrorMessage(error) },
      'Could not move Tacticus-confirmed claimed players into this guild'
    )
  }
  return moved
}

export async function beginGuildRosterObservation(
  supabase: StrictSupabaseClient
): Promise<string> {
  const { data, error } = await supabase.rpc('begin_guild_roster_observation')
  if (error || typeof data !== 'string' || Number.isNaN(Date.parse(data))) {
    logger.warn(
      { error },
      'Could not mint database roster observation; deactivation will fail closed'
    )
    return FAIL_CLOSED_OBSERVATION
  }
  return data
}

async function deactivateExactPlayerSet(
  supabase: StrictSupabaseClient,
  guildCode: string,
  playerIds: readonly string[],
  observedAt: string
): Promise<Set<string>> {
  const exactPlayerIds = [...new Set(playerIds)].sort()
  if (
    exactPlayerIds.length === 0 ||
    exactPlayerIds.length > 500 ||
    exactPlayerIds.some(
      (playerId) =>
        playerId.trim() !== playerId ||
        playerId.length === 0 ||
        playerId.length > 200
    )
  ) {
    throw new Error('Roster deactivation received an invalid exact target set')
  }

  const { data, error } = await deactivatePlayerMappings(
    supabase,
    guildCode,
    exactPlayerIds,
    APP_DEACTIVATION_SOURCE,
    observedAt
  )
  if (error) {
    throw new Error(`Atomic roster deactivation failed: ${error.message}`)
  }
  const proof = parsePlayerMappingDeactivation(data, {
    guildCode,
    requestedCount: exactPlayerIds.length
  })
  if (!proof) {
    throw new Error('Atomic roster deactivation returned an invalid proof')
  }
  if (proof.observationStale) {
    logger.info(
      { guildCode },
      'Skipped roster deactivation because the mapping changed after roster observation'
    )
    return new Set()
  }
  return new Set(exactPlayerIds)
}

export async function getRecentPlayerActivity(
  supabase: StrictSupabaseClient,
  guildCode: string,
  timeWindowMs = 24 * 60 * 60 * 1000
): Promise<Set<string>> {
  try {
    const cutoffTime = new Date(Date.now() - timeWindowMs).toISOString()

    const { data, error } = await supabase
      .from('EOT_GR_data')
      .select('userId, completedOn, Season')
      .eq('Guild', guildCode)
      .gte('completedOn', cutoffTime)
      .order('startedOn', { ascending: false })

    if (error) {
      logger.error(
        { guildCode },
        `Failed to fetch recent activity: ${error.message}`
      )
      return new Set()
    }

    const activePlayerIds = new Set<string>()
    for (const record of data || []) {
      if (record.userId) {
        activePlayerIds.add(record.userId)
      }
    }

    return activePlayerIds
  } catch (error: unknown) {
    logger.error(
      { guildCode },
      `Exception fetching activity: ${getErrorMessage(error)}`
    )
    return new Set()
  }
}

export async function markPlayersNotInGuildAsInactive(
  supabase: StrictSupabaseClient,
  guildCode: string,
  currentMemberIds: Set<string>,
  recentlyActiveIds: Set<string> = new Set(),
  rosterObservedAt = FAIL_CLOSED_OBSERVATION
): Promise<Set<string>> {
  const { data, error } = await guildRosterQuery(
    supabase,
    guildCode,
    'player_id'
  ).or('protected.is.null,protected.eq.false')

  if (error) {
    logger.error(
      { guildCode },
      `Failed to load current mappings for selective reset: ${getErrorMessage(error)}`
    )
    throw new Error(
      `Failed to load current mappings for selective reset: ${getErrorMessage(error)}`
    )
  }

  const currentActiveCount = (data || []).length

  // Pre-guard count, so the recent-activity guard cannot weaken the breaker below.
  const rawCandidates = (data || []).flatMap(
    (row: { player_id: string | null }) => {
      const id = row.player_id
      return id && !currentMemberIds.has(id) ? [id] : []
    }
  )

  if (rawCandidates.length === 0) {
    return new Set()
  }

  // Every member absent means a bad upstream roster: skip deactivation (tiny guilds are exempt).
  if (rawCandidates.length === currentActiveCount && currentActiveCount > 5) {
    logger.warn(
      { guildCode },
      `SAFETY: Skipping deactivation of ALL ${currentActiveCount} members — likely an upstream roster API issue rather than all members leaving`
    )
    return new Set()
  }

  const playerIdsToDeactivate = rawCandidates.filter(
    (id) => !recentlyActiveIds.has(id)
  )
  const sparedCount = rawCandidates.length - playerIdsToDeactivate.length
  if (sparedCount > 0) {
    logger.info(
      { guildCode },
      `Deactivation guard spared ${sparedCount} recently-active member(s)`
    )
  }

  if (playerIdsToDeactivate.length === 0) {
    return new Set()
  }

  const deactivated = await deactivateExactPlayerSet(
    supabase,
    guildCode,
    playerIdsToDeactivate,
    rosterObservedAt
  )
  logger.info(
    { guildCode },
    `Atomically revoked authority and deactivated ${deactivated.size} stale player mappings`
  )
  return deactivated
}

export async function savePlayerMappings(
  supabase: StrictSupabaseClient,
  guildCode: string,
  lokiMembers: LokiMember[],
  tacticusMemberIds?: string[] | null,
  guildCluster?: {
    cluster_code: string | null
    cluster_id: string | null
  } | null,
  rosterObservedAt = FAIL_CLOSED_OBSERVATION,
  /** Live Tacticus member ids used only to confirm moves of claimed players; is_current is unchanged. */
  transferEvidenceIds: string[] | null = null
): Promise<void> {
  if (lokiMembers.length === 0) return

  try {
    const activePlayerIds = await getRecentPlayerActivity(supabase, guildCode)
    logger.info(
      { guildCode, playerCount: activePlayerIds.size },
      'Found active players'
    )

    const playerIdsToUpdate = Array.from(
      new Set(
        lokiMembers
          .map((member) => member.userId)
          .filter((id): id is string => Boolean(id))
      )
    )

    const { data: existingRecords, error: existingError } = await supabase
      .from('player_mapping')
      .select(
        'player_id, protected, guild_code, is_current, cluster_code, cluster_id, user_id, ownership_attestation_id'
      )
      .in('player_id', playerIdsToUpdate)

    if (existingError) {
      logger.error(
        { guildCode },
        `Failed to load existing player data: ${existingError.message} — aborting upsert to prevent data loss`
      )
      await recordRosterWriteOutcome(
        supabase,
        guildCode,
        false,
        0,
        existingError.message
      )
      return
    }

    type ExistingPlayerData = {
      protected: boolean
      guild_code: string
      is_current: boolean
      cluster_code: string | null
      cluster_id: string | null
      user_id: string | null
      ownership_attestation_id: string | null
    }

    const existingPlayerData = new Map<string, ExistingPlayerData>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((existingRecords as any[]) || []).map((record) => [
        record.player_id,
        {
          protected: record.protected ?? false,
          guild_code: record.guild_code,
          is_current: record.is_current,
          cluster_code: record.cluster_code,
          cluster_id: record.cluster_id,
          user_id: record.user_id ?? null,
          ownership_attestation_id: record.ownership_attestation_id ?? null
        }
      ])
    )

    const protectedIds = new Set(
      Array.from(existingPlayerData.entries())
        .filter(([_, data]) => data.protected)
        .map(([playerId]) => playerId)
    )

    // A claimed player moves guilds only on this guild's live Tacticus roster (a player is in one
    // guild at a time); a LOKI row alone never moves one.
    const isClaimedElsewhere = (data: ExistingPlayerData) =>
      data.guild_code !== guildCode &&
      (data.user_id !== null || data.ownership_attestation_id !== null)
    const confirmedIds = tacticusConfirmedIds(
      transferEvidenceIds ?? tacticusMemberIds
    )
    const movedIds = await transferRosterConfirmedPlayers(
      supabase,
      guildCode,
      Array.from(existingPlayerData.entries())
        .filter(
          ([playerId, data]) =>
            confirmedIds.has(playerId) &&
            !data.protected &&
            isClaimedElsewhere(data)
        )
        .map(([playerId]) => playerId)
    )
    for (const [playerId, fromGuildCode] of movedIds) {
      const data = existingPlayerData.get(playerId)
      if (data) data.guild_code = guildCode
      logger.info(
        { guildCode, playerId, previousGuildCode: fromGuildCode },
        'Claimed player moved on the live Tacticus roster'
      )
    }

    const blockedTransferIds = new Set(
      Array.from(existingPlayerData.entries())
        .filter(([, data]) => isClaimedElsewhere(data))
        .map(([playerId]) => playerId)
    )
    if (blockedTransferIds.size > 0) {
      logger.warn(
        { guildCode, playerIds: [...blockedTransferIds] },
        'Skipped claimed players still mapped to another guild (not confirmed by the live Tacticus roster)'
      )
    }

    const eligibleMembers = lokiMembers.filter(
      (member) =>
        member.userId &&
        !protectedIds.has(member.userId) &&
        !blockedTransferIds.has(member.userId)
    )

    const hasTacticusMemberIds =
      tacticusMemberIds && tacticusMemberIds.length > 0
    const authorativeMemberIds = hasTacticusMemberIds
      ? new Set(
          tacticusMemberIds.filter(
            (id) => !protectedIds.has(id) && !blockedTransferIds.has(id)
          )
        )
      : new Set(eligibleMembers.map((member) => member.userId as string))

    const membershipSource = hasTacticusMemberIds ? 'tacticus' : 'loki'
    logger.info(
      { guildCode },
      `Using ${membershipSource} as authoritative source for is_current (${authorativeMemberIds.size} members)`
    )

    const deactivatedPlayerIds = await markPlayersNotInGuildAsInactive(
      supabase,
      guildCode,
      authorativeMemberIds,
      activePlayerIds,
      rosterObservedAt
    )

    // Old-guild authority is revoked atomically before the upsert, not in a separate transaction.
    const additionalDeactivations = new Map<string, string[]>()
    for (const member of eligibleMembers) {
      if (!member.userId || authorativeMemberIds.has(member.userId)) continue
      const existing = existingPlayerData.get(member.userId)
      if (!existing?.is_current || deactivatedPlayerIds.has(member.userId)) {
        continue
      }
      const guildTargets =
        additionalDeactivations.get(existing.guild_code) ?? []
      guildTargets.push(member.userId)
      additionalDeactivations.set(existing.guild_code, guildTargets)
    }
    for (const [existingGuildCode, playerIds] of [
      ...additionalDeactivations.entries()
    ].sort(([first], [second]) => first.localeCompare(second))) {
      const additional = await deactivateExactPlayerSet(
        supabase,
        existingGuildCode,
        playerIds,
        rosterObservedAt
      )
      for (const playerId of additional) deactivatedPlayerIds.add(playerId)
    }

    const timestamp = new Date().toISOString()
    let transferCount = 0

    const records = eligibleMembers.map((member) => {
      const playerId = member.userId as string
      const existingData = existingPlayerData.get(playerId)
      const isCurrentMember = authorativeMemberIds.has(playerId)

      if (existingData && existingData.guild_code !== guildCode) {
        transferCount++
        logger.info(
          {
            playerName: member.displayName,
            guildCode,
            previousGuildCode: existingData.guild_code
          },
          'Player transferred between guilds'
        )
      }

      // User-supplied and credential columns are omitted: PostgREST only SETs present keys, so sync cannot
      // resurrect a cleared credential. trg_preserve_player_cluster_on_sync backstops cluster columns.
      return {
        player_id: playerId,
        display_name: member.displayName,
        guild_code: guildCode,
        role: isCurrentMember
          ? normalizeAppRole(
              typeof member.role === 'string' ? member.role : null
            )
          : 'member',
        auto_generated: true,
        is_current: isCurrentMember,
        is_active: activePlayerIds.has(playerId),
        has_duplicate_name: member.hasDuplicateName || false,
        original_display_name: member.originalDisplayName || null,
        updated_at: timestamp,
        cluster_code:
          guildCluster?.cluster_code ?? existingData?.cluster_code ?? null,
        cluster_id: guildCluster?.cluster_id ?? existingData?.cluster_id ?? null
      }
    })

    // An empty record set is not a roster pass: eligibility guards can filter every member away,
    // and recording success would clear a real prior failure (matches the edge db-mappings path).
    if (records.length === 0) {
      logger.warn(
        { guildCode },
        'No eligible player mappings to save; roster write outcome not recorded'
      )
      return
    }

    const { error: upsertError } = await supabase
      .from('player_mapping')
      .upsert(records as never, {
        onConflict: 'player_id'
      })

    if (!upsertError) {
      const currentCount = records.filter((r) => r.is_current).length
      logger.info(
        { guildCode },
        `Saved ${records.length} player mappings (${currentCount} current, ${transferCount} transfers, source: ${membershipSource})`
      )
      await recordRosterWriteOutcome(
        supabase,
        guildCode,
        true,
        records.length,
        null
      )
    } else {
      logger.error(
        { guildCode },
        `Failed to save player mappings: ${upsertError.message}`
      )
      await recordRosterWriteOutcome(
        supabase,
        guildCode,
        false,
        0,
        upsertError.message
      )
    }
  } catch (error: unknown) {
    logger.error(
      { guildCode },
      `Exception saving player mappings: ${getErrorMessage(error)}`
    )
    await recordRosterWriteOutcome(
      supabase,
      guildCode,
      false,
      0,
      getErrorMessage(error)
    )
  }
}

export async function loadExistingPlayerMappings(
  supabase: StrictSupabaseClient,
  guildCode: string
): Promise<Map<string, string>> {
  const mappings = new Map<string, string>()

  const { data: existingMappings } = await guildRosterQuery(
    supabase,
    guildCode,
    'player_id, display_name'
  )

  for (const mapping of existingMappings || []) {
    if (!mappings.has(mapping.player_id)) {
      mappings.set(mapping.player_id, mapping.display_name)
      mappings.set(mapping.player_id.toLowerCase(), mapping.display_name)
    }
  }

  return mappings
}
