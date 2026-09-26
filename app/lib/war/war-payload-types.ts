export interface ParserLogger {
  info: (...args: unknown[]) => void
}

export interface GuildWarActivityLog {
  type?: string
  id?: string
  userId?: string
  teamIndex?: number
  attemptDebuff?: number
  zone?: {
    id?: string
    type?: string
    visualId?: string
  }
  attacker?: {
    userId?: string
    displayName?: string
    lineupPower?: number
    units?: unknown[]
    machineOfWar?: {
      unitId?: string
      progressionIndex?: number
    }
  }
  defender?: {
    userId?: string
    displayName?: string
    lineupPower?: number
    units?: unknown[]
    machineOfWar?: {
      unitId?: string
      progressionIndex?: number
    }
  }
  buffs?: Array<{
    abilityId?: string
    scope?: string
  }>
  score?: number
  createdOn?: number
}

export interface GuildWarPlayerData {
  userId?: string
  displayName?: string
  avatarUnitId?: string
  avatarFrameId?: string
}

export interface GuildWarStatusMember {
  userId: string
  displayName: string
  lastActivityOn?: number
  role?: string
  avatarUnitId?: string
  avatarFrameId?: string
  totalAttemptsLeft?: number
  optedIn?: boolean
  claimedPowerLevel?: number
  numExhaustedUnits?: number
  score?: number
  totalUnits?: number
}

export interface GuildWarStatusResponse {
  eventResults?: Array<{
    eventId?: string
    eventResultType?: string
    eventResponseData?: {
      guildWarStatus?: {
        members?: GuildWarStatusMember[]
      }
    }
    failure?: {
      failureType?: string
      failureData?: {
        type?: string
        message?: string
      }
    }
  }>
}

export interface GuildWarGuildInfo {
  teamIndex?: number
  guildId?: string
  name?: string
  guildIcon?: string
  guildStatus?: string
}

export interface LokiEventResponseData {
  activityLogs?: GuildWarActivityLog[]
  playerData?: GuildWarPlayerData[]
  guildData?: GuildWarGuildInfo[]
}

export interface LokiGuildWarResponse {
  eventResults?: Array<{
    eventId?: string
    eventResultType?: string
    eventResponseData?: LokiEventResponseData
    failure?: {
      failureType?: string
      failureData?: {
        type?: string
        message?: string
      }
    }
  }>
  player?: unknown
}

export interface LokiWarData {
  warId: string
  guildCode: string
  opponentGuildCode?: string
  opponentGuildName: string
  status: string
  result?: string
  guildScore: number
  opponentScore: number
  startDate?: string
  endDate?: string
  season: number
  warNumber?: number
  battlefieldLevel?: number
  lastGuildWarEventId?: number
  zones?: LokiZoneData[]
  activityLogs?: GuildWarActivityLog[]
  playerNameMap?: Map<string, string>
  ourTeamIndex?: number
}

export interface LokiZoneData {
  zoneId?: string
  zoneNumber: number
  zoneName?: string
  zoneType: string
  status: string
  assignedPlayers: string[]
  attempts: LokiAttemptData[]
}

export interface LokiAttemptData {
  id?: string
  teamIndex?: number
  isGuildMember?: boolean
  playerId: string
  playerName: string
  attemptNumber: number
  attemptDebuff?: number
  status: string
  result?: string
  damageDealt: number
  scoreEarned: number
  unitsUsed: unknown[]
  startTime?: string
  endTime?: string
  battlePayload?: BattlePayload
}

export type GuildPlayerIndex = {
  ourPlayerIds: Set<string>
  playerNameMap: Map<string, string>
}

export type BattleBuff = {
  abilityId?: string
  scope?: string
}

export type BattleUnitSummary = {
  unitId?: string
  progressionIndex?: number
  rank?: number
  remainingHp?: number | null
  hpSource?: string | null
  status?: 'alive' | 'dead' | 'unknown'
}

export type BattleSideSummary = {
  userId?: string
  displayName?: string
  lineupPower?: number
  units: BattleUnitSummary[]
  unitsLost?: number
  unitsSurvived?: number
  unitsUnknown?: number
  machineOfWar?: {
    unitId?: string
    progressionIndex?: number
  } | null
}

export type BattleSummary = {
  attacker: BattleSideSummary
  defender: BattleSideSummary
  buffs: BattleBuff[]
}

export type BattlePayload = {
  battleSummary: BattleSummary
  log: GuildWarActivityLog
}

export type SnapshotGuildWarMember = {
  userId?: string
  displayName?: string
  level?: number
  role?: string
  avatarUnitId?: string
  avatarFrameId?: string
  lastActivityOn?: number
}

export type SnapshotGuildWarTeam = {
  guildWarGuildData?: {
    guildName?: string
    guildId?: string
    icon?: string
    members?: SnapshotGuildWarMember[]
  }
  currentScore?: number
  desiredBattlefieldLevel?: number
  defendingFrontLine?: {
    warZones?: unknown
  }
}

export type SnapshotWarZone = {
  zoneId?: string
  warZoneType?: string
  zonePart1?: {
    occupiedByUserId?: string
  }
  zonePart2?: {
    occupiedByUserId?: string
  }
}

export type SnapshotGuildWarModule = {
  type?: string
  moduleType?: string
  uuid?: string
  lastGuildWarEventId?: number
  personalState?: {
    teamIndex?: number
  }
  team1?: SnapshotGuildWarTeam
  team2?: SnapshotGuildWarTeam
  activityLogs?: GuildWarActivityLog[]
}

export type SnapshotGuildWarCandidate = {
  warUuid?: string
  startsOn?: number
  endsOn?: number
  module: SnapshotGuildWarModule
}

export interface WarConvertContext {
  guildCode: string
  guildName: string
  /** Drives team detection and opponent selection. */
  guildId?: string | null
  previousWar?: boolean
  /** Epoch ms; drives snapshot phase selection. */
  nowMs?: number
  playerIndex?: GuildPlayerIndex
  logger?: ParserLogger
}
