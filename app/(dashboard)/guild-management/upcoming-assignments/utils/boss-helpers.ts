import type { Rarity } from '@/app/lib/config'
import { getRarityPrefix } from '@tacticus/app-core/rarity-utils'

export const parseBossPreferences = (raw: unknown): Record<string, string> => {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, string>
      }
    } catch {
      return {}
    }
  }
  if (typeof raw === 'object') {
    return raw as Record<string, string>
  }
  return {}
}

/** Display order: highest first (UI lists and Discord). */
export const BOSS_DISPLAY_ORDER = [
  'M5',
  'M4',
  'M3',
  'M2',
  'M1',
  'L5',
  'L4',
  'L3',
  'L2',
  'L1'
] as const

type BossLevel = (typeof BOSS_DISPLAY_ORDER)[number]

export const getBossDisplayIndex = (level: string): number => {
  return BOSS_DISPLAY_ORDER.indexOf(level as BossLevel)
}

export const sortLevelsByPriority = (
  levels: string[],
  selectedRarities: Rarity[]
): string[] => {
  return [...levels].sort((a, b) => {
    const prefixA = a.charAt(0)
    const prefixB = b.charAt(0)

    const rarityA = selectedRarities.find((r) => getRarityPrefix(r) === prefixA)
    const rarityB = selectedRarities.find((r) => getRarityPrefix(r) === prefixB)

    if (rarityA && rarityB && rarityA !== rarityB) {
      const aIndex = selectedRarities.indexOf(rarityA)
      const bIndex = selectedRarities.indexOf(rarityB)
      return aIndex - bIndex
    }

    const numA = parseInt(a.substring(1))
    const numB = parseInt(b.substring(1))
    return numB - numA
  })
}

export { bossNamesMatch } from '@/app/lib/utils/normalize'
