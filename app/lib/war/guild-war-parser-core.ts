import { zoneDisplayName } from '@/app/lib/war/war-naming'
import type {
  BattlePayload,
  BattleSummary,
  BattleUnitSummary,
  GuildWarActivityLog,
  LokiAttemptData,
  LokiGuildWarResponse,
  LokiZoneData,
  ParserLogger,
  SnapshotGuildWarCandidate,
  SnapshotGuildWarModule
} from './war-payload-types'

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

export const normalizePlayerId = (value: string): string =>
  value.trim().toLowerCase()

export const toNumberValue = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

export const toIsoFromEpochMs = (value: unknown): string | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return new Date(value).toISOString()
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (value: string): boolean => UUID_REGEX.test(value)

export const getMostCommonMapKey = (
  counter: Map<string, number>
): string | null => {
  let bestKey: string | null = null
  let bestCount = 0
  for (const [key, count] of counter.entries()) {
    if (count > bestCount) {
      bestCount = count
      bestKey = key
    }
  }
  return bestKey
}

const getUnitHpSnapshot = (
  unit: Record<string, unknown>
): {
  value: number | null
  source: string | null
  hasAfter: boolean
} => {
  const remainingAfter = toNumberValue(unit.remainingHPAfter)
  if (remainingAfter !== null) {
    return { value: remainingAfter, source: 'remainingHPAfter', hasAfter: true }
  }

  const remainingBefore = toNumberValue(unit.remainingHPBefore)
  if (remainingBefore !== null) {
    return {
      value: remainingBefore,
      source: 'remainingHPBefore',
      hasAfter: false
    }
  }

  const startAfter = toNumberValue(unit.startHPAfter)
  if (startAfter !== null) {
    return { value: startAfter, source: 'startHPAfter', hasAfter: false }
  }

  const startBefore = toNumberValue(unit.startHPBefore)
  if (startBefore !== null) {
    return { value: startBefore, source: 'startHPBefore', hasAfter: false }
  }

  return { value: null, source: null, hasAfter: false }
}

export const summarizeUnits = (
  units: unknown[]
): {
  units: BattleUnitSummary[]
  alive: number
  dead: number
  unknown: number
} => {
  const summaries: BattleUnitSummary[] = []
  let alive = 0
  let dead = 0
  let unknown = 0

  for (const unit of units) {
    if (!unit || typeof unit !== 'object') {
      summaries.push({ status: 'unknown' })
      unknown += 1
      continue
    }

    const record = unit as Record<string, unknown>
    const { value, source, hasAfter } = getUnitHpSnapshot(record)
    let status: BattleUnitSummary['status'] = 'unknown'
    if (hasAfter && value !== null) {
      status = value > 0 ? 'alive' : 'dead'
    }

    if (status === 'alive') alive += 1
    else if (status === 'dead') dead += 1
    else unknown += 1

    summaries.push({
      unitId: isNonEmptyString(record.unitId) ? record.unitId : undefined,
      progressionIndex: toNumberValue(record.progressionIndex) ?? undefined,
      rank: toNumberValue(record.rank) ?? undefined,
      remainingHp: value,
      hpSource: source,
      status
    })
  }

  // Once any unit reports remainingHPAfter the API lists survivors only, so units with no HP died.
  const anyHasAfterData = summaries.some(
    (s) => s.hpSource === 'remainingHPAfter'
  )
  if (anyHasAfterData) {
    for (let i = 0; i < summaries.length; i++) {
      if (
        summaries[i]!.status === 'unknown' &&
        summaries[i]!.hpSource === null
      ) {
        summaries[i] = { ...summaries[i]!, status: 'dead' }
        dead += 1
        unknown -= 1
      }
    }
  }

  return { units: summaries, alive, dead, unknown }
}

