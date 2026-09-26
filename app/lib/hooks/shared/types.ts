import type { CatalogBoss } from '@/app/lib/catalogs/types'
import type { MemberStatsSummary } from '@/app/lib/hooks/member-stats-materialized'

export type Boss = CatalogBoss

export interface SeasonBoss {
  boss_type: string
  boss_name: string
  set: number
  encounter_id: number
  rarity: string
  variant?: string | null
}

export interface BossRotation {
  kind: 'current' | 'upcoming' | 'future'
  seasonNumber: number
  configId?: string | null
  bosses: SeasonBoss[]
  levels?: string[]
  resolvedAt?: string | null
}

export interface Season {
  seasonNumber: number
  configId?: string | null
  bosses: SeasonBoss[]
  previewBosses?: SeasonBoss[]
  levels?: string[]
  resolvedAt?: string | null
}

export interface GuildMember {
  playerId: string
  displayName: string
  role?: string | null
  isActive: boolean
  guildCode?: string | null
  userId?: string | null
  isClaimed?: boolean
  avatarUnitId?: string | null
  playerLevel?: number | null
  primaryBoss?: string | null
  secondaryBoss?: string | null
  bossPreferences?: Record<string, unknown> | string | null
  lastSyncAt?: string | null
  lastSyncTokens?: number | null
  lastSyncBombs?: number | null
  tokensAvailable?: number | null
  tokenCooldown?: string | null
  nextTokenSeconds?: number | null
  stats?: MemberStatsSummary | null
}

export interface RosterHeroAbility {
  id?: string
  level?: number
}

export interface RosterHero {
  id: string
  name?: string
  engineId?: string | null
  category?: string | null
  faction?: string
  grandAlliance?: string
  progressionIndex?: number
  starLevel?: number
  xp?: number
  xpLevel?: number
  rank?: number
  active?: number
  passive?: number
  shards?: number
  mythicShards?: number
  abilities?: RosterHeroAbility[]
}

export type MachineOfWar = RosterHero
