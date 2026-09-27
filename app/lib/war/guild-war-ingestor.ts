// Writes the SAME rows as the sync edge function. Deterministic ids update in place; participation
// is an ingestion-time snapshot, so a roster re-import appends.

import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { Database, Json } from '@tacticus/app-core/database.generated'
import {
  generateDeterministicId,
  buildLineupId,
  computePerfectHit,
  computeFailedHit,
  computeBattleDurationSeconds,
  extractGuildTagFromPlayerName,
  looksLikeSelfOpponent,
  isNonEmptyString,
  isUuid,
  type LokiWarData,
  type BattleSideSummary,
  type GuildWarStatusMember,
  type GuildWarStatusResponse
} from './guild-war-parser'
import type { TablesUpdate } from '@tacticus/app-core/database.generated'

type GuildWarBattleInsert =
  Database['public']['Tables']['guild_war_battles']['Insert']
type GuildWarLineupInsert =
  Database['public']['Tables']['guild_war_lineups']['Insert']

const DEFAULT_GUILD_WAR_ATTEMPTS = 10

export interface IngestGuildContext {
  guildCode: string
  guildName: string
}

export interface WarIngestCounts {
  wars: number
  zones: number
  attempts: number
  battles: number
  lineups: number
  participation: number
}

export interface WarIngestResult extends WarIngestCounts {
  errors: string[]
  /** Status members were supplied but no war could anchor them (an operator input problem). */
  noWarToAttachMembers: boolean
}

/** Maps raw driver text (constraint names, SQLSTATE) to a user-safe outcome; `errors` must never
 * reach a response body. */
export function sanitizeIngestError(rawMessage: string): string {
  const lower = rawMessage.toLowerCase()
  if (lower.includes('unique constraint') || lower.includes('duplicate key')) {
    return 'duplicate row'
  }
  if (lower.includes('foreign key constraint')) {
    return 'referenced record missing'
  }
  if (
    lower.includes('check constraint') ||
    lower.includes('not-null constraint') ||
    lower.includes('null value in column')
  ) {
    return 'invalid value'
  }
  return 'row rejected'
}

/** Null unless every unit's survival was observed; a false `0` would let computePerfectHit mark any win perfect. */
const observedUnitsLost = (
  side: BattleSideSummary | null | undefined
): number | null => {
  if (!side || typeof side.unitsLost !== 'number') return null
  if (!Array.isArray(side.units) || side.units.length === 0) return null
  if (typeof side.unitsUnknown === 'number' && side.unitsUnknown > 0) {
    return null
  }
  return side.unitsLost
}

const queueLineup = (
  lineupCache: Map<string, GuildWarLineupInsert>,
  lineupId: string | null,
  units: unknown[] | null,
  machineOfWar: unknown | null,
  updatedAt: string
): void => {
  if (!lineupId || !Array.isArray(units)) return

  const hasMachine = machineOfWar !== null && machineOfWar !== undefined
  const existing = lineupCache.get(lineupId)

  if (!existing) {
    lineupCache.set(lineupId, {
      lineup_id: lineupId,
      units_json: units as Json,
      machine_of_war: (hasMachine ? machineOfWar : null) as Json | null,
      hash_version: 1,
      updated_at: updatedAt
    })
    return
  }

  if (hasMachine && !existing.machine_of_war) {
    existing.machine_of_war = machineOfWar as Json
    existing.updated_at = updatedAt
    lineupCache.set(lineupId, existing)
  }
}