export const resolvePlayerName = (
  playerNameMap: Map<string, string>,
  userId?: string,
  fallback?: string
): string | undefined => {
  if (!isNonEmptyString(userId)) {
    return isNonEmptyString(fallback) ? fallback : undefined
  }

  const normalized = normalizePlayerId(userId)
  return playerNameMap.get(normalized) ?? fallback ?? userId
}

export const buildBattlePayload = (
  log: GuildWarActivityLog,
  playerNameMap: Map<string, string>,
  attackerDisplayName: string
): BattlePayload => {
  const attackerUserId = log.attacker?.userId ?? log.userId
  const defenderUserId = log.defender?.userId

  const attackerName = isNonEmptyString(attackerDisplayName)
    ? attackerDisplayName
    : resolvePlayerName(
        playerNameMap,
        attackerUserId,
        log.attacker?.displayName
      )

  const defenderName = resolvePlayerName(
    playerNameMap,
    defenderUserId,
    log.defender?.displayName
  )

  const attackerSummary = summarizeUnits(
    Array.isArray(log.attacker?.units) ? (log.attacker?.units ?? []) : []
  )
  const defenderSummary = summarizeUnits(
    Array.isArray(log.defender?.units) ? (log.defender?.units ?? []) : []
  )

  const battleSummary: BattleSummary = {
    attacker: {
      userId: attackerUserId,
      displayName: attackerName,
      lineupPower: log.attacker?.lineupPower,
      units: attackerSummary.units,
      unitsLost: attackerSummary.dead,
      unitsSurvived: attackerSummary.alive,
      unitsUnknown: attackerSummary.unknown,
      machineOfWar: log.attacker?.machineOfWar ?? null
    },
    defender: {
      userId: defenderUserId,
      displayName: defenderName,
      lineupPower: log.defender?.lineupPower,
      units: defenderSummary.units,
      unitsLost: defenderSummary.dead,
      unitsSurvived: defenderSummary.alive,
      unitsUnknown: defenderSummary.unknown,
      machineOfWar: log.defender?.machineOfWar ?? null
    },
    buffs: Array.isArray(log.buffs) ? log.buffs : []
  }

  return { battleSummary, log }
}

export const NUM_WARS_PER_SEASON = 6

export const TOTAL_WAR_DURATION_MS = 60 * 60 * 60 * 1000

export const computeSeasonAndWarNumber = (
  lastGuildWarEventId: number | undefined
): { season: number; warNumber?: number } => {
  if (
    typeof lastGuildWarEventId !== 'number' ||
    !Number.isFinite(lastGuildWarEventId) ||
    lastGuildWarEventId <= 0
  ) {
    return { season: 0, warNumber: undefined }
  }

  const index = lastGuildWarEventId - 1
  const season = Math.floor(index / NUM_WARS_PER_SEASON) + 1
  const warNumber = (index % NUM_WARS_PER_SEASON) + 1
  return { season, warNumber }
}

// Re-exported from app-core, which owns the calendar (the guild-war module boundary is one-way).

export {
  GW_SEASON_ANCHOR_SEASON,
  computeSeasonAndWarNumberFromStart,
  currentGwSeason
} from '@tacticus/app-core/gw-season'

/** Writes the legacy, unread `guild_war_zones.zone_name`; surfaces derive labels from `zone_type`. */
export const formatZoneDisplayName = (zoneType: string): string =>
  zoneDisplayName(zoneType)

