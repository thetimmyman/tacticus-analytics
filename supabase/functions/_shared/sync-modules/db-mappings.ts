import { getErrorMessage } from './helpers.ts'

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]
interface JsonObject {
  [key: string]: JsonValue | undefined
}

export interface LokiMember {
  userId: string
  displayName: string
  role: string
  originalDisplayName?: string
  hasDuplicateName?: boolean
  avatarUnitId?: string
  claimedPowerLevel?: number
  playerPower?: number
}

export interface BossMappings extends Record<string, Record<number, string>> {}

export interface DbMappingsDeps {
  supabase: any
  logger: {
    info: (ctx: string, msg: string) => void
    warn: (ctx: string, msg: string) => void
    error: (ctx: string, msg: string, err?: unknown) => void
  }
}

export interface MembershipSource {
  tacticusMemberIds: string[] | null
  lokiMembers: LokiMember[]
}

const EDGE_DEACTIVATION_SOURCE = 'edge.db-mappings.mark-absent'
const FAIL_CLOSED_OBSERVATION = '1970-01-01T00:00:00.000Z'

function isNonNegativeInteger(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPositiveInteger(value: JsonValue): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function parseDeactivationProof(
  value: JsonValue,
  expected: { guildCode: string; requestedCount: number }
): { observationStale: boolean } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as JsonObject
  const mappingIds = row.deactivated_mapping_ids
  const purgedGuildCodes = row.purged_loki_guild_codes
  const valid =
    row.success === true &&
    row.guild_code === expected.guildCode &&
    row.requested_count === expected.requestedCount &&
    isNonNegativeInteger(row.deactivated_count) &&
    row.deactivated_count <= expected.requestedCount &&
    Array.isArray(mappingIds) &&
    mappingIds.length === row.deactivated_count &&
    mappingIds.every(isPositiveInteger) &&
    new Set(mappingIds).size === mappingIds.length &&
    isNonNegativeInteger(row.revoked_attestations) &&
    isNonNegativeInteger(row.purged_loki_credential_count) &&
    Array.isArray(purgedGuildCodes) &&
    purgedGuildCodes.every(
      (code) =>
        typeof code === 'string' &&
        code.trim() === code &&
        code.length > 0 &&
        code.length <= 64
    ) &&
    new Set(purgedGuildCodes).size === purgedGuildCodes.length &&
    purgedGuildCodes.length === row.purged_loki_credential_count &&
    row.authority_cleared === true &&
    typeof row.observation_stale === 'boolean' &&
    (row.observation_stale === true
      ? row.deactivated_count === 0
      : row.deactivated_count === expected.requestedCount)
  return valid ? { observationStale: row.observation_stale === true } : null
}

async function deactivateExactPlayerSet(
  deps: DbMappingsDeps,
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

  const { data, error } = await deps.supabase.rpc(
    'deactivate_player_mappings_observed',
    {
      p_guild_code: guildCode,
      p_player_ids: exactPlayerIds,
      p_reason: 'roster_deactivation',
      p_source: EDGE_DEACTIVATION_SOURCE,
      p_observed_at: observedAt
    }
  )
  if (error) {
    throw new Error(`Atomic roster deactivation failed: ${error.message}`)
  }
  const proof = parseDeactivationProof(data, {
    guildCode,
    requestedCount: exactPlayerIds.length
  })
  if (!proof) {
    throw new Error('Atomic roster deactivation returned an invalid proof')
  }
  if (proof.observationStale) {
    deps.logger.info(
      guildCode,
      'Skipped roster deactivation because the mapping changed after roster observation'
    )
    return new Set()
  }
  return new Set(exactPlayerIds)
}