async function ingestWar(
  supabase: TypedSupabaseClient,
  war: LokiWarData,
  ctx: IngestGuildContext,
  counts: WarIngestCounts,
  errors: string[]
): Promise<void> {
  const opponentNameRaw = isNonEmptyString(war.opponentGuildName)
    ? war.opponentGuildName.trim()
    : ''
  const opponentIsUnknown =
    !isNonEmptyString(opponentNameRaw) ||
    looksLikeSelfOpponent(opponentNameRaw, ctx.guildName, ctx.guildCode)
  const opponentGuildName = opponentIsUnknown
    ? 'Unknown Opponent'
    : opponentNameRaw
  const opponentGuildNameSource = opponentIsUnknown ? 'fallback' : 'loki'
  const opponentGuildId = isNonEmptyString(war.opponentGuildCode)
    ? war.opponentGuildCode
    : null
  const opponentGuildTag = opponentIsUnknown
    ? null
    : extractGuildTagFromPlayerName(opponentGuildName)

  const lineupsToUpsert = new Map<string, GuildWarLineupInsert>()
  const battleUpserts: GuildWarBattleInsert[] = []

  const rawLokiMeta: Record<string, unknown> = {}
  if (typeof war.warNumber === 'number') rawLokiMeta.warNumber = war.warNumber
  if (typeof war.season === 'number') rawLokiMeta.season = war.season
  if (typeof war.lastGuildWarEventId === 'number')
    rawLokiMeta.lastGuildWarEventId = war.lastGuildWarEventId

  const now = new Date().toISOString()

  const { error: warError } = await supabase.from('guild_war_matches').upsert(
    {
      war_id: war.warId,
      guild_code: war.guildCode,
      opponent_guild_code: opponentGuildTag,
      opponent_guild_id: opponentGuildId,
      opponent_guild_name: opponentGuildName,
      opponent_is_unknown: opponentIsUnknown,
      opponent_guild_name_source: opponentGuildNameSource,
      war_status: war.status,
      war_result: war.result ?? null,
      guild_score: war.guildScore,
      opponent_score: war.opponentScore,
      war_start_date: war.startDate ?? null,
      war_end_date: war.endDate ?? null,
      war_season: war.season,
      battlefield_level: war.battlefieldLevel ?? null,
      raw_loki_data:
        Object.keys(rawLokiMeta).length > 0 ? (rawLokiMeta as Json) : null,
      updated_at: now
    },
    { onConflict: 'war_id,guild_code' }
  )

  if (warError) {
    errors.push(`war ${war.warId}: ${warError.message}`)
    return
  }
  counts.wars++

  for (const zone of war.zones ?? []) {
    const { data: zoneData, error: zoneError } = await supabase
      .from('guild_war_zones')
      .upsert(
        {
          war_id: war.warId,
          guild_code: war.guildCode,
          zone_number: zone.zoneNumber,
          zone_name: zone.zoneName ?? null,
          zone_type: zone.zoneType,
          zone_status: zone.status,
          assigned_players: zone.assignedPlayers,
          updated_at: now
        },
        { onConflict: 'war_id,guild_code,zone_number' }
      )
      .select('id')
      .single()

    if (zoneError || !zoneData) {
      errors.push(
        `zone ${zone.zoneNumber} (war ${war.warId}): ${zoneError?.message ?? 'no id returned'}`
      )
      continue
    }
    counts.zones++

    for (const attempt of zone.attempts ?? []) {
      const attemptId =
        isNonEmptyString(attempt.id) && isUuid(attempt.id)
          ? attempt.id
          : await generateDeterministicId(
              `${war.warId}-${zone.zoneNumber}-${attempt.playerId}-${attempt.attemptNumber}`
            )
      const eventId =
        isNonEmptyString(attempt.id) && isUuid(attempt.id)
          ? attempt.id
          : isNonEmptyString(attempt.id)
            ? await generateDeterministicId(`${war.warId}-${attempt.id}`)
            : attemptId

      const battlePayload = attempt.battlePayload
      const battleSummary = battlePayload?.battleSummary ?? null
      const attackerUnits = Array.isArray(battlePayload?.log?.attacker?.units)
        ? (battlePayload?.log?.attacker?.units ?? [])
        : Array.isArray(attempt.unitsUsed)
          ? attempt.unitsUsed
          : null
      const defenderUnits = Array.isArray(battlePayload?.log?.defender?.units)
        ? (battlePayload?.log?.defender?.units ?? [])
        : null
      const attackerUnitsLost = observedUnitsLost(battleSummary?.attacker)
      const defenderUnitsLost = observedUnitsLost(battleSummary?.defender)
      const perfectHit = computePerfectHit(attackerUnitsLost, attempt.result)
      const failedHit = computeFailedHit(attempt.result, attempt.scoreEarned)
      const battleDuration = computeBattleDurationSeconds(
        attempt.startTime,
        attempt.endTime
      )
      const attackerIsGuildMember = attempt.isGuildMember ?? true
      const attackerGuildName = attackerIsGuildMember
        ? ctx.guildName
        : opponentGuildName
      const defenderGuildName = attackerIsGuildMember
        ? opponentGuildName
        : ctx.guildName
      const attackerPlayerName = isNonEmptyString(attempt.playerName)
        ? attempt.playerName
        : (battleSummary?.attacker?.displayName ?? null)
      const defenderPlayerId =
        battleSummary?.defender?.userId ??
        battlePayload?.log?.defender?.userId ??
        null
      const defenderPlayerName =
        battleSummary?.defender?.displayName ??
        battlePayload?.log?.defender?.displayName ??
        null
      const buffs = Array.isArray(battleSummary?.buffs)
        ? (battleSummary?.buffs ?? [])
        : Array.isArray(battlePayload?.log?.buffs)
          ? (battlePayload?.log?.buffs ?? [])
          : null
      const attackerMachine = battleSummary?.attacker?.machineOfWar ?? null
      const defenderMachine =
        battleSummary?.defender?.machineOfWar ??
        battlePayload?.log?.defender?.machineOfWar ??
        null
      const attackerLineupId = buildLineupId(attackerUnits, attackerMachine)
      const defenderLineupId = buildLineupId(defenderUnits, defenderMachine)

      // No `id`: the Loki log id is shared by BOTH guilds of a tracked-vs-tracked war, so ON CONFLICT (id)
      // would steal the other guild's rows. Identity is (war_id, guild_code, event_id).
      battleUpserts.push({
        war_id: war.warId,
        zone_id: zoneData.id,
        guild_code: war.guildCode,
        event_id: eventId,
        attacker_player_id: attempt.playerId,
        attacker_player_name: attackerPlayerName,
        defender_player_id: defenderPlayerId,
        defender_player_name: defenderPlayerName,
        attacker_guild_name: attackerGuildName,
        defender_guild_name: defenderGuildName,
        is_guild_member: attackerIsGuildMember,
        attacker_team_index: attempt.teamIndex ?? null,
        attempt_number: attempt.attemptNumber,
        attempt_status: attempt.status,
        attempt_result: attempt.result ?? null,
        damage_dealt: attempt.damageDealt ?? 0,
        score_earned: attempt.scoreEarned ?? 0,
        attempt_debuff: attempt.attemptDebuff ?? null,
        units_used: (Array.isArray(attempt.unitsUsed)
          ? attempt.unitsUsed
          : null) as Json | null,
        attacker_units_json: attackerUnits as Json | null,
        defender_units_json: defenderUnits as Json | null,
        battle_summary: battleSummary as Json | null,
        buffs: buffs as Json | null,
        attempt_start_time: attempt.startTime ?? null,
        attempt_end_time: attempt.endTime ?? null,
        battle_duration: battleDuration,
        zone_type: zone.zoneType,
        attacker_lineup_id: attackerLineupId,
        defender_lineup_id: defenderLineupId,
        kill_count: defenderUnitsLost,
        attacker_units_lost: attackerUnitsLost,
        defender_units_lost: defenderUnitsLost,
        perfect_hit: perfectHit,
        failed_hit: failedHit,
        updated_at: now
      })

      queueLineup(
        lineupsToUpsert,
        attackerLineupId,
        attackerUnits,
        attackerMachine,
        now
      )
      queueLineup(
        lineupsToUpsert,
        defenderLineupId,
        defenderUnits,
        defenderMachine,
        now
      )

      const { error: attemptError } = await supabase
        .from('guild_war_player_attempts')
        .upsert(
          {
            // Natural key, not the shared Loki id (see battles above).
            event_id: attemptId,
            war_id: war.warId,
            zone_id: zoneData.id,
            guild_code: war.guildCode,
            is_guild_member: attackerIsGuildMember,
            attacker_team_index: attempt.teamIndex ?? null,
            attacker_guild_name: attackerGuildName,
            defender_guild_name: defenderGuildName,
            player_id: attempt.playerId,
            player_name: attempt.playerName,
            defender_player_id: defenderPlayerId,
            defender_player_name: defenderPlayerName,
            attempt_number: attempt.attemptNumber,
            attempt_status: attempt.status,
            attempt_result: attempt.result ?? null,
            damage_dealt: attempt.damageDealt ?? 0,
            score_earned: attempt.scoreEarned ?? 0,
            units_used: (Array.isArray(attempt.unitsUsed)
              ? attempt.unitsUsed
              : null) as Json | null,
            attacker_units_json: attackerUnits as Json | null,
            defender_units_json: defenderUnits as Json | null,
            attempt_debuff: attempt.attemptDebuff ?? null,
            attempt_start_time: attempt.startTime ?? null,
            attempt_end_time: attempt.endTime ?? null,
            battle_duration: battleDuration,
            updated_at: now
          },
          { onConflict: 'war_id,guild_code,event_id' }
        )

      if (attemptError) {
        errors.push(
          `attempt ${attempt.playerId} (war ${war.warId}): ${attemptError.message}`
        )
        continue
      }
      counts.attempts++
    }
  }

  if (lineupsToUpsert.size > 0) {
    const { error: lineupError } = await supabase
      .from('guild_war_lineups')
      .upsert(Array.from(lineupsToUpsert.values()), { onConflict: 'lineup_id' })
    if (lineupError) {
      errors.push(`lineups (war ${war.warId}): ${lineupError.message}`)
    } else {
      counts.lineups += lineupsToUpsert.size
    }
  }

  if (battleUpserts.length > 0) {
    const { error: battleError } = await supabase
      .from('guild_war_battles')
      .upsert(battleUpserts, { onConflict: 'war_id,guild_code,event_id' })
    if (battleError) {
      errors.push(`battles (war ${war.warId}): ${battleError.message}`)
    } else {
      counts.battles += battleUpserts.length
    }
  }
}

