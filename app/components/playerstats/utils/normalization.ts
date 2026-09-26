import type { BossStatDetail } from '@/app/components/playerstats/types'
import { normalizeText, normalizeBossName } from '@/app/lib/utils/normalize'

export { normalizeText }

export const resolveBossKey = (
  collection: Record<string, BossStatDetail> | undefined,
  candidate: string
): string | undefined => {
  if (!collection) return undefined
  if (collection[candidate]) return candidate

  const parts = candidate.split('_')
  const candidateName = normalizeBossName(parts[0])
  const candidateRarity = parts[1] || ''
  const candidateSet = parts[2] || ''

  const found = Object.keys(collection).find((key) => {
    const kParts = key.split('_')
    if (normalizeBossName(kParts[0]) !== candidateName) return false
    if (candidateRarity && kParts[1] && kParts[1] !== candidateRarity)
      return false
    if (candidateSet && kParts[2] && kParts[2] !== candidateSet) return false
    return true
  })

  return found
}
