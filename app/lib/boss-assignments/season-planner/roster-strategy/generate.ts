import 'server-only'

import { serviceDb } from '@/app/lib/db'
import { ensureRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import { getLatestSeason } from '@/app/lib/utils/season'
import {
  diffStrategySummaries,
  rankOptimizerCandidates,
  type StrategyOptimizerCandidate
} from '@/app/lib/boss-assignments/season-planner/roster-strategy-core'
import {
  aggregateSummaries,
  buildSeasonWindowSpecs,
  clampInt,
  normalizePlayerId,
  toPublicMember
} from './shared'
import { loadBattleRows, loadGuilds, loadMembers } from './loaders'
import {
  buildProjectionContext,
  filterBattleRowsForProjection,
  filterSignalRowsForProjection,
  filterTokenRowsForProjection,
  resolveSignalReferenceMs
} from './projection-context'
import {
  candidateFit,
  isOptimizerDeltaBeneficial,
  optimizerEvaluationBudget,
  projectGuildWindow,
  replaceMember,
  summarizeProjectionContributions
} from './project'
import {
  buildInvestments,
  describeInvestmentStep,
  stateForHeroDemand
} from './investments'
import type { RosterStrategyPayload, RosterStrategySwapResult } from './types'

export const __testing = {
  buildSeasonWindowSpecs,
  describeInvestmentStep,
  filterBattleRowsForProjection,
  filterSignalRowsForProjection,
  filterTokenRowsForProjection,
  isOptimizerDeltaBeneficial,
  loadBattleRows,
  loadGuilds,
  optimizerEvaluationBudget,
  resolveSignalReferenceMs,
  stateForHeroDemand,
  summarizeProjectionContributions
}

export async function generateRosterStrategy(args: {
  targetGuildCode: string
  season?: string | null
  snapshotAt?: string | null
  lookbackDays?: number
  sessionsPerDay?: number
  timeZone?: string | null
  configId?: string | null
  seasonCount?: number
  swap?: {
    outgoingPlayerId?: string | null
    incomingPlayerId?: string | null
  } | null
  includeOptimizer?: boolean
  includeInvestments?: boolean
  optimizerLimit?: number
  investmentLimitPerMember?: number
}): Promise<RosterStrategyPayload> {
  const service = serviceDb()
  const warnings: string[] = []
  const snapshotAt = args.snapshotAt || new Date().toISOString()
  const snapshotMs = new Date(snapshotAt).getTime()
  if (!Number.isFinite(snapshotMs)) {
    throw new Error('Invalid snapshotAt timestamp')
  }

  const liveSeason = await getLatestSeason()
  const season = args.season || liveSeason
  if (!season) throw new Error('Season data unavailable')

  const lookbackDays = clampInt(args.lookbackDays ?? 30, 1, 180)
  const sessionsPerDay = clampInt(args.sessionsPerDay ?? 1, 1, 3)
  const seasonCount = clampInt(args.seasonCount ?? 1, 1, 5)
  const optimizerLimit = clampInt(args.optimizerLimit ?? 5, 1, 12)
  const investmentLimitPerMember = clampInt(
    args.investmentLimitPerMember ?? 3,
    1,
    8
  )

  const { guilds, clusterCode } = await loadGuilds(
    service,
    args.targetGuildCode
  )
  const guildCodes = guilds.map((guild) => guild.guildCode)
  const guildByCode = new Map(guilds.map((guild) => [guild.guildCode, guild]))
  const targetGuild = guildByCode.get(args.targetGuildCode)
  if (!targetGuild) {
    throw new Error('Target guild is not in the resolved cluster')
  }
  if (args.timeZone) {
    targetGuild.timeZone = args.timeZone
  }

  const members = await loadMembers(service, guildCodes)
  const targetMembers = members.filter(
    (member) => member.guildCode === args.targetGuildCode
  )
  if (targetMembers.length === 0) {
    warnings.push('No current target-guild members found for projection.')
  }

  const seasonSpecs = buildSeasonWindowSpecs({
    baseSeason: season,
    baseConfigId: args.configId,
    liveSeason,
    seasonCount
  })
  const baseSeasonNumber = Number.parseInt(season, 10)
  const historySeasons = Array.from(
    new Set(
      Number.isFinite(baseSeasonNumber) && baseSeasonNumber > 1
        ? [season, String(baseSeasonNumber - 1)]
        : [season]
    )
  )
  const seasonsForHistory = Array.from(
    new Set([...seasonSpecs.map((spec) => spec.season), ...historySeasons])
  )

  const battleRows = await loadBattleRows({
    service,
    guildCodes,
    playerIds: members.map((member) => member.playerId),
    seasons: seasonsForHistory
  })
  const signalRows = battleRows.filter((row) =>
    historySeasons.includes(String(row.Season))
  )

  const liveRotation = await ensureRotationSnapshot()
  const targetContexts = await Promise.all(
    seasonSpecs.map((seasonSpec) =>
      buildProjectionContext({
        service,
        guild: targetGuild,
        seasonSpec,
        snapshotAt,
        battleRows,
        signalRows,
        lookbackDays,
        liveRotation
      })
    )
  )

  const baseline = projectGuildWindow({
    guildCode: args.targetGuildCode,
    contexts: targetContexts,
    members: targetMembers,
    lookbackDays,
    sessionsPerDay
  })

  let swap: RosterStrategySwapResult | null = null
  const outgoingPlayerId = normalizePlayerId(args.swap?.outgoingPlayerId)
  const incomingPlayerId = normalizePlayerId(args.swap?.incomingPlayerId)

  if (outgoingPlayerId && incomingPlayerId) {
    const outgoing = targetMembers.find(
      (member) => member.playerId === outgoingPlayerId
    )
    const incoming = members.find(
      (member) => member.playerId === incomingPlayerId
    )

    if (!outgoing || !incoming) {
      warnings.push(
        'Swap selection could not be resolved in the cluster roster.'
      )
    } else if (incoming.guildCode === args.targetGuildCode) {
      warnings.push(
        'Swap candidate must come from another guild in the cluster.'
      )
    } else {
      const partnerGuild = guildByCode.get(incoming.guildCode)
      if (!partnerGuild) {
        warnings.push('Incoming member guild is not available for projection.')
      } else {
        const partnerMembers = members.filter(
          (member) => member.guildCode === incoming.guildCode
        )
        const partnerContexts = await Promise.all(
          seasonSpecs.map((seasonSpec) =>
            buildProjectionContext({
              service,
              guild: partnerGuild,
              seasonSpec,
              snapshotAt,
              battleRows,
              signalRows,
              lookbackDays,
              liveRotation
            })
          )
        )
        const targetAfterMembers = replaceMember(
          targetMembers,
          outgoing.playerId,
          incoming
        )
        const partnerAfterMembers = replaceMember(
          partnerMembers,
          incoming.playerId,
          outgoing
        )
        const partnerBefore = projectGuildWindow({
          guildCode: incoming.guildCode,
          contexts: partnerContexts,
          members: partnerMembers,
          lookbackDays,
          sessionsPerDay
        })
        const targetAfter = projectGuildWindow({
          guildCode: args.targetGuildCode,
          contexts: targetContexts,
          members: targetAfterMembers,
          lookbackDays,
          sessionsPerDay
        })
        const partnerAfter = projectGuildWindow({
          guildCode: incoming.guildCode,
          contexts: partnerContexts,
          members: partnerAfterMembers,
          lookbackDays,
          sessionsPerDay
        })
        const targetDelta = diffStrategySummaries(
          targetAfter.aggregate,
          baseline.aggregate
        )
        const partnerDelta = diffStrategySummaries(
          partnerAfter.aggregate,
          partnerBefore.aggregate
        )
        const combinedBefore = aggregateSummaries('combined', [
          baseline.aggregate,
          partnerBefore.aggregate
        ])
        const combinedAfter = aggregateSummaries('combined', [
          targetAfter.aggregate,
          partnerAfter.aggregate
        ])

        swap = {
          outgoing: toPublicMember(outgoing),
          incoming: toPublicMember(incoming),
          targetGuildBefore: baseline,
          targetGuildAfter: targetAfter,
          targetGuildDelta: targetDelta,
          partnerGuildBefore: partnerBefore,
          partnerGuildAfter: partnerAfter,
          partnerGuildDelta: partnerDelta,
          combinedDelta: diffStrategySummaries(combinedAfter, combinedBefore)
        }
      }
    }
  }

  let optimizer: StrategyOptimizerCandidate[] = []
  if (args.includeOptimizer !== false) {
    const maxEvaluations = optimizerEvaluationBudget(optimizerLimit)
    const candidates = members
      .filter((member) => member.guildCode !== args.targetGuildCode)
      .map((member) => ({ member, ...candidateFit(member, targetContexts) }))
      .sort((a, b) => b.fitDamage - a.fitDamage)
    const totalEvaluationPairs = candidates.length * targetMembers.length

    const evaluated: StrategyOptimizerCandidate[] = []
    let evaluationCount = 0
    let budgetExhausted = false
    for (const candidate of candidates) {
      let best: StrategyOptimizerCandidate | null = null
      for (const outgoing of targetMembers) {
        if (evaluationCount >= maxEvaluations) {
          budgetExhausted = true
          break
        }
        evaluationCount += 1
        const projected = projectGuildWindow({
          guildCode: args.targetGuildCode,
          contexts: targetContexts,
          members: replaceMember(
            targetMembers,
            outgoing.playerId,
            candidate.member
          ),
          lookbackDays,
          sessionsPerDay
        })
        const delta = diffStrategySummaries(
          projected.aggregate,
          baseline.aggregate
        )
        const row: StrategyOptimizerCandidate = {
          candidatePlayerId: candidate.member.playerId,
          candidateDisplayName: candidate.member.displayName,
          candidateGuildCode: candidate.member.guildCode,
          replacedPlayerId: outgoing.playerId,
          replacedDisplayName: outgoing.displayName,
          baseline: baseline.aggregate,
          projected: projected.aggregate,
          delta,
          fitDamage: candidate.fitDamage,
          sampleCount: candidate.sampleCount,
          reasons: [
            `Projected ${Math.max(0, delta.bossesDefeated)} additional clears`,
            `+${Math.max(0, delta.tokenEfficiency).toLocaleString()} damage/token`,
            `${candidate.sampleCount} relevant recent samples`
          ]
        }
        if (!best || row.delta.score > best.delta.score) best = row
      }
      if (best && isOptimizerDeltaBeneficial(best.delta)) evaluated.push(best)
      if (budgetExhausted) break
    }

    if (evaluationCount < totalEvaluationPairs) {
      warnings.push(
        `Optimizer evaluated ${evaluationCount} of ${totalEvaluationPairs} candidate swaps; increase optimizer_limit or simulate a specific swap for deeper review.`
      )
    }

    optimizer = rankOptimizerCandidates(evaluated, optimizerLimit)
  }

  const investments =
    args.includeInvestments === false
      ? []
      : await buildInvestments({
          service,
          contexts: targetContexts,
          members: targetMembers,
          limitPerMember: investmentLimitPerMember
        })

  return {
    clusterCode,
    targetGuildCode: args.targetGuildCode,
    guilds,
    members: members.map(toPublicMember),
    seasons: seasonSpecs,
    baseline,
    swap,
    optimizer,
    investments,
    warnings
  }
}
