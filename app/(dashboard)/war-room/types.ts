export type WarSide = 'offense' | 'defense'
export type HeroRole = 'core' | 'flex' | 'mow'

export interface MetaTeamHero {
  unitId: string
  role: HeroRole
}

export interface MetaTeam {
  id: string
  guild_code: string
  name: string
  side: WarSide
  priority: number | null
  notes: string | null
  heroes: MetaTeamHero[]
  created_at: string
  updated_at: string
}

interface MissingUnit {
  unitId: string
  role: HeroRole
  owned: boolean
  rankIndex: number | null
}

export interface TeamReadiness {
  team_id: string
  team_name: string
  team_side: WarSide
  team_priority: number | null
  heroes: MetaTeamHero[]
  floor_rank_index: number | null
  floor_rank_name: string | null
  ready: boolean
  weakest_unit_id: string | null
  missing_units: MissingUnit[]
}

export interface HeroUsage {
  war_id: string
  player_id: string
  player_name: string
  unit_id: string
  is_mow: boolean
  times_fielded: number
  times_died: number
}

export interface TeamPayload {
  name: string
  side: WarSide
  priority: number | null
  notes: string | null
  heroes: MetaTeamHero[]
}

export interface WarRoomGuildOption {
  guildCode: string
  label: string
  teamCount: number
}

export interface WarRoomData {
  /** Own guild or a cluster sibling; null only when no guild has shared teams yet. */
  guildCode: string | null
  /** Null without a current guild membership. */
  ownGuildCode: string | null
  /** Only populated for the caller's own guild. */
  isOwnGuild: boolean
  guilds: WarRoomGuildOption[]
  minRankIndex: number
  teams: MetaTeam[]
  readiness: TeamReadiness[]
  usage: HeroUsage[]
  /** Marks teams and heroes used this war. */
  myUsage: HeroUsage[]
}

export type TeamStatus = 'ready' | 'used' | 'not-ready'
