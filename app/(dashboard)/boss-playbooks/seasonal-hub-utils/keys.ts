import { normalizeKey } from './resolve'
import type { SeasonalHubRarity, SeasonalHubTargetToken } from './types'

const RARITY_BY_INDEX: Record<number, SeasonalHubRarity | null> = {
  4: 'Legendary',
  5: 'Mythic'
}

const GROUP_ORDER: SeasonalHubRarity[] = ['Mythic', 'Legendary']

export const seasonalTargetTokenKey = ({
  bossType,
  rarity,
  setNumber,
  encounterIndex
}: {
  bossType: string
  rarity: SeasonalHubRarity
  setNumber: number
  encounterIndex: number
}) => `${bossType}__${rarity}__${setNumber + 1}__${encounterIndex}`

// Per-season key; '' is the legacy cross-season row, used until a season row exists.
export const seasonalTargetTokenSeasonKey = (
  seasonNumber: number | string | null | undefined,
  slotKey: string
) =>
  `${seasonNumber === null || seasonNumber === undefined ? '' : String(seasonNumber)}::${slotKey}`

export const resolveSeasonalTargetToken = (
  map: Record<string, SeasonalHubTargetToken>,
  seasonNumber: number | string,
  slotKey: string
): SeasonalHubTargetToken | null =>
  map[seasonalTargetTokenSeasonKey(seasonNumber, slotKey)] ??
  map[seasonalTargetTokenSeasonKey('', slotKey)] ??
  null

export const seasonalBattleMetricKey = ({
  rarity,
  setNumber,
  encounterIndex
}: {
  rarity: SeasonalHubRarity
  setNumber: number
  encounterIndex: number
}) => `${rarity}__${setNumber}__${encounterIndex}`

export const seasonalMetaAtlasTeamKey = ({
  bossType,
  raritySet,
  encounterIndex
}: {
  bossType: string
  raritySet: string
  encounterIndex: number
}) => `${normalizeKey(bossType)}__${raritySet}__${encounterIndex}`

export const seasonalOpsKey = ({
  seasonNumber,
  difficultyCode
}: {
  seasonNumber: number
  difficultyCode: string
}) => `${seasonNumber}__${difficultyCode}`

// For sibling modules only (ranking.ts); not in the barrel.
export { GROUP_ORDER, RARITY_BY_INDEX }
