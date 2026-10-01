import { BOSS_HP_BY_LEVEL, MYTHIC_BOSS_HP_BY_LEVEL } from '@/app/lib/config'
import {
  getMainBossMaxHp,
  getPrimeBossMaxHp
} from '@/app/lib/boss-assignments/season-planner/boss-hp'
import type { BossHpData, PerformanceData } from '../types'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

const normalizeBossHpName = (bossType: string): string => {
  if (bossType === 'AvatarOfKhaine') return 'Avatar'
  if (bossType === 'RogalDorn') return 'Rogaldorn'
  if (bossType === 'BelisariusRW') return 'Belisarius'
  return bossType
}

const normalizeBossNameForMatch = normalizeIdentifier

const getCanonicalBossHpNames = (bossHpData: BossHpData): string[] => {
  const names = new Set<string>()
  const byBossName = bossHpData?.byBossName
  if (!byBossName) return []

  Object.keys(byBossName).forEach((key) => {
    const match = key.match(/^(.*)_(M1|L[1-5])$/)
    if (match?.[1]) {
      names.add(match[1])
    }
  })

  return Array.from(names)
}

const resolveBossHpName = (
  bossType: string,
  bossHpData: BossHpData,
  level?: string
): string => {
  const normalizedBossType = normalizeBossHpName(bossType)
  const byBossName = bossHpData?.byBossName
  if (!byBossName) return normalizedBossType

  const bossTypeKey = normalizeBossNameForMatch(normalizedBossType)
  if (!bossTypeKey) return normalizedBossType

  const canonNames = getCanonicalBossHpNames(bossHpData)
  if (canonNames.length === 0) return normalizedBossType

  for (const candidate of canonNames) {
    if (normalizeBossNameForMatch(candidate) !== bossTypeKey) continue

    if (!level) return candidate
    const key = `${candidate}_${level}`
    const hp = byBossName[key]
    if (typeof hp === 'number' && hp > 0) {
      return candidate
    }
  }

  let bestMatch: { candidate: string; score: number } | null = null

  for (const candidate of canonNames) {
    const candidateKey = normalizeBossNameForMatch(candidate)
    if (!candidateKey) continue
    if (
      !bossTypeKey.includes(candidateKey) &&
      !candidateKey.includes(bossTypeKey)
    )
      continue

    if (level) {
      const key = `${candidate}_${level}`
      const hp = byBossName[key]
      if (!(typeof hp === 'number' && hp > 0)) continue
    }

    const score = candidateKey.length
    if (
      !bestMatch ||
      score > bestMatch.score ||
      (score === bestMatch.score &&
        candidate.localeCompare(bestMatch.candidate) < 0)
    ) {
      bestMatch = { candidate, score }
    }
  }

  return bestMatch ? bestMatch.candidate : normalizedBossType
}

export const getBossHpForLevel = (
  level: string,
  initialBossHpData: BossHpData,
  bossType?: string
): number => {
  if (bossType) {
    const canonical = getMainBossMaxHp(initialBossHpData, bossType, level)
    if (canonical !== null) return canonical

    // Fuzzy fallback for cases the canonical resolver misses.
    const resolvedBoss = resolveBossHpName(bossType, initialBossHpData, level)
    const byBossKey = `${resolvedBoss}_${level}`
    const byBossHp = initialBossHpData.byBossName[byBossKey]
    if (typeof byBossHp === 'number' && byBossHp > 0) {
      return byBossHp
    }
  }

  // Last resort: config.ts hardcoded averages.
  if (level.startsWith('M')) {
    return (
      initialBossHpData?.mythic?.[level] ||
      MYTHIC_BOSS_HP_BY_LEVEL[level as keyof typeof MYTHIC_BOSS_HP_BY_LEVEL] ||
      0
    )
  }
  return (
    initialBossHpData?.legendary?.[level] ||
    BOSS_HP_BY_LEVEL[level as keyof typeof BOSS_HP_BY_LEVEL] ||
    0
  )
}

export const getPrimeHpForLevel = (
  mainBossType: string,
  primeBossName: string | null | undefined,
  level: string,
  slot: 1 | 2,
  primeHpData: Record<string, number>,
  initialBossHpData: BossHpData
): number => {
  const encounterId = slot as 1 | 2
  const canonical = getPrimeBossMaxHp(
    initialBossHpData,
    mainBossType,
    level,
    encounterId
  )
  if (canonical !== null) return canonical

  const lookupLevels = level.startsWith('M')
    ? [level, level.replace(/^M/, 'L')]
    : [level]

  if (primeBossName) {
    const nameCandidates = Array.from(
      new Set([
        primeBossName,
        primeBossName.replace(/\u2019/g, "'"),
        primeBossName.replace(/'/g, '\u2019')
      ])
    )

    for (const name of nameCandidates) {
      for (const lookupLevel of lookupLevels) {
        const key = `${name}_${lookupLevel}`
        const fromMerged = primeHpData?.[key]
        if (typeof fromMerged === 'number' && fromMerged > 0) {
          return fromMerged
        }
      }
    }
  }

  const resolvedBoss = resolveBossHpName(mainBossType, initialBossHpData, level)
  const directKey =
    slot === 1 ? `${resolvedBoss}_${level}` : `${resolvedBoss}_prime2_${level}`

  const fallbackLevel = level.startsWith('M') ? level.replace(/^M/, 'L') : null
  const fallbackKey = fallbackLevel
    ? slot === 1
      ? `${resolvedBoss}_${fallbackLevel}`
      : `${resolvedBoss}_prime2_${fallbackLevel}`
    : null

  const candidates = [directKey, fallbackKey].filter(Boolean) as string[]

  for (const key of candidates) {
    const fromMerged = primeHpData?.[key]
    if (typeof fromMerged === 'number' && fromMerged > 0) {
      return fromMerged
    }
    const fromInitial = initialBossHpData?.primes?.[key]
    if (typeof fromInitial === 'number' && fromInitial > 0) {
      return fromInitial
    }
  }

  return 0
}

export const getAverageDamageForBoss = (
  bossName: string,
  level: string | undefined,
  performanceData: PerformanceData
): number => {
  if (!bossName || !performanceData) return 0

  const bossKeyWithLevel = level ? `${bossName}_${level}` : null

  let totalDamage = 0
  let playerCount = 0

  Object.values(performanceData).forEach((bosses) => {
    const bossData =
      (bossKeyWithLevel ? bosses[bossKeyWithLevel] : undefined) ||
      bosses[bossName]
    if (bossData?.average_damage && bossData.average_damage > 0) {
      totalDamage += bossData.average_damage
      playerCount++
    }
  })

  return playerCount > 0 ? totalDamage / playerCount : 0
}
