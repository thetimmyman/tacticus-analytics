import type { ManualOverridePrime } from '@/app/lib/herald/engine'

// Main-boss boss_id (_E0) only; primes come from the `prime` body field.
export const MAIN_BOSS_ID_REGEX = /^[A-Za-z][A-Za-z0-9]*_E0$/

export const DEDUP_WINDOW_MS = 30_000

export const parsePrime = (raw: unknown): ManualOverridePrime | null => {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === 'a' || trimmed === 'prime_a' || trimmed === 'left') return 'a'
  if (trimmed === 'b' || trimmed === 'prime_b' || trimmed === 'right')
    return 'b'
  return null
}

export const computePrimeBossId = (
  mainBossId: string,
  prime: ManualOverridePrime
): string => {
  const encounterIndex = prime === 'a' ? 1 : 2
  return mainBossId.replace(/_E\d+$/, `_E${encounterIndex}`)
}

export const __testing = {
  DEDUP_WINDOW_MS,
  MAIN_BOSS_ID_REGEX,
  computePrimeBossId
}
