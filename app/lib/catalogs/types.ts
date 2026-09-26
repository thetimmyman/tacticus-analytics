export type CatalogHeroCategory = 'hero' | 'mow' | 'unknown'

export interface CatalogHero {
  unitId: string
  displayName: string
  faction: string
  alliance?: string
  traits: string[]
  iconUrl: string
  portraitUrl?: string
  category: CatalogHeroCategory
  engineId?: string
  dbId?: number
  discordEmoji?: string
}

export type BossPortraitVariant = 'portrait' | 'icon' | 'thumbnail'

export interface CatalogBossTier {
  tier: string
  health: number
  damage: number
  armor: number
}

export interface CatalogBossBoard {
  id: string
  name: string
  imageUrl?: string
}

export interface CatalogBossPrime {
  bossId: string
  displayName: string
  encounterIndex: number
  unitId?: string
  /** Prime-specific art; never substitute the parent boss portrait. */
  portraits?: CatalogBossPortraits
}

export interface CatalogBossPortraits {
  icon: string
  thumbnail: string
  portrait: string
}

export interface CatalogBoss {
  bossId: string
  displayName: string
  faction: string
  bannedFaction?: string
  turnLimit: number
  setNumber: number
  portraits: CatalogBossPortraits
  traits?: string[]
  tiers: CatalogBossTier[]
  boards: CatalogBossBoard[]
  bossType?: string
  encounterIndex?: number
  unitId?: string
  primes?: CatalogBossPrime[]
}