export const buildLineupId = (
  units: unknown,
  machineOfWar?: unknown | null
): string | null => {
  if (!Array.isArray(units)) return null

  const keys: string[] = []
  const pushKey = (rawKey: unknown) => {
    if (typeof rawKey !== 'string') return
    const trimmed = rawKey.trim()
    if (trimmed.length > 0) {
      keys.push(trimmed)
    }
  }

  for (const unit of units) {
    if (!unit || typeof unit !== 'object') continue
    const record = unit as Record<string, unknown>
    pushKey(record.heroKey ?? record.unitId ?? record.id)
  }

  if (machineOfWar && typeof machineOfWar === 'object') {
    const record = machineOfWar as Record<string, unknown>
    pushKey(record.unitId ?? record.heroKey ?? record.id)
  }

  if (keys.length === 0) return null
  keys.sort()
  const joined = keys.join('|')
  let hash = 0
  for (let i = 0; i < joined.length; i++) {
    const char = joined.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

export const computeBattleDurationSeconds = (
  startTime?: string,
  endTime?: string
): number | null => {
  if (!isNonEmptyString(startTime) || !isNonEmptyString(endTime)) return null
  const startMs = Date.parse(startTime)
  const endMs = Date.parse(endTime)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  return Math.max(0, Math.round((endMs - startMs) / 1000))
}

export const computePerfectHit = (
  attackerUnitsLost: number | null | undefined,
  attemptResult?: string | null
): boolean | null => {
  if (attackerUnitsLost === null || attackerUnitsLost === undefined) return null
  return attackerUnitsLost === 0 && attemptResult === 'win'
}

export const computeFailedHit = (
  attemptResult?: string | null,
  scoreEarned?: number | null
): boolean | null => {
  if (attemptResult === 'loss') return true
  if (typeof scoreEarned === 'number' && scoreEarned === 0) return true
  if (attemptResult === null || attemptResult === undefined) {
    if (scoreEarned === null || scoreEarned === undefined) return null
  }
  return false
}

export const extractGuildTagFromPlayerName = (
  playerName: string
): string | null => {
  const value = playerName.trim()
  if (!value) return null

  const patterns = [
    /\[([A-Za-z0-9]{2,10})\]/,
    /【([^】]{2,10})】/,
    /〘([^〙]{2,10})〙/,
    /〖([^〗]{2,10})〗/
  ]

  for (const pattern of patterns) {
    const match = value.match(pattern)
    const raw = match?.[1]
    if (raw && raw.trim().length > 0) {
      return raw.trim().toUpperCase()
    }
  }

  return null
}

export const looksLikeSelfOpponent = (
  opponentName: string | null | undefined,
  guildName: string,
  guildCode: string
): boolean => {
  if (!isNonEmptyString(opponentName)) return true

  const normalizedOpponent = opponentName.trim().toLowerCase()
  if (!normalizedOpponent) return true
  if (normalizedOpponent === 'unknown opponent') return true

  const normalizedGuildName = guildName.trim().toLowerCase()
  const normalizedGuildCode = guildCode.trim().toLowerCase()

  return (
    (normalizedGuildName.length > 0 &&
      normalizedOpponent.includes(normalizedGuildName)) ||
    (normalizedGuildCode.length > 0 &&
      normalizedOpponent.includes(normalizedGuildCode))
  )
}

export const extractGuildWarSnapshotCandidates = (
  payload: LokiGuildWarResponse
): SnapshotGuildWarCandidate[] => {
  const player = payload.player
  if (!isRecord(player)) return []
  const hero = player.hero
  if (!isRecord(hero)) return []
  const liveEventsContainer = hero.liveEvents
  if (!isRecord(liveEventsContainer)) return []
  const liveEvents = liveEventsContainer.liveEvents
  if (!Array.isArray(liveEvents)) return []

  const candidates: SnapshotGuildWarCandidate[] = []

  for (const event of liveEvents) {
    if (!isRecord(event)) continue
    const modules = event.modules
    if (!Array.isArray(modules)) continue

    const startsOn =
      typeof event.startsOn === 'number' ? event.startsOn : undefined
    const endsOn = typeof event.endsOn === 'number' ? event.endsOn : undefined

    for (const moduleEntry of modules) {
      if (!isRecord(moduleEntry)) continue
      const moduleValue = moduleEntry.module
      if (!isRecord(moduleValue)) continue

      const moduleType =
        (typeof moduleValue.moduleType === 'string'
          ? moduleValue.moduleType
          : undefined) ??
        (typeof moduleValue.type === 'string' ? moduleValue.type : undefined) ??
        (typeof moduleEntry.type === 'string' ? moduleEntry.type : undefined)

      if (moduleType !== 'guildWarEvent') continue

      const warUuid =
        typeof moduleValue.uuid === 'string'
          ? moduleValue.uuid
          : typeof moduleValue.warUuid === 'string'
            ? (moduleValue.warUuid as string)
            : undefined

      candidates.push({
        warUuid,
        startsOn,
        endsOn,
        module: moduleValue as SnapshotGuildWarModule
      })
    }
  }

  return candidates
}

export const buildZonesFromActivityLogs = (
  logs: GuildWarActivityLog[],
  playerNameMap: Map<string, string>,
  ourPlayerIds: Set<string>,
  ourTeamIndex: number,
  logger?: ParserLogger
): LokiZoneData[] => {
  const zoneMap = new Map<
    string,
    {
      zoneId: string
      zoneNumber: number
      zoneName?: string
      zoneType: string
      status: string
      assignedPlayers: string[]
      attempts: LokiAttemptData[]
    }
  >()

  if (!Array.isArray(logs)) {
    return []
  }

  const hasGuildRoster = ourPlayerIds.size > 0

  for (const log of logs) {
    const zoneInfo = log?.zone ?? {}
    const zoneType = zoneInfo?.type ?? 'unknown'
    const zoneId = isNonEmptyString(zoneInfo?.id)
      ? zoneInfo.id
      : isNonEmptyString(zoneType)
        ? zoneType
        : crypto.randomUUID()

    if (!zoneMap.has(zoneId)) {
      zoneMap.set(zoneId, {
        zoneId,
        zoneNumber: zoneMap.size + 1,
        zoneName: formatZoneDisplayName(zoneType),
        zoneType,
        status: 'available',
        assignedPlayers: [],
        attempts: []
      })
    }

    const zoneEntry = zoneMap.get(zoneId)
    if (!zoneEntry) continue

    const playerId = log?.userId ?? log?.attacker?.userId ?? 'unknown'
    const normalizedPlayerId = isNonEmptyString(playerId)
      ? normalizePlayerId(playerId)
      : 'unknown'
    const playerName =
      playerNameMap.get(normalizedPlayerId) ??
      log?.attacker?.displayName ??
      playerId

    const rosterMatch =
      normalizedPlayerId !== 'unknown' && ourPlayerIds.has(normalizedPlayerId)
    const teamIndexMatch =
      typeof log?.teamIndex === 'number'
        ? log.teamIndex === ourTeamIndex
        : false

    // Assignments: roster match, else teamIndex; with no roster yet, accept all as ours.
    const isGuildMemberForAssignment =
      rosterMatch || !hasGuildRoster || teamIndexMatch

    const isGuildMemberForBattle = rosterMatch || teamIndexMatch

    if (log?.type === 'playerClaimedZone') {
      if (!isGuildMemberForAssignment) continue
      if (!zoneEntry.assignedPlayers.includes(playerName)) {
        zoneEntry.assignedPlayers.push(playerName)
      }
      zoneEntry.status = 'assigned'
    } else if (log?.type === 'playerLeftZone') {
      if (!isGuildMemberForAssignment) continue
      const idx = zoneEntry.assignedPlayers.indexOf(playerName)
      if (idx > -1) {
        zoneEntry.assignedPlayers.splice(idx, 1)
      }
      if (zoneEntry.assignedPlayers.length === 0) {
        zoneEntry.status = 'available'
      }
    } else if (log?.type === 'battleFinished') {
      const battlePayload = buildBattlePayload(log, playerNameMap, playerName)
      const attempt: LokiAttemptData = {
        id: log?.id,
        teamIndex:
          typeof log?.teamIndex === 'number' ? log.teamIndex : undefined,
        isGuildMember: isGuildMemberForBattle,
        playerId,
        playerName,
        attemptNumber:
          typeof log?.attemptDebuff === 'number'
            ? log.attemptDebuff
            : zoneEntry.attempts.length + 1,
        attemptDebuff:
          typeof log?.attemptDebuff === 'number'
            ? log.attemptDebuff
            : undefined,
        status: 'completed',
        result: Number(log?.score ?? 0) > 0 ? 'win' : 'loss',
        damageDealt: 0,
        scoreEarned: Number(log?.score ?? 0),
        unitsUsed: log?.attacker?.units ?? [],
        battlePayload,
        startTime:
          typeof log?.createdOn === 'number'
            ? new Date(log.createdOn).toISOString()
            : undefined,
        endTime:
          typeof log?.createdOn === 'number'
            ? new Date(log.createdOn).toISOString()
            : undefined
      }

      zoneEntry.attempts.push(attempt)
      zoneEntry.status = 'in_progress'
    } else if (log?.type === 'zoneDestroyed') {
      zoneEntry.status = 'completed'
    } else if (log?.type === 'battlefieldSelected') {
      logger?.info(
        `Battlefield level selected: ${(log as unknown as { battlefieldLevel?: number }).battlefieldLevel}`
      )
    }
  }

  return Array.from(zoneMap.values())
}

/** Backfills `battlefield_level` when the snapshot lacks it; the latest `battlefieldSelected` wins. */
export const extractBattlefieldLevelFromActivityLogs = (
  logs: GuildWarActivityLog[]
): number | undefined => {
  if (!Array.isArray(logs)) return undefined
  let latest: { level: number; createdOn: number } | undefined
  for (const log of logs) {
    if (log?.type !== 'battlefieldSelected') continue
    const candidate = (log as unknown as { battlefieldLevel?: unknown })
      .battlefieldLevel
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) continue
    const createdOnRaw = (log as unknown as { createdOn?: unknown }).createdOn
    const createdOn =
      typeof createdOnRaw === 'number' && Number.isFinite(createdOnRaw)
        ? createdOnRaw
        : 0
    if (!latest || createdOn >= latest.createdOn) {
      latest = { level: candidate, createdOn }
    }
  }
  return latest?.level
}

export const calculateScoresFromZones = (
  zones: LokiZoneData[],
  ourPlayerIds: Set<string>,
  ourTeamIndex?: number,
  logger?: ParserLogger
): { ourScore: number; opponentScore: number } => {
  let ourScore = 0
  let opponentScore = 0

  // Roster membership lags, and crediting a missing member to the opponent can flip a win, so prefer
  // the attempt's teamIndex whenever ourTeamIndex is known (positive; 0/undefined means unknown).
  const canUseTeamIndex =
    typeof ourTeamIndex === 'number' &&
    Number.isInteger(ourTeamIndex) &&
    ourTeamIndex > 0

  for (const zone of zones) {
    for (const attempt of zone.attempts) {
      const score = attempt.scoreEarned || 0
      if (canUseTeamIndex && typeof attempt.teamIndex === 'number') {
        if (attempt.teamIndex === ourTeamIndex) {
          ourScore += score
        } else {
          opponentScore += score
        }
        continue
      }
      const normalizedPlayerId = isNonEmptyString(attempt.playerId)
        ? normalizePlayerId(attempt.playerId)
        : null
      if (normalizedPlayerId && ourPlayerIds.has(normalizedPlayerId)) {
        ourScore += score
      } else if (normalizedPlayerId) {
        opponentScore += score
      }
    }
  }

  logger?.info(
    `Zones score calculation: ourScore=${ourScore}, opponentScore=${opponentScore}`
  )
  return { ourScore, opponentScore }
}

export const calculateWarScores = (
  logs: GuildWarActivityLog[],
  ourTeamIndex: number,
  ourPlayerIds: Set<string>,
  logger?: ParserLogger
): { ourScore: number; opponentScore: number } => {
  let ourScore = 0
  let opponentScore = 0

  if (!Array.isArray(logs)) {
    return { ourScore, opponentScore }
  }

  for (const log of logs) {
    if (log?.type === 'battleFinished' && typeof log?.score === 'number') {
      const attackerUserId = log?.attacker?.userId ?? log?.userId
      const teamIndex = log?.teamIndex

      if (typeof teamIndex === 'number') {
        if (teamIndex === ourTeamIndex) {
          ourScore += log.score
        } else {
          opponentScore += log.score
        }
      } else if (
        attackerUserId &&
        ourPlayerIds.has(normalizePlayerId(attackerUserId))
      ) {
        ourScore += log.score
      } else if (attackerUserId) {
        opponentScore += log.score
      }
    }
  }

  logger?.info(
    `Score calculation: ourScore=${ourScore}, opponentScore=${opponentScore} from ${logs.filter((l) => l?.type === 'battleFinished').length} battles`
  )

  return { ourScore, opponentScore }
}

export const extractLogTimestamps = (
  logs: GuildWarActivityLog[]
): { start?: string; end?: string } => {
  if (!Array.isArray(logs)) {
    return {}
  }
  let min: number | null = null
  let max: number | null = null

  for (const log of logs) {
    if (typeof log?.createdOn === 'number') {
      if (min === null || log.createdOn < min) {
        min = log.createdOn
      }
      if (max === null || log.createdOn > max) {
        max = log.createdOn
      }
    }
  }

  return {
    start: min ? new Date(min).toISOString() : undefined,
    end: max ? new Date(max).toISOString() : undefined
  }
}

/** SHA-256 → UUID-shaped id matching the edge function's, so re-imports upsert the same ids. */
export async function generateDeterministicId(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hashHex.slice(0, 8)}-${hashHex.slice(8, 12)}-${hashHex.slice(12, 16)}-${hashHex.slice(16, 20)}-${hashHex.slice(20, 32)}`
}

export function selectGuildWarSnapshot(
  candidates: SnapshotGuildWarCandidate[],
  previousWar: boolean,
  nowMs: number
): SnapshotGuildWarCandidate {
  if (candidates.length === 0) {
    throw new Error('At least one guild-war snapshot candidate is required')
  }
  if (candidates.length === 1) return candidates[0]!

  const withEnds = candidates.filter(
    (candidate) => typeof candidate.endsOn === 'number'
  ) as Array<SnapshotGuildWarCandidate & { endsOn: number }>
  const bestAnyByEnds = () =>
    [...withEnds].sort((a, b) => b.endsOn - a.endsOn)[0] ?? candidates[0]!

  if (previousWar) {
    const past = withEnds.filter((candidate) => candidate.endsOn < nowMs)
    return [...past].sort((a, b) => b.endsOn - a.endsOn)[0] ?? bestAnyByEnds()
  }

  const active = withEnds.filter(
    (candidate) =>
      typeof candidate.startsOn === 'number' &&
      candidate.startsOn <= nowMs &&
      candidate.endsOn >= nowMs
  )
  if (active.length > 0) {
    return [...active].sort((a, b) => (b.startsOn ?? 0) - (a.startsOn ?? 0))[0]!
  }

  const upcoming = withEnds.filter(
    (candidate) =>
      typeof candidate.startsOn === 'number' &&
      candidate.startsOn > nowMs &&
      candidate.endsOn >= nowMs
  )
  if (upcoming.length > 0) {
    return [...upcoming].sort(
      (a, b) => (a.startsOn ?? 0) - (b.startsOn ?? 0)
    )[0]!
  }

  const future = withEnds.filter((candidate) => candidate.endsOn >= nowMs)
  if (future.length > 0) {
    return [...future].sort((a, b) => a.endsOn - b.endsOn)[0]!
  }
  return bestAnyByEnds()
}
