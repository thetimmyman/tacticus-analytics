export type RangeOption = '6' | '12' | '24' | 'all'

export type WarRow = {
  war_id: string
  opponent_guild_name: string | null
  war_result: string | null
  guild_score: number | null
  opponent_score: number | null
  war_start_date: string | null
  war_end_date: string | null
  war_season: number | null
  battlefield_level: number | null
  raw_loki_data?: unknown
}

export type PlayerAgg = {
  playerId: string
  player: string
  wars: number
  attempts: number
  wins: number
  score: number
  avgScore: number
  winRate: number
}

export type PlayerActivity = {
  playerId: string
  player: string
  warsParticipated: number
  totalWars: number
  participationRate: number
  lastActiveWarDate: string | null
  warsInactive: number
  attempts: number
  wins: number
  score: number
  avgScore: number
  winRate: number
}

export type ZoneAgg = {
  zoneType: string
  attempts: number
  wins: number
  score: number
  avgScore: number
  winRate: number
}
