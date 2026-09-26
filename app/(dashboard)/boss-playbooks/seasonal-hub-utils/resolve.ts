import { difficultyCodeFromOneBasedSet } from '@/app/lib/boss-ops/identity'
import { getBossDisplayName, normalizeBossKey } from '@/app/lib/utils/bossNames'
import type { Boss } from '../types'
import type { SeasonalHubBossMappingRow, SeasonalHubRarity } from './types'

const TACTICUS_TABLE_BASE_URL = 'https://www.tacticustable.com/guild-boss'

const FALLBACK_MAIN_BOSS_IDENTITY: Record<
  string,
  { bossName: string; portraitLookupName: string }
> = {
  silentking: {
    bossName: 'Szarekh',
    portraitLookupName: 'silentking_main'
  }
}

const normalizeKey = (value: string | null | undefined) => {
  const raw = (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (!raw) return ''
  const cleaned = raw.replace(/^(?:m|l)\d+/, '')
  if (!cleaned) return raw
  if (cleaned.startsWith('tervigon')) return cleaned
  if (cleaned.startsWith('hivetyrant')) return cleaned
  // `cleaned` matches /^[a-z0-9]+$/ here, so this always returns.
  const shared = normalizeBossKey(cleaned)
  if (shared) return shared
  return cleaned
}

const buildPlaybookLookup = (bosses: Boss[]) => {
  const lookup = new Map<string, Boss>()
  bosses.forEach((boss) => {
    lookup.set(normalizeKey(boss.id), boss)
    lookup.set(normalizeKey(boss.name), boss)
  })
  return lookup
}

const buildBossMappingLookup = (rows: SeasonalHubBossMappingRow[] = []) => {
  const lookup = new Map<string, SeasonalHubBossMappingRow>()
  rows.forEach((row) => {
    const bossKey = normalizeKey(row.boss_type)
    if (!bossKey) return
    lookup.set(`${bossKey}|${row.encounter_index ?? 0}`, row)
  })
  return lookup
}

const bossDisplayNameForEncounter = ({
  bossType,
  encounterIndex,
  mappedName,
  fallbackName
}: {
  bossType: string
  encounterIndex: number
  mappedName?: string | null
  fallbackName?: string | null
}) => {
  const normalized = normalizeKey(bossType)
  if (encounterIndex === 0 && normalized === 'silentking') return 'Szarekh'
  const mapped = mappedName?.trim()
  if (mapped) return mapped
  const display = getBossDisplayName(bossType)
  if (display && display !== 'Unknown Boss') return display
  return fallbackName?.trim() || bossType
}

const portraitLookupNameForEncounter = ({
  bossType,
  encounterIndex,
  mappedAssetSlug,
  mappedName,
  fallbackLookupName
}: {
  bossType: string
  encounterIndex: number
  mappedAssetSlug?: string | null
  mappedName?: string | null
  fallbackLookupName?: string | null
}) => {
  const mapped = mappedAssetSlug?.trim()
  if (mapped) return mapped
  if (encounterIndex === 0) {
    const fallback = FALLBACK_MAIN_BOSS_IDENTITY[normalizeKey(bossType)]
    if (fallback) return fallback.portraitLookupName
  }
  return fallbackLookupName || mappedName?.trim() || bossType
}

const resolvePlaybook = (
  lookup: Map<string, Boss>,
  bossType: string
): Boss | null => {
  const candidates = [
    bossType,
    bossType.replace(/(Leviathan|Gorgon|Kronos)$/i, '-$1')
  ]

  for (const candidate of candidates) {
    const exact = lookup.get(normalizeKey(candidate))
    if (exact) return exact
  }

  const normalized = normalizeKey(bossType)
  for (const [key, boss] of lookup.entries()) {
    if (normalized.startsWith(key) || key.startsWith(normalized)) return boss
  }

  return null
}

// "Map 02" badges; MapsBoardsSection's formatBoardLabel makes gallery labels.
export const formatBoardLabel = (boardId: string | null | undefined) => {
  const raw = (boardId ?? '').trim()
  if (!raw) return 'Map'
  const match = raw.match(/_(\d+)$/)
  if (match?.[1]) return `Map ${match[1].padStart(2, '0')}`
  return raw.replace(/^GB_/, '').replace(/_/g, ' ')
}

// The hub's `set` is 0-based; shift it before the 1-based canonical helper.
const difficultyCodeFor = (rarity: SeasonalHubRarity, set: number) =>
  difficultyCodeFromOneBasedSet(rarity, set + 1)

const normalizeDifficulty = (value: string | null | undefined) =>
  (value ?? '').replace(/\s+/g, '').toUpperCase()

const extractDifficultyCode = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const match = (value ?? '').match(/\b([ML])\s*([1-5])\b/i)
    if (match?.[1] && match?.[2]) {
      return `${match[1].toUpperCase()}${match[2]}`
    }
    const normalized = normalizeDifficulty(value)
    if (/^[ML][1-5]$/.test(normalized)) return normalized
  }
  return ''
}

const normalizeBoard = (value: string | null | undefined) =>
  (value ?? '').trim().toLowerCase()

const boardImageFallbackUrl = (boardId: string, playbookId: string) =>
  `/api/battle/board-image?board=${encodeURIComponent(boardId)}&boss=${encodeURIComponent(playbookId)}`

const tacticusTableUrlFor = (
  boss: Boss,
  encounterIndex: number
): string | null => {
  const ids = boss.tacticusTableIds
  if (!ids) return null
  const id =
    encounterIndex === 0
      ? ids.boss
      : encounterIndex === 1
        ? ids.prime1
        : ids.prime2
  return id ? `${TACTICUS_TABLE_BASE_URL}/${id}` : null
}

const normalizeSeason = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const extractMapNumber = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const raw = value ?? ''
    const match =
      raw.match(/\bmap\s*0?(\d{1,2})\b/i) ??
      raw.match(/\bGB_[A-Za-z0-9]+(?:_support)?_0?(\d{1,2})\b/i) ??
      raw.match(/_0?(\d{1,2})\b/)
    if (match?.[1]) return match[1].padStart(2, '0')
  }
  return ''
}

// For sibling modules only; the barrel re-exports just formatBoardLabel.
export {
  boardImageFallbackUrl,
  bossDisplayNameForEncounter,
  buildBossMappingLookup,
  buildPlaybookLookup,
  difficultyCodeFor,
  extractDifficultyCode,
  extractMapNumber,
  normalizeBoard,
  normalizeKey,
  normalizeSeason,
  portraitLookupNameForEncounter,
  resolvePlaybook,
  tacticusTableUrlFor
}
