import { normalizeKey } from './resolve'
import { parseSeasonNoteField } from '@/app/lib/boss-ops/season-note-field'
import type {
  SeasonalHubRarity,
  SeasonalHubSeasonOps,
  SeasonalHubTargetToken
} from './types'

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

const normalizeSideBehaviour = (
  skipped: boolean,
  threshold: number | null
): 'skip' | 'kill' | 'threshold' => {
  if (skipped) return 'skip'
  if (typeof threshold === 'number' && threshold > 0) return 'threshold'
  return 'kill'
}

/** Single source of skip/kill/threshold semantics for `upcoming_season_bosses.sub_bosses`. */
export function parseSeasonOpsSubBosses(
  rawSubBosses: unknown
): SeasonalHubSeasonOps {
  const subBosses =
    typeof rawSubBosses === 'string'
      ? (JSON.parse(rawSubBosses || '{}') as Record<string, unknown>)
      : rawSubBosses && typeof rawSubBosses === 'object'
        ? (rawSubBosses as Record<string, unknown>)
        : {}

  const readThreshold = (key: string) => {
    const raw = subBosses[key]
    const value =
      typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''))
    return Number.isFinite(value) && value > 0 ? value : null
  }
  const side1Threshold = readThreshold('sub1_kill_threshold_pct')
  const side2Threshold = readThreshold('sub2_kill_threshold_pct')
  const pingMode =
    subBosses.ping_mode === 'combined' ||
    subBosses.ping_mode === 'per_side' ||
    subBosses.ping_mode === 'skip_all'
      ? subBosses.ping_mode
      : null

  return {
    pingMode,
    mainNotes: parseSeasonNoteField(subBosses.main_notes),
    side1Notes: parseSeasonNoteField(subBosses.side1_notes),
    side2Notes: parseSeasonNoteField(subBosses.side2_notes),
    side1Behaviour: normalizeSideBehaviour(
      subBosses.sub1_skip === true,
      side1Threshold
    ),
    side2Behaviour: normalizeSideBehaviour(
      subBosses.sub2_skip === true,
      side2Threshold
    ),
    side1ThresholdHpPct: side1Threshold,
    side2ThresholdHpPct: side2Threshold
  }
}

// For sibling modules only (ranking.ts); not in the barrel.
export { GROUP_ORDER, RARITY_BY_INDEX }
