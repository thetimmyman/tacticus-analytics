import type { Rarity } from '@tacticus/app-core/rarity-utils'
import type { GuildDataWithPrivacy } from '@tacticus/app-core/explore-privacy'

export interface HeroDetails {
  unitId: string
  [key: string]: unknown
}

export interface BossHit {
  boss: string
  player: string
  damage: number
  rarity: Rarity
  set: number
  encounterId: number | null
  heroDetails?: string | HeroDetails[] | null
  tier?: number | null
  metaTeam?: string
  teamBadge?: string
  isObfuscated?: boolean
  originalDamage?: number
  obfuscationPercent?: number
  [key: string]: unknown
}

export interface VOTLWChampion {
  player: string
  points: number
  season?: string
}

export type GuildData = GuildDataWithPrivacy & {
  guild_code: string
  guild_tag: string | null
  guild_name: string
  cluster_code: string | null
  cluster_name: string | null
  season: string
  current_gr_ranking: number | null
  current_war_rank: number | null
  war_rank: number | null
  total_battles: number
  active_players: number
  total_damage: number
  avg_damage_per_battle: number
  top_boss_hits: BossHit[]
  available_rarities: Rarity[]
  veteran_count: number
  votlw_champions: VOTLWChampion[]
  last_updated: string
  explore_privacy_mode?: string | string[]
  explore_obfuscation_percent?: number | null
  obfuscationPercent?: number
  originalTotalDamage?: number
  originalAvgDamagePerBattle?: number
  isObfuscated?: boolean
  is_premium?: boolean
  is_eot_cluster?: boolean
}

export type RawBossHit = {
  rarity?: unknown
  rarity_name?: unknown
  damage?: unknown
  damageDealt?: unknown
  damage_dealt?: unknown
  set?: unknown
  boss_set?: unknown
  set_level?: unknown
  boss?: string | null
  boss_name?: string | null
  Name?: string | null
  encounterId?: unknown
  encounter_id?: unknown
  heroDetails?: string | HeroDetails[] | null
  hero_details?: string | HeroDetails[] | null
  metaTeam?: unknown
  player?: string | null
  player_name?: string | null
  displayName?: string | null
  tier?: number | null
  boss_tier?: number | null
  [key: string]: unknown
}

export type ExploreContentProps = Record<string, never>
