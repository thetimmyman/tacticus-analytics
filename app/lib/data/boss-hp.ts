import {
  BOSS_HP_BY_LEVEL_TACTICUSTABLE,
  MYTHIC_BOSS_HP_BY_LEVEL_TACTICUSTABLE,
  BOSS_HP_BY_NAME,
  PRIME_HP_BY_BOSS
} from '@/app/lib/constants/tacticustable-boss-hp'

export async function getAllBossHp(_guildCode?: string): Promise<{
  legendary: Record<string, number>
  mythic: Record<string, number>
  primes: Record<string, number>
  byBossName: Record<string, number>
}> {
  const legendary: Record<string, number> = {
    ...BOSS_HP_BY_LEVEL_TACTICUSTABLE
  }
  const mythic: Record<string, number> = {
    ...MYTHIC_BOSS_HP_BY_LEVEL_TACTICUSTABLE
  }
  const primes: Record<string, number> = {}
  const byBossName: Record<string, number> = {}

  // Stored names vary in spacing and casing; exact-match-only keys silently drop bosses.
  const writeVariants = (name: string, level: string | null, hp: number) => {
    const variants = new Set<string>()
    variants.add(name)
    variants.add(name.toLowerCase())
    variants.add(name.replace(/\s+/g, ''))
    variants.add(name.replace(/\s+/g, '').toLowerCase())
    for (const v of variants) {
      if (level) byBossName[`${v}_${level}`] = hp
      byBossName[v] = hp
    }
  }

  for (const [bossName, levelData] of Object.entries(BOSS_HP_BY_NAME)) {
    for (const [level, hp] of Object.entries(levelData)) {
      writeVariants(bossName, level, hp)
    }
  }

  for (const [bossName, levelData] of Object.entries(PRIME_HP_BY_BOSS)) {
    for (const [level, primeHp] of Object.entries(levelData)) {
      if (primeHp.prime1) {
        primes[`${bossName}_${level}`] = primeHp.prime1
      }
      if (primeHp.prime2) {
        primes[`${bossName}_prime2_${level}`] = primeHp.prime2
      }
    }
  }

  return { legendary, mythic, primes, byBossName }
}

const STRIPPABLE_BOSS_NAME_SUFFIXES = ['RW', 'Wing']

function stripSuffixVariants(name: string): string[] {
  const variants = [name]
  for (const suffix of STRIPPABLE_BOSS_NAME_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      variants.push(name.slice(0, -suffix.length))
    }
  }
  return variants
}

/** Leveled keys MUST precede bare-name ones: the bare key holds L1 HP and inflates scores. */
export function lookupBossHpByName(
  name: string,
  bossKey: string,
  byBossName: Record<string, number>
): number {
  const levelMatch = bossKey.match(/_([ML]\d+)$/)
  const level = levelMatch ? levelMatch[1] : null

  for (const variant of stripSuffixVariants(name)) {
    const candidates: string[] = [bossKey]
    if (level) {
      candidates.push(
        `${variant}_${level}`,
        `${variant.toLowerCase()}_${level}`,
        `${variant.replace(/\s+/g, '')}_${level}`,
        `${variant.replace(/\s+/g, '').toLowerCase()}_${level}`
      )
    }
    candidates.push(
      variant,
      variant.toLowerCase(),
      variant.replace(/\s+/g, ''),
      variant.replace(/\s+/g, '').toLowerCase()
    )
    for (const candidate of candidates) {
      const hp = byBossName[candidate]
      if (typeof hp === 'number' && hp > 0) return hp
    }
  }

  const normalizedName = name.replace(/\s+/g, '').toLowerCase()
  if (level) {
    const suffix = `_${level}`
    for (const key of Object.keys(byBossName)) {
      if (!key.endsWith(suffix)) continue
      const stem = key.slice(0, -suffix.length).toLowerCase()
      if (normalizedName.startsWith(stem) || stem.startsWith(normalizedName)) {
        const hp = byBossName[key]
        if (typeof hp === 'number' && hp > 0) return hp
      }
    }
  }
  for (const key of Object.keys(byBossName)) {
    if (key.includes('_')) continue
    const normalizedKey = key.toLowerCase()
    if (
      normalizedName.startsWith(normalizedKey) ||
      normalizedKey.startsWith(normalizedName)
    ) {
      const hp = byBossName[key]
      if (typeof hp === 'number' && hp > 0) return hp
    }
  }
  return 0
}
