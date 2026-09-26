const STRIPPABLE_BOSS_SUFFIXES = ['RW', 'Wing'] as const

function bossNameVariants(name: string): string[] {
  const variants = [name]
  for (const suffix of STRIPPABLE_BOSS_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      variants.push(name.slice(0, -suffix.length))
    }
  }
  return variants
}

/** Keyed by the MAIN boss type, not the prime's name. */
export function lookupPrimeBossHp(
  mainBossType: string,
  level: string,
  primes: Record<string, number>,
  encounterId: 1 | 2
): number {
  const suffix = encounterId === 2 ? `_prime2_${level}` : `_${level}`

  for (const variant of bossNameVariants(mainBossType)) {
    const compact = variant.replace(/\s+/g, '')
    const candidates = [
      variant + suffix,
      compact + suffix,
      compact.toLowerCase() + suffix,
      variant.toLowerCase() + suffix
    ]
    for (const candidate of candidates) {
      const hp = primes[candidate]
      if (typeof hp === 'number' && hp > 0) return hp
    }
  }

  const normalized = mainBossType.replace(/\s+/g, '').toLowerCase()
  const normalizedSuffix = suffix.toLowerCase()
  for (const key of Object.keys(primes)) {
    const normalizedKey = key.toLowerCase()
    if (!normalizedKey.endsWith(normalizedSuffix)) continue
    if (encounterId === 1 && normalizedKey.includes('_prime2_')) continue
    const stem = normalizedKey.slice(0, -normalizedSuffix.length)
    if (normalized.startsWith(stem) || stem.startsWith(normalized)) {
      const hp = primes[key]
      if (typeof hp === 'number' && hp > 0) return hp
    }
  }

  return 0
}
