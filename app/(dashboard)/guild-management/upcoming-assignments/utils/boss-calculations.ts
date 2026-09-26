import { BOSS_HP_BY_LEVEL, MYTHIC_BOSS_HP_BY_LEVEL } from '@/app/lib/config'
import {
  getMainBossMaxHp,
  getPrimeBossMaxHp
} from '@/app/lib/boss-assignments/season-planner/boss-hp'
import type {
  BossHpData,
  PerformanceData,
  AssignmentData,
  PlayerTokenAllocations,
  PlayerAssignment
} from '../types'
import { getBossDisplayIndex } from './boss-helpers'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

const DEFAULT_AVG_DAMAGE = 750000

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

export const calculateRequiredTokens = (
  level: string,
  bossName: string,
  performanceData: PerformanceData,
  initialBossHpData: BossHpData
): number => {
  const bossHp = getBossHpForLevel(level, initialBossHpData, bossName)
  if (!bossHp || !bossName || !performanceData) {
    return 0
  }

  const avgDamagePerPlayer =
    getAverageDamageForBoss(bossName, level, performanceData) ||
    DEFAULT_AVG_DAMAGE
  return Math.max(1, Math.ceil(bossHp / avgDamagePerPlayer))
}

export const getAssignmentData = (
  selectedBosses: Record<string, string>,
  selectedSubBosses: Record<string, string>,
  skippedPrimes: Record<string, boolean>,
  players: PlayerAssignment[],
  playerTokenAllocations: PlayerTokenAllocations,
  performanceData: PerformanceData,
  primeHpData: Record<string, number>,
  initialBossHpData: BossHpData,
  primaryTokenValue: number,
  secondaryTokenValue: number
): Record<string, AssignmentData> => {
  const data: Record<string, AssignmentData> = {}

  const isEncounterKey = (key: string) => /^([ML][1-5])(_Sub[12])?$/.test(key)
  const targetRank = (targetId: string) => {
    const baseLevel = targetId.split('_')[0] ?? ''
    const baseIndex = getBossDisplayIndex(baseLevel)
    const levelIndex = baseIndex === -1 ? 99 : baseIndex
    const isPrime = targetId.includes('_Sub')
    const slot = targetId.endsWith('Sub2')
      ? 2
      : targetId.endsWith('Sub1')
        ? 1
        : 0
    return levelIndex * 10 + (isPrime ? 5 : 0) + slot
  }

  const safePrimaryTokenValue = Math.max(1, primaryTokenValue || 1)
  const safeSecondaryTokenValue = Math.max(1, secondaryTokenValue || 1)

  const bossNameToTargets: Record<string, string[]> = {}

  Object.entries(selectedBosses).forEach(([level, boss]) => {
    if (!boss) return
    bossNameToTargets[boss] = [...(bossNameToTargets[boss] || []), level]

    const bossHp = getBossHpForLevel(level, initialBossHpData, boss)
    const avgDamage = getAverageDamageForBoss(boss, level, performanceData)
    const effectiveAvgDamage = avgDamage || DEFAULT_AVG_DAMAGE
    const requiredTokens =
      bossHp > 0 ? Math.max(1, Math.ceil(bossHp / effectiveAvgDamage)) : 0
    const requiredPrimary = Math.floor(requiredTokens / safePrimaryTokenValue)
    const remainderTokens = requiredTokens % safePrimaryTokenValue
    const requiredSecondary =
      remainderTokens > 0
        ? Math.ceil(remainderTokens / safeSecondaryTokenValue)
        : 0

    data[level] = {
      primary: 0,
      secondary: 0,
      primaryTokens: 0,
      secondaryTokens: 0,
      totalTokens: 0,
      requiredTokens,
      requiredPrimary,
      requiredSecondary,
      level,
      avgDamage: effectiveAvgDamage
    }

    const prime1Key = `${level}_Sub1`
    const prime2Key = `${level}_Sub2`

    const prime1Name = selectedSubBosses[prime1Key]
    const prime2Name = selectedSubBosses[prime2Key]

    if (prime1Name && !skippedPrimes[prime1Key]) {
      bossNameToTargets[prime1Name] = [
        ...(bossNameToTargets[prime1Name] || []),
        prime1Key
      ]
      const primeHp = getPrimeHpForLevel(
        boss,
        prime1Name,
        level,
        1,
        primeHpData,
        initialBossHpData
      )
      const primeAvgDamage = getAverageDamageForBoss(
        prime1Name,
        level,
        performanceData
      )
      const effectivePrimeAvgDamage = primeAvgDamage || DEFAULT_AVG_DAMAGE
      const primeRequired =
        primeHp > 0
          ? Math.max(1, Math.ceil(primeHp / effectivePrimeAvgDamage))
          : 0
      const requiredPrimary = Math.floor(primeRequired / safePrimaryTokenValue)
      const remainderTokens = primeRequired % safePrimaryTokenValue
      const requiredSecondary =
        remainderTokens > 0
          ? Math.ceil(remainderTokens / safeSecondaryTokenValue)
          : 0

      data[prime1Key] = {
        primary: 0,
        secondary: 0,
        primaryTokens: 0,
        secondaryTokens: 0,
        totalTokens: 0,
        requiredTokens: primeRequired,
        requiredPrimary,
        requiredSecondary,
        level,
        avgDamage: effectivePrimeAvgDamage,
        isPrime: true
      }
    }

    if (prime2Name && !skippedPrimes[prime2Key]) {
      bossNameToTargets[prime2Name] = [
        ...(bossNameToTargets[prime2Name] || []),
        prime2Key
      ]
      const primeHp = getPrimeHpForLevel(
        boss,
        prime2Name,
        level,
        2,
        primeHpData,
        initialBossHpData
      )
      const primeAvgDamage = getAverageDamageForBoss(
        prime2Name,
        level,
        performanceData
      )
      const effectivePrimeAvgDamage = primeAvgDamage || DEFAULT_AVG_DAMAGE
      const primeRequired =
        primeHp > 0
          ? Math.max(1, Math.ceil(primeHp / effectivePrimeAvgDamage))
          : 0
      const requiredPrimary = Math.floor(primeRequired / safePrimaryTokenValue)
      const remainderTokens = primeRequired % safePrimaryTokenValue
      const requiredSecondary =
        remainderTokens > 0
          ? Math.ceil(remainderTokens / safeSecondaryTokenValue)
          : 0

      data[prime2Key] = {
        primary: 0,
        secondary: 0,
        primaryTokens: 0,
        secondaryTokens: 0,
        totalTokens: 0,
        requiredTokens: primeRequired,
        requiredPrimary,
        requiredSecondary,
        level,
        avgDamage: effectivePrimeAvgDamage,
        isPrime: true
      }
    }
  })

  const resolveTargetId = (allocationKey: string) => {
    if (isEncounterKey(allocationKey)) return allocationKey
    const candidates = bossNameToTargets[allocationKey]
    if (!candidates || candidates.length === 0) return null
    return candidates.slice().sort((a, b) => targetRank(a) - targetRank(b))[0]
  }

  players.forEach((player) => {
    const playerTokens =
      playerTokenAllocations[player.display_name] ||
      playerTokenAllocations[player.player_id] ||
      {}

    Object.entries(playerTokens).forEach(([allocationKey, tokens]) => {
      if (!tokens || tokens <= 0) return
      const targetId = resolveTargetId(allocationKey)
      if (!targetId) return
      if (!data[targetId]) return
      data[targetId].totalTokens += tokens
    })
  })

  return data
}
