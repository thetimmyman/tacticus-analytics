import type { Boss } from './types'
import {
  generatedBossOptions,
  generatedBossTraitsByLookupKey
} from './boss-presentation.generated'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

const bossTraitsByLookupKey: Record<string, readonly string[]> =
  generatedBossTraitsByLookupKey

const normalizeBossTraitLookupKey = normalizeIdentifier

export function resolveBossTraits(
  ...candidates: Array<string | null | undefined>
): string[] {
  for (const candidate of candidates) {
    const key = normalizeBossTraitLookupKey(candidate)
    if (!key) continue
    const traits = bossTraitsByLookupKey[key]
    if (traits) return [...traits]
  }

  for (const candidate of candidates) {
    const key = normalizeBossTraitLookupKey(candidate)
    if (!key) continue
    const match = Object.entries(bossTraitsByLookupKey).find(
      ([lookupKey]) => lookupKey.length > 5 && key.includes(lookupKey)
    )
    if (match) return [...match[1]]
  }

  return ['Boss']
}

export const REAL_BOSS_OPTIONS: Boss[] = generatedBossOptions
