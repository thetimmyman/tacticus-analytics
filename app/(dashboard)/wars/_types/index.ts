export type WarStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export type Unit = {
  id: string
  name: string
  shortCode: string
  portraitUrl?: string
  faction?: string
  rank?: number
  starLevel?: number
  progressionIndex?: number
  /** Positive = alive; <= 0 or null = dead; undefined = no data. */
  remainingHp?: number | null
  startingHp?: number
}

export type LineupStats = {
  lineupId: string
  units: Unit[]
  uses: number
  wins: number
  losses: number
  winRate: number
}

export type WarResult = 'win' | 'loss' | 'draw'

export type WarInfo = {
  warId: string
  warSlug: string
  status: WarStatus
  startTime: string
  endTime?: string
  result?: WarResult | null
  guild: {
    guildCode: string
    guildName: string
    guildTag: string
    logoUrl?: string
    score: number
  }
  opponent: {
    guildCode?: string
    guildName: string
    guildTag: string
    logoUrl?: string
    score: number
  }
}

export type WarStats = {
  ourAttacks: number
  theirAttacks: number
  perfectHits: number
  failedHits?: number
  ourWins?: number
  theirWins?: number
  ourPoints?: number
  theirPoints?: number
  winRate: number
  holdRate: number
  avgScore: number
}

export type PlayerStats = {
  playerId: string
  playerName: string
  isGuildMember?: boolean
  /** RAW `zone_type` defended: modal zone across defense battles, else the planned assignment. */
  assignedZoneType?: string
  attacks: {
    total: number
    wins: number
    losses: number
    points: number
    perfect: number
    failed?: number
    winRate: number
    avgScore?: number
  }
  defenses: {
    total: number
    holds: number
    breaches: number
    conceded: number
    holdRate: number
  }
}

export type GuildSummary = {
  guildName: string
  guildTag: string
  totalScore: number
  totalAttacks: number
  perfectHits: number
  totalDefenses: number
  totalConceded: number
  winRate: number
  holdRate: number
}

export type ZoneCell = {
  id: string
  /** Raw `zone_type`; names come from `zoneDisplayName()`, never the legacy `zone_name` column. */
  zoneType: string
  assignedPlayer?: string | null
  status: 'assigned' | 'available' | 'locked' | 'destroyed'
  offense: {
    attacks: number
    winRate: number
    avgScore: number
  }
  defense: {
    defends: number
    holdRate: number
    avgConceded: number
  }
}

export type RecentAttempt = {
  id: string
  attacker: { name: string; guildTag: string }
  defender: { name: string; guildTag: string }
  attackerUnits: Unit[]
  defenderUnits: Unit[]
  zoneType: string
  score: number
  kills: number
  buffLevel: number
  time: string
  isGuildMember: boolean
  /** Null = unavailable (older syncs). */
  isPerfect: boolean | null
  isFailed: boolean
}

export type MapStats = {
  /** Raw `zone_type`; a stored display name would leak SQL `INITCAP` output to the UI. */
  zoneType: string
  mapImageUrl?: string
  offense: {
    attacks: number
    wins: number
    winRate: number
    avgScore: number
  }
  defense: {
    defends: number
    holds: number
    holdRate: number
    avgScoreConceded: number
  }
}

export type CoreComposition = {
  coreId: string
  coreUnits: Unit[]
  coreSize: number
  totalUses: number
  wins: number
  winRate: number
  flexOptions: Array<{
    unit: Unit
    frequency: number
    winRateWithCore: number
    uses: number
  }>
}

export type UnitPerformance = {
  unit: Unit
  uses: number
  wins: number
  losses: number
  winRate: number
  avgScore: number
  avgKills: number
}

export type TeamAnalysis = {
  totalUsed: number
  wins: number
  losses: number
  winRate: number
  matchups: Array<{ defenderTeam: string; winRate: number; uses: number }>
  /** The RPC returns `zone_type` under `zoneName`; the route renames it. */
  zoneBreakdown: Array<{ zoneType: string; winRate: number; uses: number }>
  debuffBreakdown: Array<{ debuffLevel: string; winRate: number; uses: number }>
}

export type WarPlayerStatsRow = {
  player_id: string | null
  player_name: string | null
  is_guild_member: boolean | null
  total_attacks: number
  wins: number
  losses: number
  points: number
  perfect_hits: number
  failed_hits: number
  win_rate: number
  avg_score: number
  // Older RPCs omit defense columns; hold_rate is NULL when defended = 0.
  defended?: number | null
  held?: number | null
  breached?: number | null
  conceded?: number | null
  hold_rate?: number | null
}

export type WarStatsRow = {
  our_attacks: number
  their_attacks: number
  perfect_hits: number
  failed_hits: number
  our_wins: number
  their_wins: number
  our_points: number
  their_points: number
  win_rate: number
  hold_rate: number
  avg_score: number
}

export type LineupStatsRow = {
  lineup_id: string
  units_json: unknown
  machine_of_war: unknown
  uses: number
  wins: number
  losses: number
  win_rate: number
  avg_score: number
}

export type HeroPerformanceRow = {
  hero_key: string
  uses: number
  wins: number
  losses: number
  win_rate: number
  avg_score: number
  avg_kills: number
}
