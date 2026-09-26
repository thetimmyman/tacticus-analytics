import { formatNumber } from '@tacticus/app-core/formatters'
import type { TokenUsageData } from '@/app/lib/data/token-usage'
import type {
  LandingPageBossOverview,
  LandingPageManagementData
} from './home-summary-types'
import {
  computeStageFromMainEncounter,
  deriveStageCodeFromSetAndRarity
} from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import {
  getMainBossMaxHp,
  getPrimeBossMaxHp,
  type BossHpData
} from '@/app/lib/boss-assignments/season-planner/boss-hp'
import type { SeasonRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import type { ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'

export const formatHp = (value: number | null): string => {
  if (value === null || value < 0) return 'N/A'
  if (value === 0) return '0'
  return formatNumber(value)
}

const formatTokens = (used: number, max: number) => `${used}/${max}`

export const buildTokenRankings = (
  tokenUsage: TokenUsageData[]
): Pick<LandingPageManagementData, 'topTokenUsers' | 'bottomTokenUsers'> => {
  if (!tokenUsage || tokenUsage.length === 0) {
    return { topTokenUsers: [], bottomTokenUsers: [] }
  }

  // The RPC's max_possible adds unspent live tokens and inflates the denominator.
  const maxUsedInGuild = tokenUsage.reduce(
    (max, entry) => Math.max(max, entry.tokens_used || 0),
    0
  )

  const ranked = [...tokenUsage]
    .sort((a, b) => (b.tokens_used || 0) - (a.tokens_used || 0))
    .map((entry, index) => {
      const used = entry.tokens_used || 0
      const total =
        maxUsedInGuild > 0 ? maxUsedInGuild : entry.max_possible || 30
      const percentage = total > 0 ? Math.round((used / total) * 100) : 0

      return {
        name: entry.display_name,
        tokens: formatTokens(used, total),
        percentage,
        rank: index + 1
      }
    })

  return {
    topTokenUsers: ranked.slice(0, 5),
    bottomTokenUsers: ranked.slice(-5)
  }
}

export interface BossTimestamps {
  mainTs: number
  prime1Ts: number
  prime2Ts: number
}

export function inferMainBossDeath(
  boss: LandingPageBossOverview,
  ts: BossTimestamps
): LandingPageBossOverview {
  if (
    boss.remainingHp > 0 &&
    boss.maxHp > 0 &&
    (ts.prime1Ts > ts.mainTs || ts.prime2Ts > ts.mainTs)
  ) {
    return {
      ...boss,
      remainingHp: 0,
      hpPercentage: 0,
      formattedRemainingHp: '0'
    }
  }
  return boss
}

/** Skip/kill flags key on the main's difficulty, so a prime from a finished stage is an orphan. */
export function isOrphanPrime(
  prime: Pick<LandingPageBossOverview, 'levelCode'> | null | undefined,
  mainLevelCode: string
): boolean {
  return prime != null && prime.levelCode !== mainLevelCode
}

export interface BossAdvancementInput {
  currentBoss: LandingPageBossOverview
  rarity: string
  set: number
  loopIndex: number
  encounterId: number
  mainBossName: string
  rotationSnapshot: SeasonRotationSnapshot | null
  bossHpData: BossHpData
  progressionConfig: ProgressionConfig
}

export function advanceBossToNextStage(
  input: BossAdvancementInput
): LandingPageBossOverview | null {
  let computed: ReturnType<typeof computeStageFromMainEncounter>
  try {
    computed = computeStageFromMainEncounter(
      {
        rarity: input.rarity,
        set: input.set,
        loopIndex: input.loopIndex,
        remainingHp: 0
      },
      input.progressionConfig
    )
  } catch {
    // Home keeps the observed boss; planner paths call progression directly and still reject.
    return null
  }

  if (!computed.advancedStage) return null

  const bosses = input.rotationSnapshot?.currentBosses ?? []

  if (input.encounterId === 0) {
    const nextBoss = bosses.find(
      (b) =>
        b.encounter_id === 0 &&
        deriveStageCodeFromSetAndRarity(b.set, b.rarity) === computed.stageCode
    )

    const rawBossName =
      nextBoss?.boss_type ?? nextBoss?.boss_name ?? input.mainBossName
    const displayName =
      nextBoss?.boss_name ?? nextBoss?.boss_type ?? input.mainBossName
    const maxHp =
      getMainBossMaxHp(input.bossHpData, rawBossName, computed.stageCode) ?? 0
    const rarity: 'Legendary' | 'Mythic' = computed.stageCode.startsWith('M')
      ? 'Mythic'
      : 'Legendary'

    return {
      name: displayName,
      displayName: `${computed.stageCode} ${displayName}`.trim(),
      rarity,
      levelCode: computed.stageCode,
      loop: computed.loopIndex + 1,
      maxHp,
      remainingHp: maxHp,
      hpPercentage: maxHp > 0 ? 100 : 0,
      formattedMaxHp: formatHp(maxHp),
      formattedRemainingHp: formatHp(maxHp),
      encounterId: 0
    }
  }

  const nextMainBoss = bosses.find(
    (b) =>
      b.encounter_id === 0 &&
      deriveStageCodeFromSetAndRarity(b.set, b.rarity) === computed.stageCode
  )
  const mainBossKey =
    nextMainBoss?.boss_type ?? nextMainBoss?.boss_name ?? input.mainBossName
  const maxHp =
    getPrimeBossMaxHp(
      input.bossHpData,
      mainBossKey,
      computed.stageCode,
      input.encounterId as 1 | 2
    ) ?? 0
  const rarity: 'Legendary' | 'Mythic' = computed.stageCode.startsWith('M')
    ? 'Mythic'
    : 'Legendary'

  const nextPrimeBoss = bosses.find(
    (b) =>
      b.encounter_id === input.encounterId &&
      deriveStageCodeFromSetAndRarity(b.set, b.rarity) === computed.stageCode
  )
  const displayName =
    nextPrimeBoss?.boss_name ??
    nextPrimeBoss?.boss_type ??
    `${mainBossKey}_Prime${input.encounterId}`

  return {
    name: displayName,
    displayName: `${computed.stageCode} ${displayName}`.trim(),
    rarity,
    levelCode: computed.stageCode,
    loop: computed.loopIndex + 1,
    maxHp,
    remainingHp: maxHp,
    hpPercentage: maxHp > 0 ? 100 : 0,
    formattedMaxHp: formatHp(maxHp),
    formattedRemainingHp: formatHp(maxHp),
    encounterId: input.encounterId
  }
}

export interface CurrentStagePrimeInput {
  stageCode: string
  loop: number
  encounterId: 1 | 2
  mainBossName: string
  rotationSnapshot: SeasonRotationSnapshot | null
  bossHpData: BossHpData
}

/**
 * Current season only, after skip flags. Null rather than a fake 0% prime. HP keys on
 * the MAIN boss type; the name comes from the snapshot.
 */
export function resolveCurrentStagePrimeOverview(
  input: CurrentStagePrimeInput
): LandingPageBossOverview | null {
  const bosses = input.rotationSnapshot?.currentBosses ?? []

  const stagePrime = bosses.find(
    (b) =>
      b.encounter_id === input.encounterId &&
      deriveStageCodeFromSetAndRarity(b.set, b.rarity) === input.stageCode
  )
  if (!stagePrime) return null

  const stageMain = bosses.find(
    (b) =>
      b.encounter_id === 0 &&
      deriveStageCodeFromSetAndRarity(b.set, b.rarity) === input.stageCode
  )
  const mainBossKey =
    stageMain?.boss_type ?? stageMain?.boss_name ?? input.mainBossName

  const maxHp =
    getPrimeBossMaxHp(
      input.bossHpData,
      mainBossKey,
      input.stageCode,
      input.encounterId
    ) ?? 0
  if (maxHp <= 0) return null

  const rarity: 'Legendary' | 'Mythic' = input.stageCode.startsWith('M')
    ? 'Mythic'
    : 'Legendary'
  const displayName =
    stagePrime.boss_name ??
    stagePrime.boss_type ??
    `${mainBossKey}_Prime${input.encounterId}`

  return {
    name: displayName,
    displayName: `${input.stageCode} ${displayName}`.trim(),
    rarity,
    levelCode: input.stageCode,
    loop: input.loop,
    maxHp,
    remainingHp: maxHp,
    hpPercentage: 100,
    formattedMaxHp: formatHp(maxHp),
    formattedRemainingHp: formatHp(maxHp),
    encounterId: input.encounterId
  }
}