export async function getRecentPlayerActivity(
  deps: DbMappingsDeps,
  config: { dataTable: string },
  guildCode: string,
  timeWindowMs = 24 * 60 * 60 * 1000
): Promise<Set<string>> {
  try {
    const cutoffTime = new Date(Date.now() - timeWindowMs).toISOString()
    const { data, error } = await deps.supabase
      .from(config.dataTable)
      .select('userId, completedOn, Season')
      .eq('Guild', guildCode)
      .gte('completedOn', cutoffTime)

    if (error) {
      deps.logger.error(
        guildCode,
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
  } catch (error) {
    deps.logger.error(
      guildCode,
      `Exception fetching activity: ${getErrorMessage(error)}`,
      error
    )
    return new Set()
  }
}

export async function markPlayersNotInGuildAsInactive(
  deps: DbMappingsDeps,
  config: { playerMappingTable: string },
  guildCode: string,
  currentMemberIds: Set<string>,
  source: 'tacticus' | 'loki' = 'loki',
  recentlyActiveIds: Set<string> = new Set(),
  tacticusMemberIds: Set<string> | null = null,
  rosterObservedAt = FAIL_CLOSED_OBSERVATION
): Promise<Set<string>> {
  const { data, error } = await deps.supabase
    .from(config.playerMappingTable)
    .select('player_id')
    .eq('guild_code', guildCode)
    .eq('is_current', true)
    .or('protected.is.null,protected.eq.false')

  if (error) {
    deps.logger.error(
      guildCode,
      `Failed to load active mappings for selective reset: ${error.message}`
    )
    throw new Error(
      `Failed to load active mappings for selective reset: ${error.message}`
    )
  }

  const currentActiveCount = (data || []).length

  if (currentMemberIds.size === 0 && currentActiveCount > 0) {
    deps.logger.warn(
      guildCode,
      `SAFETY: Skipping deactivation - ${source} returned 0 members but ${currentActiveCount} are currently active. This may indicate an API issue.`
    )
    return new Set()
  }

  // Raw candidates, before the presence guard, so the guard cannot weaken the "all leaving" breaker.
  const rawCandidates = (data || [])
    .map((row: { player_id: string | null }) => row.player_id)
    .filter(
      (playerId: string | null): playerId is string =>
        playerId != null &&
        playerId.length > 0 &&
        !currentMemberIds.has(playerId)
    )

  if (rawCandidates.length === 0) {
    return new Set()
  }

  if (rawCandidates.length === currentActiveCount && currentActiveCount > 5) {
    deps.logger.warn(
      guildCode,
      `SAFETY: Skipping deactivation of ALL ${currentActiveCount} members - this likely indicates a ${source} API issue rather than all members leaving`
    )
    return new Set()
  }

  // A stale or partial LOKI snapshot must not deactivate a player seen in recent raids or on the roster.
  const playersToDeactivate = rawCandidates.filter(
    (playerId: string) =>
      !recentlyActiveIds.has(playerId) &&
      !(tacticusMemberIds?.has(playerId) ?? false)
  )
  const sparedCount = rawCandidates.length - playersToDeactivate.length
  if (sparedCount > 0) {
    deps.logger.info(
      guildCode,
      `Deactivation guard spared ${sparedCount} member(s) corroborated by recent activity / Tacticus roster (source: ${source})`
    )
  }

  if (playersToDeactivate.length === 0) {
    return new Set()
  }

  const deactivated = await deactivateExactPlayerSet(
    deps,
    guildCode,
    playersToDeactivate,
    rosterObservedAt
  )
  deps.logger.info(
    guildCode,
    `Atomically revoked authority and deactivated ${deactivated.size} stale guild mappings (source: ${source})`
  )
  return deactivated
}

export interface RosterWriteOutcome {
  /** false when there was nothing to write, so neither leg is recorded. */
  attempted: boolean
  ok: boolean
  rowsWritten: number
  reason?: string
}

/**
 * Records the roster write outcome. Failures are swallowed so raid ingest survives; this counter is
 * what makes a broken write visible. Never throws.
 */
async function recordRosterWriteOutcome(
  deps: DbMappingsDeps,
  guildCode: string,
  outcome: { ok: boolean; rowsWritten?: number; reason?: string }
): Promise<void> {
  try {
    const { error } = await deps.supabase.rpc('record_roster_write_outcome', {
      p_guild_code: guildCode,
      p_ok: outcome.ok,
      p_rows_written: outcome.rowsWritten ?? null,
      p_reason: outcome.reason ?? null
    })
    if (error) {
      deps.logger.error(
        guildCode,
        `Could not record roster write outcome (ok=${outcome.ok}): ${error.message}`
      )
    }
  } catch (error) {
    deps.logger.error(
      guildCode,
      `Could not record roster write outcome (ok=${outcome.ok}): ${getErrorMessage(error)}`,
      error
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

type RosterTransfer = {
  from_guild_code: string
  cluster_code: string | null
  cluster_id: string | null
}

/**
 * Moves claimed players from another guild into this one (and its cluster) when the live Tacticus
 * roster confirms them. Returns the moves; a failed call moves nobody and the players stay blocked.
 */
async function transferRosterConfirmedPlayers(
  deps: DbMappingsDeps,
  guildCode: string,
  candidateIds: string[]
): Promise<Map<string, RosterTransfer>> {
  const moved = new Map<string, RosterTransfer>()
  if (candidateIds.length === 0) return moved
  const { data, error } = await deps.supabase.rpc(
    'transfer_roster_confirmed_players',
    { p_target_guild_code: guildCode, p_player_ids: candidateIds }
  )
  if (error) {
    deps.logger.warn(
      guildCode,
      `Could not move ${candidateIds.length} Tacticus-confirmed claimed players into this guild: ${error.message}`
    )
    return moved
  }
  for (const row of (data as Array<
    { player_id: string } & Partial<RosterTransfer>
  > | null) ?? []) {
    moved.set(row.player_id, {
      from_guild_code: row.from_guild_code ?? '',
      cluster_code: row.cluster_code ?? null,
      cluster_id: row.cluster_id ?? null
    })
  }
  return moved
}

export async function savePlayerMappings(
  deps: DbMappingsDeps,
  config: { playerMappingTable: string; dataTable: string },
  guildCode: string,
  lokiMembers: LokiMember[],
  tacticusMemberIds?: string[] | null,
  rosterObservedAt = FAIL_CLOSED_OBSERVATION
): Promise<RosterWriteOutcome> {
  if (lokiMembers.length === 0) {
    return { attempted: false, ok: true, rowsWritten: 0 }
  }

  try {
    const activePlayerIds = await getRecentPlayerActivity(
      deps,
      { dataTable: config.dataTable },
      guildCode
    )
    deps.logger.info(guildCode, `Found ${activePlayerIds.size} active players`)

    const playerIdsToUpdate = Array.from(
      new Set(
        lokiMembers
          .map((member) => member.userId)
          .filter((id): id is string => Boolean(id))
      )
    )

    // Tacticus-confirmed players LOKI has not listed yet are loaded too, so they can still move.
    const confirmedIds = tacticusConfirmedIds(tacticusMemberIds)

    const { data: existingRecords, error: existingError } = await deps.supabase
      .from(config.playerMappingTable)
      .select(
        'player_id, protected, guild_code, is_current, cluster_code, cluster_id, avatar_unit_id, player_level, player_power, user_id, ownership_attestation_id'
      )
      .in('player_id', [...new Set([...playerIdsToUpdate, ...confirmedIds])])

    if (existingError) {
      deps.logger.error(
        guildCode,
        `Failed to load existing player data: ${existingError.message} — aborting upsert to prevent data loss`
      )
      await recordRosterWriteOutcome(deps, guildCode, {
        ok: false,
        reason: `load existing player data failed: ${existingError.message}`
      })
      return {
        attempted: true,
        ok: false,
        rowsWritten: 0,
        reason: existingError.message
      }
    }

    type ExistingPlayerData = {
      protected: boolean
      guild_code: string
      is_current: boolean
      cluster_code: string | null
      cluster_id: string | null
      avatar_unit_id: string | null
      player_level: number | null
      player_power: number | null
      user_id: string | null
      ownership_attestation_id: string | null
    }

    const existingPlayerData = new Map<string, ExistingPlayerData>(
      ((existingRecords as any[]) || []).map((record) => [
        record.player_id,
        {
          protected: record.protected ?? false,
          guild_code: record.guild_code,
          is_current: record.is_current,
          cluster_code: record.cluster_code,
          cluster_id: record.cluster_id,
          avatar_unit_id: record.avatar_unit_id,
          player_level: record.player_level,
          player_power: record.player_power,
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
    const movedIds = await transferRosterConfirmedPlayers(
      deps,
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
    for (const [playerId, move] of movedIds) {
      const data = existingPlayerData.get(playerId)
      if (data) {
        data.guild_code = guildCode
        data.cluster_code = move.cluster_code
        data.cluster_id = move.cluster_id
      }
      deps.logger.info(
        guildCode,
        `Claimed player ${playerId} moved from ${move.from_guild_code} on the live Tacticus roster`
      )
    }

    const blockedTransferIds = new Set(
      Array.from(existingPlayerData.entries())
        .filter(([, data]) => isClaimedElsewhere(data))
        .map(([playerId]) => playerId)
    )
    if (blockedTransferIds.size > 0) {
      deps.logger.warn(
        guildCode,
        `Skipped ${blockedTransferIds.size} claimed players still mapped to another guild (not confirmed by the live Tacticus roster): ${[...blockedTransferIds].join(', ')}`
      )
    }

    const eligibleMembers = lokiMembers.filter(
      (member) =>
        member.userId &&
        !protectedIds.has(member.userId) &&
        !blockedTransferIds.has(member.userId)
    )

    // is_current follows the authoritative roster: live Tacticus members when present, else eligible LOKI.
    const hasTacticusMemberIds = Boolean(
      tacticusMemberIds && tacticusMemberIds.length > 0
    )
    const tacticusSet = hasTacticusMemberIds
      ? new Set(tacticusMemberIds as string[])
      : null
    const authoritativeMemberIds = hasTacticusMemberIds
      ? new Set(
          (tacticusMemberIds as string[]).filter(
            (id) => !protectedIds.has(id) && !blockedTransferIds.has(id)
          )
        )
      : new Set(eligibleMembers.map((member) => member.userId as string))

    const membershipSource = hasTacticusMemberIds ? 'tacticus' : 'loki'
    deps.logger.info(
      guildCode,
      `Using ${membershipSource} as authoritative source for is_current (${authoritativeMemberIds.size} members)`
    )

    const deactivatedPlayerIds = await markPlayersNotInGuildAsInactive(
      deps,
      { playerMappingTable: config.playerMappingTable },
      guildCode,
      authoritativeMemberIds,
      membershipSource,
      activePlayerIds,
      tacticusSet,
      rosterObservedAt
    )

    // A stale LOKI row can point at a current mapping in another guild; revoke that authority first.
    const additionalDeactivations = new Map<string, string[]>()
    for (const member of eligibleMembers) {
      if (!member.userId || authoritativeMemberIds.has(member.userId)) continue
      const existing = existingPlayerData.get(member.userId)
      if (!existing?.is_current || deactivatedPlayerIds.has(member.userId))
        continue
      const guildTargets =
        additionalDeactivations.get(existing.guild_code) ?? []
      guildTargets.push(member.userId)
      additionalDeactivations.set(existing.guild_code, guildTargets)
    }
    for (const [existingGuildCode, playerIds] of [
      ...additionalDeactivations.entries()
    ].sort(([first], [second]) => first.localeCompare(second))) {
      const additional = await deactivateExactPlayerSet(
        deps,
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
      const isCurrentMember = authoritativeMemberIds.has(playerId)

      if (existingData && existingData.guild_code !== guildCode) {
        transferCount++
        deps.logger.info(
          guildCode,
          `Player ${member.displayName} transferred from ${existingData.guild_code} to ${guildCode}`
        )
      }

      // User and credential columns are OMITTED: PostgREST SETs only present keys, so the upsert cannot
      // resurrect what a transfer or credential-clear removed. Never read-modify-write. Cluster columns are
      // backstopped by trg_preserve_player_cluster_on_sync.
      return {
        player_id: playerId,
        display_name: member.displayName,
        guild_code: guildCode,
        role: isCurrentMember ? member.role : 'member',
        auto_generated: true,
        is_current: isCurrentMember,
        is_active: activePlayerIds.has(playerId),
        has_duplicate_name: member.hasDuplicateName ?? false,
        original_display_name: member.originalDisplayName ?? null,
        updated_at: timestamp,
        avatar_unit_id:
          member.avatarUnitId ?? existingData?.avatar_unit_id ?? null,
        player_level:
          member.claimedPowerLevel ?? existingData?.player_level ?? null,
        player_power:
          typeof member.playerPower === 'number' &&
          Number.isFinite(member.playerPower)
            ? member.playerPower
            : (existingData?.player_power ?? null),
        cluster_code: existingData?.cluster_code ?? null,
        cluster_id: existingData?.cluster_id ?? null
      }
    })

    deps.logger.info(
      guildCode,
      `Attempting upsert of ${records.length} records (eligibleMembers: ${eligibleMembers.length}, lokiMembers input: ${lokiMembers.length})`
    )

    const { error: upsertError, data: upsertData } = await deps.supabase
      .from(config.playerMappingTable)
      .upsert(records, { onConflict: 'player_id' })
      .select('player_id')

    if (upsertError) {
      deps.logger.error(
        guildCode,
        `Failed to save player mappings: ${upsertError.message} | Code: ${upsertError.code} | Details: ${JSON.stringify(upsertError.details)}`
      )
      await recordRosterWriteOutcome(deps, guildCode, {
        ok: false,
        reason: `upsert failed: ${upsertError.message} (${upsertError.code})`
      })
      return {
        attempted: true,
        ok: false,
        rowsWritten: 0,
        reason: upsertError.message
      }
    }

    const currentCount = records.filter((r) => r.is_current).length
    const notCurrentCount = records.length - currentCount
    deps.logger.info(
      guildCode,
      `Saved ${records.length} player mappings (${currentCount} current, ${notCurrentCount} not current, ${transferCount} transfers)`
    )

    // An empty record set is not a successful roster pass: guards (e.g. cross-guild attestation)
    // can filter everything away, and stamping success would hide a broken eligibility filter.
    if (records.length === 0) {
      return { attempted: false, ok: true, rowsWritten: 0 }
    }

    await recordRosterWriteOutcome(deps, guildCode, {
      ok: true,
      rowsWritten: (upsertData as unknown[] | null)?.length ?? records.length
    })
    return { attempted: true, ok: true, rowsWritten: records.length }
  } catch (error) {
    const reason = getErrorMessage(error)
    deps.logger.error(
      guildCode,
      `Exception saving player mappings: ${reason}`,
      error
    )
    await recordRosterWriteOutcome(deps, guildCode, {
      ok: false,
      reason: `exception: ${reason}`
    })
    return { attempted: true, ok: false, rowsWritten: 0, reason }
  }
}

export async function fetchBossMappings(
  deps: DbMappingsDeps,
  config: { bossMappingTable: string }
): Promise<BossMappings> {
  try {
    const { data, error } = await deps.supabase
      .from(config.bossMappingTable)
      .select('boss_type, encounter_index, boss_name')

    if (error) throw error

    const mappings: BossMappings = {}
    for (const row of (data as Array<{
      boss_type: string
      encounter_index: number
      boss_name: string
    }> | null) || []) {
      if (!mappings[row.boss_type]) {
        mappings[row.boss_type] = {}
      }
      mappings[row.boss_type][row.encounter_index] = row.boss_name
    }

    return mappings
  } catch (error) {
    deps.logger.error(
      'SYSTEM',
      `Failed to fetch boss mappings: ${getErrorMessage(error)}`,
      error
    )
    return {}
  }
}
