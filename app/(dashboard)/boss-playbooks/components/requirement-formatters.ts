const ROMAN_TO_NUM: Record<string, string> = { I: '1', II: '2', III: '3' }

const TIER_ABBREV: Record<string, string> = {
  Stone: 'St',
  Iron: 'Ir',
  Bronze: 'Br',
  Silver: 'Si',
  Gold: 'G',
  Diamond: 'D',
  Adamantium: 'A',
  Mythic: 'M'
}

export const abbreviateRank = (rank: string | null): string => {
  if (!rank) return '-'
  const parts = rank.split(' ')
  if (parts.length !== 2) return rank
  const [tier = '', numeral = ''] = parts
  const tierPrefix = TIER_ABBREV[tier] ?? tier.charAt(0) ?? '-'
  const numeralSuffix = ROMAN_TO_NUM[numeral] ?? numeral ?? ''
  return `${tierPrefix}${numeralSuffix}`
}

export const formatAbilities = (
  active: number | null,
  passive: number | null,
  mythic?: number | null
): string => {
  const activeStr = active != null ? String(active) : '-'
  const passiveStr = passive != null ? String(passive) : '-'
  if (mythic != null) return `${activeStr}/${passiveStr}/${mythic}`
  return `${activeStr}/${passiveStr}`
}
