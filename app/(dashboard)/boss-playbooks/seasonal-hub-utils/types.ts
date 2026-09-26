export type SeasonalHubRarity = 'Mythic' | 'Legendary'

export type SeasonalHubReplayRow = {
  id: string
  boss_id: string | null
  title: string | null
  difficulty: string | null
  rarity_set: string | null
  map_id: string | null
  damage: number | null
  units: string[] | null
  season: string | number | null
  is_featured: boolean | null
  created_at: string | null
  video_type?: string | null
  video_url?: string | null
  visibility?: string | null
  tags?: string[] | null
  // Preferred over tags/title; REPLAY_SELECT must fetch it.
  encounter_role?: string | null
}

export type SeasonalHubBossMappingRow = {
  boss_type: string | null
  encounter_index: number | null
  boss_name: string | null
  asset_slug?: string | null
  portrait_path?: string | null
  icon_path?: string | null
  thumbnail_path?: string | null
}

export type SeasonalHubReplay = {
  id: string
  title: string
  damage: number | null
  units: string[]
  season: string | null
  isFeatured: boolean
  isPinnedByGuild: boolean
  href: string
  // Lets an editor lazy-fetch the full replay.
  playbookId: string
  mediaHref: string | null
  visibility: string | null
}

export type SeasonalHubBattleLoopTokens = {
  loopIndex: number
  tokens: number
}

export type SeasonalHubBattleMetrics = {
  averageDamage: number | null
  totalDamage: number
  sampleCount: number
  totalTokens: number
  tokensByLoop: SeasonalHubBattleLoopTokens[]
}

export type SeasonalHubTargetToken = {
  targetTokens: number
  skip: boolean
  source: string | null
}

export type SeasonalHubMetaAtlasTeam = {
  teamHash: string | null
  teamComposition: string | null
  metaTeam: string | null
  raritySet: string | null
  units: string[]
  damageP90: number | null
  damageP75: number | null
  damageAvg: number | null
  attackCount: number | null
  season: string | null
}

export const metaAtlasBenchmarkDamage = (
  team: SeasonalHubMetaAtlasTeam | null | undefined
): number | null =>
  team?.damageP90 ?? team?.damageP75 ?? team?.damageAvg ?? null

export type SeasonalHubReplayLinkMode =
  'inherit' | 'off' | 'pinned' | 'featured' | 'all'

export type SeasonalHubExtraLink = {
  label: string
  url: string
}

export type { OpsRoleEntry as SeasonalHubRoleEntry } from '@/app/components/boss-ops/types'

export type SeasonalHubHeraldConfig = {
  discordRoleIds: string[]
  discordRoleLabels: Record<string, string>
  notes: string | null
  side1Notes: string | null
  side2Notes: string | null
  pingMode: 'combined' | 'per_side' | 'skip_all' | null
  replayLinkMode: SeasonalHubReplayLinkMode
  replayAutoCount: number
  extraLinks?: SeasonalHubExtraLink[]
  customMessageUrl?: string | null
}

export type SeasonalHubSeasonOps = {
  pingMode: 'combined' | 'per_side' | 'skip_all' | null
  // string wins; `null` = cleared; `undefined` = fall back (`resolveNoteOverride`).
  mainNotes: string | null | undefined
  side1Notes: string | null | undefined
  side2Notes: string | null | undefined
  side1Behaviour: 'skip' | 'kill' | 'threshold'
  side2Behaviour: 'skip' | 'kill' | 'threshold'
  side1ThresholdHpPct: number | null
  side2ThresholdHpPct: number | null
}

export type SeasonalEncounterData = {
  key: string
  bossId: string
  bossType: string
  encounterIndex: number
  encounterType: string | null
  bossName: string
  portraitLookupName: string
  boardId: string
  boardLabel: string
  mapImageUrl: string | null
  topTeamUnits: string[]
  topDamage: number | null
  metaAtlasTopTeam: SeasonalHubMetaAtlasTeam | null
  replayCount: number
  topReplays: SeasonalHubReplay[]
  availableReplayCount: number
  metaAtlasBenchmarkRank: number | null
  replaysAboveMetaAtlasBenchmark: number
  battleMetrics: SeasonalHubBattleMetrics | null
  targetToken: SeasonalHubTargetToken | null
  roleIds: string[]
  roleLabels: Record<string, string>
  notes: string | null
  replayLinkMode: SeasonalHubReplayLinkMode
  replayAutoCount: number
  extraLinks: SeasonalHubExtraLink[]
  customMessageUrl: string | null
  wikiUrl: string | null
  tacticusTableUrl: string | null
  behaviour: 'skip' | 'kill' | 'threshold'
  thresholdHpPct: number | null
}

export type SeasonalBossCardData = {
  key: string
  bossType: string
  bossName: string
  portraitLookupName: string
  playbookId: string
  playbookName: string
  playbookHref: string
  seasonNumber: number
  rarity: SeasonalHubRarity
  setNumber: number
  difficultyCode: string
  boardId: string
  boardLabel: string
  mapImageUrl: string | null
  topTeamUnits: string[]
  topDamage: number | null
  metaAtlasTopTeam: SeasonalHubMetaAtlasTeam | null
  replayCount: number
  topReplays: SeasonalHubReplay[]
  mainEncounter: SeasonalEncounterData
  sideEncounters: SeasonalEncounterData[]
  battleMetrics: SeasonalHubBattleMetrics | null
  targetToken: SeasonalHubTargetToken | null
  roleIds: string[]
  seasonOps: SeasonalHubSeasonOps | null
}

export type SeasonalBossGroupData = {
  rarity: SeasonalHubRarity
  cards: SeasonalBossCardData[]
}

export type SeasonalHubSeasonOption = {
  value: string
  seasonNumber: number
  label: string
  offset: number
  isCurrent: boolean
  available: boolean
}

export type SeasonalBossHubSeasonData = {
  seasonNumber: number
  configId: string
  capturedAt: string | null
  groups: SeasonalBossGroupData[]
}

export type SeasonalBossHubData = {
  seasonNumber: number
  configId: string
  capturedAt: string | null
  groups: SeasonalBossGroupData[]
  currentSeasonNumber?: number
  seasonOptions?: SeasonalHubSeasonOption[]
  seasonsByNumber?: Record<string, SeasonalBossHubSeasonData>
  guildCode?: string | null
  canManageHerald?: boolean
  canManageTargets?: boolean
  guildReplayLinkMode?: Exclude<SeasonalHubReplayLinkMode, 'inherit'>
  /**
   * Loaders errored (they return `{}`, which looks like a fresh guild). Consumers MUST disable
   * ops controls, or one save would blank real config.
   */
  opsLoadFailed?: boolean
}
