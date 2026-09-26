import 'server-only'

import {
  SEASON_CONFIGS,
  getSeasonConfigForSeasonNumber
} from '@/app/lib/loki/season-configs'
import type { StrategyPlanSummary } from '@/app/lib/boss-assignments/season-planner/roster-strategy-core'
import type {
  RosterStrategyMember,
  RosterStrategyPublicMember,
  RosterStrategySeasonSpec
} from './types'

export const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.trunc(value)))

export const OPTIMIZER_EVALUATION_MULTIPLIER = 12

export const normalizePlayerId = (value: string | null | undefined): string =>
  (value ?? '').trim()

export const aggregateSummaries = (
  guildCode: string,
  summaries: StrategyPlanSummary[]
): StrategyPlanSummary => {
  const totals = summaries.reduce(
    (acc, summary) => {
      acc.memberCount = Math.max(acc.memberCount, summary.memberCount)
      acc.tokensSpent += summary.tokensSpent
      acc.tokensHeld += summary.tokensHeld
      acc.wastedTokens += summary.wastedTokens
      acc.bossesDefeated += summary.bossesDefeated
      acc.loopAdvances += summary.loopAdvances
      acc.appliedDamage += summary.appliedDamage
      acc.expectedDamage += summary.expectedDamage
      acc.overkillDamage += summary.overkillDamage
      acc.tokensRemainingSpendable += summary.tokensRemainingSpendable ?? 0
      return acc
    },
    {
      memberCount: 0,
      tokensSpent: 0,
      tokensHeld: 0,
      wastedTokens: 0,
      bossesDefeated: 0,
      loopAdvances: 0,
      appliedDamage: 0,
      expectedDamage: 0,
      overkillDamage: 0,
      tokensRemainingSpendable: 0
    }
  )
  const last = summaries[summaries.length - 1]

  return {
    guildCode,
    memberCount: totals.memberCount,
    tokensSpent: totals.tokensSpent,
    tokensHeld: totals.tokensHeld,
    wastedTokens: totals.wastedTokens,
    bossesDefeated: totals.bossesDefeated,
    loopAdvances: totals.loopAdvances,
    appliedDamage: totals.appliedDamage,
    expectedDamage: totals.expectedDamage,
    overkillDamage: totals.overkillDamage,
    tokenEfficiency:
      totals.tokensSpent > 0
        ? Math.round(totals.appliedDamage / totals.tokensSpent)
        : 0,
    finalStageCode: last?.finalStageCode ?? '',
    finalLoopIndex: last?.finalLoopIndex ?? 0,
    tokensRemainingSpendable: totals.tokensRemainingSpendable
  }
}

const configIdForWindowOffset = (
  baseConfigId: string | null | undefined,
  seasonNumber: number,
  offset: number,
  liveSeasonNumber: number | null
): string | null => {
  if (baseConfigId) {
    const index = SEASON_CONFIGS.findIndex(
      (config) => config.id === baseConfigId
    )
    if (index >= 0 && SEASON_CONFIGS.length > 0) {
      const nextIndex = (index + offset) % SEASON_CONFIGS.length
      return SEASON_CONFIGS[nextIndex]?.id ?? baseConfigId
    }
    if (offset === 0) return baseConfigId
  }

  if (offset === 0 && seasonNumber === liveSeasonNumber) return null

  const overlay = getSeasonConfigForSeasonNumber(seasonNumber)
  if (overlay?.id) return overlay.id

  return null
}

export const buildSeasonWindowSpecs = (args: {
  baseSeason: string
  baseConfigId?: string | null
  liveSeason?: string | null
  seasonCount: number
}): RosterStrategySeasonSpec[] => {
  const base = Number.parseInt(args.baseSeason, 10)
  const liveSeasonNumber =
    typeof args.liveSeason === 'string'
      ? Number.parseInt(args.liveSeason, 10)
      : null
  const count = clampInt(args.seasonCount, 1, 5)

  return Array.from({ length: count }, (_, offset) => {
    const seasonNumber = base + offset
    return {
      season: String(seasonNumber),
      configId: configIdForWindowOffset(
        args.baseConfigId,
        seasonNumber,
        offset,
        Number.isFinite(liveSeasonNumber) ? liveSeasonNumber : null
      ),
      label:
        offset === 0
          ? 'Current selection'
          : offset === 1
            ? 'Next season'
            : `+${offset} seasons`
    }
  })
}

export const mapMember = (row: {
  id: number | null
  player_id: string | null
  display_name: string | null
  guild_code: string | null
  role: string | null
}): RosterStrategyMember | null => {
  const playerId = normalizePlayerId(row.player_id)
  const guildCode = (row.guild_code ?? '').trim()
  if (!playerId || !guildCode || typeof row.id !== 'number') return null

  return {
    mappingId: row.id,
    playerId,
    displayName:
      typeof row.display_name === 'string' && row.display_name.trim().length > 0
        ? row.display_name
        : playerId,
    guildCode,
    role: row.role ?? null
  }
}

export const toPublicMember = (
  member: RosterStrategyMember
): RosterStrategyPublicMember => ({
  playerId: member.playerId,
  displayName: member.displayName,
  guildCode: member.guildCode,
  role: member.role
})