export function extractStatusMembers(
  payload: GuildWarStatusResponse
): GuildWarStatusMember[] {
  for (const result of payload.eventResults ?? []) {
    const members = result.eventResponseData?.guildWarStatus?.members
    if (Array.isArray(members) && members.length > 0) return members
  }
  return []
}

/** Mirrors the sync's `updatePlayerLevelsAndAvatars`, incl. player_mapping refresh. */
async function ingestParticipation(
  supabase: TypedSupabaseClient,
  members: GuildWarStatusMember[],
  ctx: IngestGuildContext,
  warId: string,
  errors: string[]
): Promise<number> {
  const snapshotAt = new Date().toISOString()
  let count = 0

  for (const member of members) {
    if (!member.userId) continue

    const updateData: Record<string, unknown> = {}
    if (member.claimedPowerLevel !== undefined) {
      updateData.player_level = member.claimedPowerLevel
    }
    if (member.avatarUnitId) {
      updateData.avatar_unit_id = member.avatarUnitId
    }
    if (Object.keys(updateData).length > 0) {
      await supabase
        .from('player_mapping')
        .update(updateData as TablesUpdate<'player_mapping'>)
        .eq('guild_code', ctx.guildCode)
        .eq('player_id', member.userId)
    }

    const attemptsRemaining =
      typeof member.totalAttemptsLeft === 'number'
        ? member.totalAttemptsLeft
        : null
    const attemptsUsed =
      typeof member.totalAttemptsLeft === 'number' &&
      member.totalAttemptsLeft >= 0 &&
      member.totalAttemptsLeft <= DEFAULT_GUILD_WAR_ATTEMPTS
        ? DEFAULT_GUILD_WAR_ATTEMPTS - member.totalAttemptsLeft
        : null
    const exhaustedUnits =
      typeof member.numExhaustedUnits === 'number'
        ? member.numExhaustedUnits
        : null
    const score = typeof member.score === 'number' ? member.score : null

    const { error: partError } = await supabase
      .from('guild_war_participation')
      .upsert(
        {
          war_id: warId,
          guild_code: ctx.guildCode,
          user_id: member.userId,
          display_name: member.displayName,
          role: member.role ?? null,
          // Missing stays null (unknown), distinct from an observed `false`.
          opted_in: typeof member.optedIn === 'boolean' ? member.optedIn : null,
          opted_in_observed: typeof member.optedIn === 'boolean',
          total_attempts_left: attemptsRemaining,
          attempts_used: attemptsUsed,
          attempts_remaining: attemptsRemaining,
          score,
          exhausted_units: exhaustedUnits,
          claimed_power_level: member.claimedPowerLevel ?? null,
          last_activity_on: member.lastActivityOn
            ? new Date(member.lastActivityOn).toISOString()
            : null,
          total_units: member.totalUnits ?? null,
          snapshot_at: snapshotAt,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'guild_code,war_id,user_id,snapshot_at' }
      )

    if (partError) {
      errors.push(`participation ${member.userId}: ${partError.message}`)
      continue
    }
    count++
  }

  return count
}

