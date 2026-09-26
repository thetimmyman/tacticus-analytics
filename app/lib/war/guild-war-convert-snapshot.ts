import {
  TOTAL_WAR_DURATION_MS,
  buildBattlePayload,
  buildZonesFromActivityLogs,
  calculateScoresFromZones,
  calculateWarScores,
  computeSeasonAndWarNumber,
  computeSeasonAndWarNumberFromStart,
  extractBattlefieldLevelFromActivityLogs,
  extractLogTimestamps,
  formatZoneDisplayName,
  generateDeterministicId,
  isNonEmptyString,
  isRecord,
  isUuid,
  normalizePlayerId,
  selectGuildWarSnapshot,
  toIsoFromEpochMs
} from './guild-war-parser-core'
import type {
  GuildPlayerIndex,
  GuildWarActivityLog,
  LokiGuildWarResponse,
  LokiWarData,
  LokiZoneData,
  SnapshotGuildWarCandidate,
  SnapshotGuildWarMember,
  SnapshotWarZone,
  WarConvertContext
} from './war-payload-types'

export async function convertSnapshotPayload(
  payload: LokiGuildWarResponse,
  snapshotCandidates: SnapshotGuildWarCandidate[],
  ctx: WarConvertContext
): Promise<LokiWarData[]> {
  const nowMs = typeof ctx.nowMs === 'number' ? ctx.nowMs : Date.now()

  const previousWar = ctx.previousWar ?? false

  const logger = ctx.logger

  const basePlayerIndex: GuildPlayerIndex = ctx.playerIndex ?? {
    ourPlayerIds: new Set<string>(),
    playerNameMap: new Map<string, string>()
  }

  const snapshot = selectGuildWarSnapshot(
    snapshotCandidates,
    previousWar,
    nowMs
  )

  const moduleData = snapshot.module

  const team1 = moduleData.team1

  const team2 = moduleData.team2

  const team1GuildId = team1?.guildWarGuildData?.guildId

  const team2GuildId = team2?.guildWarGuildData?.guildId

  let ourTeamIndex: number | undefined

  if (isNonEmptyString(ctx.guildId)) {
    if (team1GuildId === ctx.guildId) ourTeamIndex = 1
    else if (team2GuildId === ctx.guildId) ourTeamIndex = 2
  }

  if (
    ourTeamIndex === undefined &&
    typeof moduleData.personalState?.teamIndex === 'number'
  ) {
    ourTeamIndex = moduleData.personalState.teamIndex
  }

  if (ourTeamIndex === undefined) ourTeamIndex = 1

  const ourTeam = ourTeamIndex === 2 ? team2 : team1

  const opponentTeam = ourTeamIndex === 2 ? team1 : team2

  const opponentGuildName =
    opponentTeam?.guildWarGuildData?.guildName ??
    opponentTeam?.guildWarGuildData?.guildId ??
    'Unknown Opponent'

  const opponentGuildId = opponentTeam?.guildWarGuildData?.guildId

  const playerNameMap = new Map(basePlayerIndex.playerNameMap)

  const ourPlayerIds = new Set(basePlayerIndex.ourPlayerIds)

  const addMember = (
    member: SnapshotGuildWarMember | undefined,
    isOurGuild: boolean
  ) => {
    if (
      !member ||
      !isNonEmptyString(member.userId) ||
      !isNonEmptyString(member.displayName)
    )
      return
    const normalizedId = normalizePlayerId(member.userId)
    playerNameMap.set(normalizedId, member.displayName.trim())
    if (isOurGuild) ourPlayerIds.add(normalizedId)
  }

  ;(ourTeam?.guildWarGuildData?.members ?? []).forEach((m) =>
    addMember(m, true)
  )
  ;(opponentTeam?.guildWarGuildData?.members ?? []).forEach((m) =>
    addMember(m, false)
  )

  const eventResult = payload.eventResults?.[0]

  const logsFromModule = Array.isArray(moduleData.activityLogs)
    ? moduleData.activityLogs
    : []

  const logsFromEvent = eventResult?.eventResponseData?.activityLogs

  const activityLogs =
    Array.isArray(logsFromEvent) && logsFromEvent.length > logsFromModule.length
      ? logsFromEvent
      : logsFromModule

  const flattenWarZones = (grid: unknown): SnapshotWarZone[] => {
    if (!Array.isArray(grid)) return []
    const flat: SnapshotWarZone[] = []
    for (const row of grid) {
      if (!Array.isArray(row)) continue
      for (const zone of row) {
        if (zone && typeof zone === 'object') flat.push(zone as SnapshotWarZone)
      }
    }
    return flat
  }

  const zones: LokiZoneData[] = []

  const zoneById = new Map<string, LokiZoneData>()

  const zoneByType = new Map<string, LokiZoneData>()

  const addZone = (zoneRaw: SnapshotWarZone, zoneNumber: number) => {
    const zoneId = isNonEmptyString(zoneRaw.zoneId) ? zoneRaw.zoneId : undefined
    const zoneType = isNonEmptyString(zoneRaw.warZoneType)
      ? zoneRaw.warZoneType
      : 'unknown'

    const assignedPlayers: string[] = []
    for (const occupantId of [
      zoneRaw.zonePart1?.occupiedByUserId,
      zoneRaw.zonePart2?.occupiedByUserId
    ]) {
      if (!isNonEmptyString(occupantId)) continue
      const name =
        playerNameMap.get(normalizePlayerId(occupantId)) ?? occupantId
      if (!assignedPlayers.includes(name)) assignedPlayers.push(name)
    }

    const zone: LokiZoneData = {
      zoneId,
      zoneNumber,
      zoneName: formatZoneDisplayName(zoneType),
      zoneType,
      status: assignedPlayers.length > 0 ? 'assigned' : 'available',
      assignedPlayers,
      attempts: []
    }

    zones.push(zone)
    if (zoneId) zoneById.set(zoneId, zone)
    if (isNonEmptyString(zoneType)) zoneByType.set(zoneType, zone)
  }

  const ourDefenseZones = flattenWarZones(ourTeam?.defendingFrontLine?.warZones)

  const opponentDefenseZones = flattenWarZones(
    opponentTeam?.defendingFrontLine?.warZones
  )

  ourDefenseZones.forEach((zone, idx) => addZone(zone, idx + 1))

  opponentDefenseZones.forEach((zone, idx) => addZone(zone, idx + 16))

  let rebuiltFromActivityLogs = false

  if (zones.length === 0 && activityLogs.length > 0) {
    logger?.info(
      'Snapshot had no zone layout; falling back to activity log zone reconstruction.'
    )
    zones.push(
      ...buildZonesFromActivityLogs(
        activityLogs,
        playerNameMap,
        ourPlayerIds,
        ourTeamIndex,
        logger
      )
    )
    rebuiltFromActivityLogs = true
  }

  const hasGuildRoster = ourPlayerIds.size > 0

  const ensureZoneFromLog = (log: GuildWarActivityLog): LokiZoneData | null => {
    const zoneInfo = log?.zone
    if (!zoneInfo) return null
    const zoneId = isNonEmptyString(zoneInfo.id) ? zoneInfo.id : undefined
    const zoneType = isNonEmptyString(zoneInfo.type) ? zoneInfo.type : 'unknown'
    const existing =
      (zoneId ? zoneById.get(zoneId) : undefined) ??
      (isNonEmptyString(zoneType) ? zoneByType.get(zoneType) : undefined)
    if (existing) return existing
    const created: LokiZoneData = {
      zoneId,
      zoneNumber: zones.length + 1,
      zoneName: formatZoneDisplayName(zoneType),
      zoneType,
      status: 'available',
      assignedPlayers: [],
      attempts: []
    }
    zones.push(created)
    if (zoneId) zoneById.set(zoneId, created)
    if (isNonEmptyString(zoneType)) zoneByType.set(zoneType, created)
    return created
  }

  if (!rebuiltFromActivityLogs) {
    for (const log of activityLogs) {
      const zoneEntry = ensureZoneFromLog(log)

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
      const isGuildMemberForAssignment =
        rosterMatch || !hasGuildRoster || teamIndexMatch
      const isGuildMemberForBattle = rosterMatch || teamIndexMatch

      if (log?.type === 'playerClaimedZone') {
        if (!zoneEntry || !isGuildMemberForAssignment) continue
        if (!zoneEntry.assignedPlayers.includes(playerName)) {
          zoneEntry.assignedPlayers.push(playerName)
        }
        zoneEntry.status = 'assigned'
      } else if (log?.type === 'playerLeftZone') {
        if (!zoneEntry || !isGuildMemberForAssignment) continue
        const idx = zoneEntry.assignedPlayers.indexOf(playerName)
        if (idx > -1) zoneEntry.assignedPlayers.splice(idx, 1)
        if (zoneEntry.assignedPlayers.length === 0) {
          zoneEntry.status = 'available'
        }
      } else if (log?.type === 'battleFinished') {
        if (!zoneEntry) continue
        const battlePayload = buildBattlePayload(log, playerNameMap, playerName)
        zoneEntry.attempts.push({
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
        })
        zoneEntry.status = 'in_progress'
      } else if (log?.type === 'zoneDestroyed') {
        if (!zoneEntry) continue
        zoneEntry.status = 'completed'
      }
    }
  }

  const timestamps = extractLogTimestamps(activityLogs)

  const startDate = toIsoFromEpochMs(snapshot.startsOn) ?? timestamps.start

  let endDate = toIsoFromEpochMs(snapshot.endsOn)

  if (!endDate && typeof snapshot.startsOn === 'number') {
    endDate = new Date(snapshot.startsOn + TOTAL_WAR_DURATION_MS).toISOString()
  }

  endDate = endDate ?? timestamps.end

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

  const computedScores = {
    ourScore: Math.max(activityScores.ourScore, zoneScores.ourScore),
    opponentScore: Math.max(
      activityScores.opponentScore,
      zoneScores.opponentScore
    )
  }

  const snapshotOurScore =
    typeof ourTeam?.currentScore === 'number' ? ourTeam.currentScore : undefined

  const snapshotOpponentScore =
    typeof opponentTeam?.currentScore === 'number'
      ? opponentTeam.currentScore
      : undefined

  const ourScore =
    typeof snapshotOurScore === 'number'
      ? snapshotOurScore
      : computedScores.ourScore

  const opponentScore =
    typeof snapshotOpponentScore === 'number'
      ? snapshotOpponentScore
      : computedScores.opponentScore

  const battlefieldLevel =
    typeof ourTeam?.desiredBattlefieldLevel === 'number'
      ? ourTeam.desiredBattlefieldLevel
      : extractBattlefieldLevelFromActivityLogs(activityLogs)

  let lastGuildWarEventId: number | undefined =
    typeof moduleData.lastGuildWarEventId === 'number'
      ? moduleData.lastGuildWarEventId
      : undefined

  if (
    lastGuildWarEventId === undefined &&
    isRecord(eventResult?.eventResponseData)
  ) {
    const possible = (eventResult?.eventResponseData as Record<string, unknown>)
      .lastGuildWarEventId
    if (typeof possible === 'number' && Number.isFinite(possible)) {
      lastGuildWarEventId = possible
    }
  }

  // Date-derived season is calibrated against the live leaderboard; the
  // event-id mapping is an unobserved fallback for date-less snapshots.
  const dateSeasonInfo = computeSeasonAndWarNumberFromStart(
    typeof snapshot.startsOn === 'number'
      ? snapshot.startsOn
      : startDate
        ? Date.parse(startDate)
        : undefined
  )

  const seasonInfo =
    dateSeasonInfo.season > 0
      ? dateSeasonInfo
      : computeSeasonAndWarNumber(lastGuildWarEventId)

  const endMs =
    typeof snapshot.endsOn === 'number' ? snapshot.endsOn : undefined

  const isCompleted = typeof endMs === 'number' ? endMs <= nowMs : previousWar

  let warResult: string | undefined

  if (isCompleted) {
    if (ourScore > opponentScore) warResult = 'win'
    else if (ourScore < opponentScore) warResult = 'loss'
    else warResult = 'draw'
  }

  const warId =
    isNonEmptyString(snapshot.warUuid) && isUuid(snapshot.warUuid)
      ? snapshot.warUuid
      : await generateDeterministicId(
          `${ctx.guildCode}-${opponentGuildId || 'unknown'}-${startDate || nowMs}`
        )

  const warData: LokiWarData = {
    warId,
    guildCode: ctx.guildCode,
    opponentGuildCode: opponentGuildId,
    opponentGuildName,
    status: isCompleted ? 'completed' : 'active',
    result: warResult,
    guildScore: ourScore,
    opponentScore,
    startDate,
    endDate,
    season: seasonInfo.season,
    warNumber: seasonInfo.warNumber,
    battlefieldLevel,
    lastGuildWarEventId,
    zones,
    activityLogs,
    playerNameMap,
    ourTeamIndex
  }

  logger?.info(
    `War(snapshot): ${ctx.guildCode} vs ${opponentGuildName}, status=${warData.status}, score=${ourScore}-${opponentScore}, season=${warData.season}, war=${warData.warNumber ?? 'n/a'}`
  )

  return [warData]
}
