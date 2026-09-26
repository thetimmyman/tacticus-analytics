import type { getAllBossHp } from '@/app/lib/data/boss-hp'
import {
  BOSS_HP_BY_NAME,
  PRIME_HP_BY_BOSS
} from '@/app/lib/constants/tacticustable-boss-hp'
import { normalizeBossKey } from '@/app/lib/utils/bossNames'

export type BossHpData = Awaited<ReturnType<typeof getAllBossHp>>

const BOSS_HP_TABLE_KEYS = new Set<string>([
  ...Object.keys(BOSS_HP_BY_NAME),
  ...Object.keys(PRIME_HP_BY_BOSS)
])

const BOSS_HP_KEY_BY_NORMALIZED = (() => {
  const map: Record<string, string> = {}
  for (const key of BOSS_HP_TABLE_KEYS) {
    const normalized = normalizeBossKey(key)
    if (!normalized || map[normalized]) {
      continue
    }
    map[normalized] = key
  }

  const aliases: Record<string, string> = {
    avatarofkhaine: 'Avatar'
  }

  for (const [normalized, key] of Object.entries(aliases)) {
    if (map[normalized]) continue
    if (key in BOSS_HP_BY_NAME || key in PRIME_HP_BY_BOSS) {
      map[normalized] = key
    }
  }

  return map
})()

export function resolveBossHpKey(rawBossName: string): string | null {
  if (!rawBossName) return null

  if (rawBossName in BOSS_HP_BY_NAME || rawBossName in PRIME_HP_BY_BOSS) {
    return rawBossName
  }

  const normalized = normalizeBossKey(rawBossName)
  return normalized ? (BOSS_HP_KEY_BY_NORMALIZED[normalized] ?? null) : null
}

export function getMainBossMaxHp(
  bossHpData: BossHpData,
  rawBossName: string,
  stageCode: string
): number | null {
  const key = resolveBossHpKey(rawBossName)
  if (key) {
    const exact = bossHpData.byBossName[`${key}_${stageCode}`]
    if (typeof exact === 'number' && Number.isFinite(exact) && exact > 0) {
      return exact
    }
  }

  const fallback = stageCode.startsWith('M')
    ? bossHpData.mythic[stageCode]
    : bossHpData.legendary[stageCode]

  return typeof fallback === 'number' &&
    Number.isFinite(fallback) &&
    fallback > 0
    ? fallback
    : null
}

export function getPrimeBossMaxHp(
  bossHpData: BossHpData,
  rawMainBossName: string,
  stageCode: string,
  encounterId: 1 | 2
): number | null {
  const mainKey = resolveBossHpKey(rawMainBossName)
  if (!mainKey) return null

  const primeKey =
    encounterId === 1
      ? `${mainKey}_${stageCode}`
      : `${mainKey}_prime2_${stageCode}`

  const value = bossHpData.primes[primeKey]
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null
}