async function findActiveWarId(
  supabase: TypedSupabaseClient,
  guildCode: string
): Promise<{ warId: string | null; lookupFailed: boolean }> {
  const { data, error } = await supabase
    .from('guild_war_matches')
    .select('war_id, war_status, war_start_date')
    .eq('guild_code', guildCode)
    .order('war_start_date', { ascending: false, nullsFirst: false })
    .limit(25)

  // Keep FAILED distinct from EMPTY, or an outage becomes a 400 blaming the upload.
  if (error) return { warId: null, lookupFailed: true }

  const rows = data ?? []
  const active = rows.find((row) => row.war_status === 'active')
  return {
    warId: active?.war_id ?? rows[0]?.war_id ?? null,
    lookupFailed: false
  }
}

/** Status members attach to the first active war, else the first war, else the DB's current match. */
export async function ingestGuildWar(
  supabase: TypedSupabaseClient,
  wars: LokiWarData[],
  members: GuildWarStatusMember[],
  ctx: IngestGuildContext
): Promise<WarIngestResult> {
  const counts: WarIngestCounts = {
    wars: 0,
    zones: 0,
    attempts: 0,
    battles: 0,
    lineups: 0,
    participation: 0
  }
  const errors: string[] = []
  let noWarToAttachMembers = false

  for (const war of wars) {
    await ingestWar(supabase, war, ctx, counts, errors)
  }

  if (members.length > 0) {
    const warIdFromPayload =
      wars.find((w) => w.status === 'active')?.warId ?? wars[0]?.warId ?? null
    const lookup = warIdFromPayload
      ? { warId: warIdFromPayload, lookupFailed: false }
      : await findActiveWarId(supabase, ctx.guildCode)

    if (lookup.warId) {
      counts.participation = await ingestParticipation(
        supabase,
        members,
        ctx,
        lookup.warId,
        errors
      )
    } else if (lookup.lookupFailed) {
      // Not noWarToAttachMembers: we only failed to find out, so this is a 502.
      errors.push(
        "participation: could not read this guild's war history, so the roster was not attached"
      )
    } else {
      noWarToAttachMembers = true
      errors.push(
        'participation: status members supplied but no war to attach them to — import the GET_GUILD_WAR_ACTIVITY_LOGS response first, or in the same request'
      )
    }
  }

  return { ...counts, errors, noWarToAttachMembers }
}
