import {
  TOTAL_WAR_DURATION_MS,
  buildZonesFromActivityLogs,
  calculateScoresFromZones,
  calculateWarScores,
  computeSeasonAndWarNumberFromStart,
  extractBattlefieldLevelFromActivityLogs,
  extractLogTimestamps,
  generateDeterministicId,
  isNonEmptyString,
  normalizePlayerId
} from './guild-war-parser-core'
import type {
  GuildPlayerIndex,
  LokiGuildWarResponse,
  LokiWarData,
  WarConvertContext
} from './war-payload-types'

export async function convertActivityLogPayload(
  payload: LokiGuildWarResponse,
  ctx: WarConvertContext
): Promise<LokiWarData[]> {
  const nowMs = typeof ctx.nowMs === 'number' ? ctx.nowMs : Date.now()

  const previousWar = ctx.previousWar ?? false

  const logger = ctx.logger

  const basePlayerIndex: GuildPlayerIndex = ctx.playerIndex ?? {
    ourPlayerIds: new Set<string>(),
    playerNameMap: new Map<string, string>()
  }

  // Batched LOKI responses can carry unrelated results first; pick the one with logs.
  const eventResult = payload.eventResults?.find(
    (result) =>
      Array.isArray(result?.eventResponseData?.activityLogs) &&
      result.eventResponseData.activityLogs.length > 0
  )

  if (!eventResult?.eventResponseData) return []

  const { activityLogs, playerData, guildData } = eventResult.eventResponseData

  if (!activityLogs || activityLogs.length === 0) return []

  // Pre-battle exports (claims only) would create a no-battle war and slip past
  // the roster-only rejection; a battle is the signal a war exists.
  if (!activityLogs.some((log) => log.type === 'battleFinished')) return []

  const playerNameMap = new Map(basePlayerIndex.playerNameMap)

  const ourPlayerIds = new Set(basePlayerIndex.ourPlayerIds)

  const hasDbPlayerIndex = ourPlayerIds.size > 0

  // `playerData` holds BOTH guilds with no affiliation: names only. Treating it
  // as our roster marks opponent attacks as ours when player_mapping is empty.
  for (const player of playerData ?? []) {
    if (
      isNonEmptyString(player.userId) &&
      isNonEmptyString(player.displayName)
    ) {
      const normalizedId = normalizePlayerId(player.userId)
      playerNameMap.set(normalizedId, player.displayName.trim())
    }
  }

  const ourGuildTeamIndex =
    ctx.guildId && guildData
      ? guildData.find((g) => g.guildId === ctx.guildId)?.teamIndex
      : undefined

  let ourTeamIndex =
    typeof ourGuildTeamIndex === 'number' ? ourGuildTeamIndex : 0

  if (hasDbPlayerIndex) {
    for (const log of activityLogs) {
      if (
        log.type === 'battleFinished' &&
        log.attacker?.userId &&
        typeof log.teamIndex === 'number'
      ) {
        const attackerId = normalizePlayerId(log.attacker.userId)
        if (ourPlayerIds.has(attackerId)) {
          ourTeamIndex = log.teamIndex
          break
        }
      }
    }
  } else if (typeof ourGuildTeamIndex === 'number') {
    for (const log of activityLogs) {
      if (
        log.type === 'battleFinished' &&
        isNonEmptyString(log.attacker?.userId) &&
        log.teamIndex === ourGuildTeamIndex
      ) {
        ourPlayerIds.add(normalizePlayerId(log.attacker.userId))
      }
    }
  }

  let opponentGuildName = 'Unknown Opponent'

  let opponentGuildId: string | undefined

  if (guildData && guildData.length >= 2) {
    const ourGuildInfo = ctx.guildId
      ? guildData.find((g) => g.guildId === ctx.guildId)
      : undefined
    const opponentGuild =
      typeof ourGuildInfo?.teamIndex === 'number'
        ? guildData.find((g) => g.teamIndex !== ourGuildInfo.teamIndex)
        : guildData.find((g) => g.teamIndex !== ourTeamIndex)
    if (opponentGuild && opponentGuild.guildId !== ctx.guildId) {
      opponentGuildName = opponentGuild.name || 'Unknown Opponent'
      opponentGuildId = opponentGuild.guildId
    }
  }

  const zones = buildZonesFromActivityLogs(
    activityLogs,
    playerNameMap,
    ourPlayerIds,
    ourTeamIndex,
    logger
  )

  const timestamps = extractLogTimestamps(activityLogs)

  const activityScores = calculateWarScores(
    activityLogs,
    ourTeamIndex,
    ourPlayerIds,
    logger
  )

  const zoneScores = calculateScoresFromZones(
    zones,
    ourPlayerIds,
    ourTeamIndex,
    logger
  )

  const scores = {
    ourScore: Math.max(activityScores.ourScore, zoneScores.ourScore),
    opponentScore: Math.max(
      activityScores.opponentScore,
      zoneScores.opponentScore
    )
  }

  // Exports have no end marker; wars run a fixed 60h window, so once elapsed
  // the war is completed (lists and analytics key on `completed`).
  const startMs = timestamps.start ? Date.parse(timestamps.start) : NaN

  const isCompleted =
    previousWar ||
    (Number.isFinite(startMs) && startMs + TOTAL_WAR_DURATION_MS <= nowMs)

  let warResult: string | undefined

  if (isCompleted) {
    if (scores.ourScore > scores.opponentScore) warResult = 'win'
    else if (scores.ourScore < scores.opponentScore) warResult = 'loss'
    else warResult = 'draw'
  }

  const warIdBase = `${ctx.guildCode}-${opponentGuildId || 'unknown'}-${timestamps.start || nowMs}`

  const warId = await generateDeterministicId(warIdBase)

  const seasonInfo = computeSeasonAndWarNumberFromStart(
    Number.isFinite(startMs) ? startMs : undefined
  )

  const warData: LokiWarData = {
    warId,
    guildCode: ctx.guildCode,
    opponentGuildCode: opponentGuildId,
    opponentGuildName,
    status: isCompleted ? 'completed' : 'active',
    result: warResult,
    guildScore: scores.ourScore,
    opponentScore: scores.opponentScore,
    startDate: timestamps.start,
    endDate: timestamps.end,
    season: seasonInfo.season,
    warNumber: seasonInfo.warNumber,
    battlefieldLevel: extractBattlefieldLevelFromActivityLogs(activityLogs),
    zones,
    activityLogs,
    playerNameMap,
    ourTeamIndex
  }

  logger?.info(
    `War(legacy): ${ctx.guildCode} vs ${opponentGuildName}, status=${warData.status}, score=${scores.ourScore}-${scores.opponentScore}`
  )

  return [warData]
}
