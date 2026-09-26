// Strips difficulty prefixes ('m2-szarekh') like the hub matcher so stored keys match.
import { stripNonAlnumLower } from '@/app/lib/resolvers/boss-identity'
import { normalizeBossKey } from '@/app/lib/utils/bossNames'

export const canonicalGuildPinBossKey = (
  value: string | null | undefined
): string => {
  const cleaned = stripNonAlnumLower(value)
  if (!cleaned) return ''
  const deprefixed = cleaned.replace(/^(?:m|l)\d+/, '')
  return normalizeBossKey(deprefixed || cleaned)
}
