/** Ranks members by target score (1.0 = on target). Officer+, own guild only, behind `officer_command_center`. */

import { serviceDb } from '@/app/lib/db'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { getLatestSeason } from '@/app/lib/utils/season'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'
import { mainCache } from '@tacticus/app-core/unified-cache'
import { getCurrentBossStatusWithLifecycle } from '@/app/lib/data/boss-status'
import { getGuildTokenPerformance } from '@/app/lib/data/guild-token-performance'
import { fetchSeasonForecast } from '@/app/lib/season-forecast/forecast-service'
import { computeSeasonOutlookDetailWithTimeout } from '@/app/lib/season-forecast/season-outlook-projection'
import { selectCapRiskEntries } from '@/app/lib/season-forecast/pace-figures'
import { loadGuildTokenStatuses } from '@/app/api/guild-tokens/token-service'
import type { PlayerTokenStatus } from '@/app/api/guild-tokens/token-service'
import { analyzeGuildMembers } from '@/app/lib/officer-briefing/analyze-member'
import {
  loadRecentAttacks,
  computeStrongStreak,
  loadWeekOverWeekImprovedCount
} from '@/app/lib/officer-briefing/recent-attacks'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import type { MemberAnalysisSummary } from '@/app/lib/officer-briefing/analyze-member'
import {
  MIN_MEMBER_ATTACKS_FOR_OFFICER_BRIEFING,
  aggregate,
  rosterAdjustedPct,
  type MemberAgg,
  type NormRow
} from '@/app/lib/officer-briefing/aggregate'
import { aggregateByPlayer } from '@/app/lib/boss-assignments/performance-leaderboard-aggregate'
import type { TokenPerformanceData } from '@/app/lib/boss-assignments/token-performance-types'
import {
  extremeTargetBoss,
  isNeedsReviewScore,
  isRecognitionScore,
  type TargetBoss
} from '@/app/lib/officer-briefing/target-score'
import { withTimeout } from '@/app/lib/utils/async-timeout'
import { createComponentLogger } from '@/app/lib/logging'
import { requireActiveOfficerCommandAccess } from '../_shared/access'
import type {
  MemberBossVerdict,
  MemberSignalRow,
  OfficerBriefingResponse,
  SeasonOutlookSummary,
  Confidence,
  GuildPattern
} from '@/app/lib/officer-briefing/types'

const logger = createComponentLogger('api.officer.briefing')

const MIN_ATTACKS = MIN_MEMBER_ATTACKS_FOR_OFFICER_BRIEFING
const TOKEN_CAP = 3
const CAP_WINDOW_SECONDS = 12 * 3600
const ROSTER_ANALYSIS_CACHE_TTL_MS = 60 * 1000

interface BossPerfRow {
  display_name: string
  boss_name: string
  encounter_id: number
  player_avg: number
  battle_count: number
  player_vs_guild_avg: number | null
}

export const GET = withErrorHandler(async (request: Request) => {
  // guildCode comes from the caller's profile, never the request.
  const { user, guildCode } = await requireActiveOfficerCommandAccess()

  const { searchParams } = new URL(request.url)
  const season = searchParams.get('season')?.trim() || (await getLatestSeason())
  if (!season) {
    throw Errors.fromResponse(503, { error: 'Season data unavailable' })
  }

  const supabase = serviceDb()
  const seasonNum = Number.parseInt(season, 10)
  const [
    bossRes,
    outlookDetail,
    tokenState,
    planSummary,
    wowImproved,
    forecast,
    bossStatus,
    tokenPerf
  ] = await Promise.all([
    supabase.rpc('get_player_boss_performance', {
      guild_code_param: guildCode,
      season_param: season
    }),
    computeSeasonOutlookDetailWithTimeout({ guildCode, season }),
    // Never fan out per-player live Tacticus calls.
    Promise.race([
      loadGuildTokenStatuses(supabase, {
        guildCode,
        season,
        skipLiveOverlay: true
      }).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
    ]),
    (async () => {
      try {
        const r = await supabase.rpc('get_player_token_summary', {
          guild_code_param: guildCode,
          season_param: season
        })
        return r.error ? null : r.data
      } catch {
        return null
      }
    })(),
    loadWeekOverWeekImprovedCount(supabase, {
      guildCode,
      season,
      nowMs: Date.now()
    }).catch(() => null),
    Number.isFinite(seasonNum)
      ? fetchSeasonForecast(supabase, {
          guildCode,
          seasonNumber: seasonNum,
          includePerPlayer: true,
          userId: user.id
        }).catch(() => null)
      : Promise.resolve(null),
    getCurrentBossStatusWithLifecycle(guildCode, season).catch(() => null),
    getGuildTokenPerformance(guildCode, {
      seasonOverride: season,
      includeHistoricalPlayers: false,
      includePrimes: true
    }).catch(() => ({}) as TokenPerformanceData)
  ])

  if (bossRes.error) {
    logger.error({ guildCode, error: bossRes.error }, 'boss performance failed')
    throw Errors.fromResponse(500, { error: 'Failed to load performance' })
  }
  const bossRows = (bossRes.data as unknown as BossPerfRow[] | null) ?? []
  const rows: NormRow[] = bossRows.map((r) => ({
    displayName: r.display_name,
    bossName: r.boss_name,
    encounterId: r.encounter_id,
    battleCount: r.battle_count,
    vsGuild: r.player_vs_guild_avg
  }))
  const agg = aggregate(rows)
  const outlook = outlookDetail?.projection ?? null

  // Projection comes from outlook pace rows; the envelope stays authoritative for live token state.
  const capRiskSelection = selectCapRiskEntries({
    paceRows: outlookDetail?.players ?? null,
    // An empty model must fall back rather than read as "no risk".
    paceMemberCount: outlookDetail?.projection.memberCount ?? null,
    envelopeRows: forecast?.per_player ?? []
  })
  const capRisk = new Map<string, number>()
  for (const entry of capRiskSelection.entries) {
    capRisk.set(entry.displayName, entry.estimatedCapWaste)
  }

  const nowMs = Date.now()
  const tokenByName = new Map<string, PlayerTokenStatus>()
  for (const p of tokenState?.players ?? []) tokenByName.set(p.display_name, p)

  const tokenFields = (
    displayName: string
  ): Pick<
    MemberSignalRow,
    'tokensAvailable' | 'tokenCapacity' | 'lastBattleSecondsAgo'
  > => {
    const t = tokenByName.get(displayName)
    if (!t) {
      return {
        tokensAvailable: null,
        tokenCapacity: null,
        lastBattleSecondsAgo: null
      }
    }
    const lastMs = t.last_battle_time ? Date.parse(t.last_battle_time) : NaN
    return {
      tokensAvailable: t.tokens_available,
      tokenCapacity: TOKEN_CAP,
      lastBattleSecondsAgo: Number.isFinite(lastMs)
        ? Math.max(0, Math.round((nowMs - lastMs) / 1000))
        : null
    }
  }

  let membersCappingWithin12h: number | null = null
  let nextReviewSeconds: number | null = null
  if (tokenState?.players?.length) {
    membersCappingWithin12h = tokenState.players.filter(
      (p) =>
        p.tokens_available >= TOKEN_CAP ||
        (p.tokens_available === TOKEN_CAP - 1 &&
          p.token_next_in_seconds != null &&
          p.token_next_in_seconds <= CAP_WINDOW_SECONDS)
    ).length
    const ticks = tokenState.players
      .map((p) => p.token_next_in_seconds)
      .filter((s): s is number => s != null && s > 0)
    nextReviewSeconds = ticks.length > 0 ? Math.min(...ticks) : null
  }

  // worstBoss* come from the target-score extreme boss, not the vs-guild aggregate.
  const toRow = (
    a: MemberAgg,
    bucket: MemberSignalRow['bucket'],
    targetScore: number | null,
    extremeBoss: TargetBoss | null
  ): MemberSignalRow => ({
    displayName: a.displayName,
    worstVsGuildPct: a.worstVsGuildPct,
    bestVsGuildPct: a.bestVsGuildPct,
    battleCount: a.battleCount,
    worstBossName: extremeBoss?.bossName ?? null,
    worstEncounterId: extremeBoss?.encounterId ?? null,
    worstBattleCount: extremeBoss?.tokensSpent ?? null,
    tokenCapRisk: capRisk.has(a.displayName),
    estimatedCapWaste: capRisk.get(a.displayName) ?? null,
    bucket,
    targetScore,
    ...tokenFields(a.displayName)
  })

  const toVerdictRow = (
    a: MemberAgg,
    bucket: MemberSignalRow['bucket'],
    verdict: MemberBossVerdict
  ): MemberSignalRow => ({
    displayName: a.displayName,
    worstVsGuildPct: a.worstVsGuildPct,
    bestVsGuildPct: a.bestVsGuildPct,
    battleCount: a.battleCount,
    worstBossName: verdict.bossName,
    worstEncounterId: verdict.encounterId,
    worstBattleCount: verdict.battleCount,
    tokenCapRisk: capRisk.has(a.displayName),
    estimatedCapWaste: capRisk.get(a.displayName) ?? null,
    bucket,
    rosterAdjustedPct: rosterAdjustedPct(
      verdict.actualAvg,
      verdict.expectedForBestFieldable ?? verdict.expectedForUsedTeam
    ),
    readyNowUpside: verdict.readyNowUpside,
    classification: verdict.classification,
    confidence: verdict.confidence,
    swaps: verdict.swaps,
    recommendation: verdict.recommendation,
    ...tokenFields(a.displayName)
  })

  const members = [...agg.values()].filter((m) => m.battleCount >= MIN_ATTACKS)

  const byPlayer = new Map(
    aggregateByPlayer(tokenPerf).map((row) => [row.playerName, row])
  )
  const targetScoreByName = new Map<
    string,
    {
      targetScore: number | null
      worst: TargetBoss | null
      best: TargetBoss | null
    }
  >()
  for (const m of members) {
    const entries = tokenPerf[m.displayName]
    targetScoreByName.set(m.displayName, {
      targetScore: byPlayer.get(m.displayName)?.weightedScore ?? null,
      worst: extremeTargetBoss(entries, 'worst'),
      best: extremeTargetBoss(entries, 'best')
    })
  }

  // Full roster so "Team upgrades" is not limited to needs-review members.
  const displayNames = members.map((m) => m.displayName)
  const analysisCacheKey = `officer-briefing-roster:${guildCode}:${season}:${displayNames
    .slice()
    .sort()
    .join('|')}`
  const verdicts = await withTimeout(
    mainCache.getOrFetch(
      analysisCacheKey,
      () =>
        analyzeGuildMembers({
          supabase,
          guildCode,
          displayNames,
          season,
          nowMs: Date.now()
        }),
      {
        ttl: ROSTER_ANALYSIS_CACHE_TTL_MS,
        priority: 'medium',
        tags: ['officer-briefing', `guild:${guildCode}`, `season:${season}`]
      }
    ) as Promise<Map<string, MemberAnalysisSummary>>,
    8000,
    'officer briefing roster-aware analysis'
  ).catch((): Map<string, MemberAnalysisSummary> => new Map())

  const needsReview: MemberSignalRow[] = []
  for (const m of members) {
    const target = targetScoreByName.get(m.displayName)
    if (!target || !isNeedsReviewScore(target.targetScore)) continue
    const row = toRow(m, 'needs_review', target.targetScore, target.worst)
    const wrongTeamVerdict = verdicts
      .get(m.displayName)
      ?.verdicts.find((v) => v.classification === 'needs_support_wrong_team')
    if (wrongTeamVerdict) {
      row.swaps = wrongTeamVerdict.swaps
      row.readyNowUpside = wrongTeamVerdict.readyNowUpside
      row.recommendation = wrongTeamVerdict.recommendation
    }
    needsReview.push(row)
  }

  // Rank by impact (1 - targetScore) x verdict confidence x tokens banked now.
  const CONFIDENCE_WEIGHT: Record<string, number> = {
    high: 1,
    medium: 0.75,
    low: 0.5
  }
  const rankScore = (r: MemberSignalRow): number => {
    const impact = 1 - (r.targetScore ?? 1)
    const conf = r.confidence ? (CONFIDENCE_WEIGHT[r.confidence] ?? 0.6) : 0.6
    const urgency = 1 + (r.tokensAvailable ?? 0) * 0.1
    return impact * conf * urgency
  }
  needsReview.sort((a, b) => rankScore(b) - rankScore(a))

  const teamUpgrades: MemberSignalRow[] = []
  for (const m of members) {
    const upgrade = verdicts
      .get(m.displayName)
      ?.verdicts.find((v) => v.classification === 'needs_support_wrong_team')
    if (!upgrade) continue
    teamUpgrades.push(toVerdictRow(m, 'team_upgrade', upgrade))
  }
  teamUpgrades.sort((a, b) => (b.readyNowUpside ?? 0) - (a.readyNowUpside ?? 0))
  const teamUpgradeUpsideTotal = teamUpgrades.reduce(
    (sum, r) => sum + (r.readyNowUpside ?? 0),
    0
  )

  const recognition: MemberSignalRow[] = []
  for (const m of members) {
    const target = targetScoreByName.get(m.displayName)
    if (!target || !isRecognitionScore(target.targetScore)) continue
    recognition.push(toRow(m, 'recognition', target.targetScore, target.best))
  }
  recognition.sort((a, b) => (b.targetScore ?? 0) - (a.targetScore ?? 0))

  // Headline member only, to avoid a per-row fan-out.
  const recogTop = recognition[0]
  if (recogTop) {
    const best = targetScoreByName.get(recogTop.displayName)?.best
    if (best) {
      try {
        const points = await loadRecentAttacks(supabase, {
          guildCode,
          displayName: recogTop.displayName,
          season,
          bossName: best.bossName,
          raritySet: best.raritySet,
          expected: best.expectedPerAttack
        })
        recogTop.strongStreak = computeStrongStreak(points)
      } catch {
        /* streak is best-effort */
      }
    }
  }

  const tokenRisk = [...capRisk.entries()]
    .map(([displayName, waste]) => {
      const a = agg.get(displayName)
      return {
        displayName,
        worstVsGuildPct: a?.worstVsGuildPct ?? null,
        bestVsGuildPct: a?.bestVsGuildPct ?? null,
        battleCount: a?.battleCount ?? 0,
        worstBossName: a?.worstBossName ?? null,
        worstEncounterId: a?.worstEncounterId ?? null,
        worstBattleCount: a?.worstBattleCount ?? null,
        tokenCapRisk: true,
        estimatedCapWaste: waste,
        bucket: 'token_risk' as const,
        ...tokenFields(displayName)
      } satisfies MemberSignalRow
    })
    .sort((a, b) => (b.estimatedCapWaste ?? 0) - (a.estimatedCapWaste ?? 0))

  let activeBossLabel: string | null = null
  let activeBossHpPct: number | null = null
  let openTargetsLabel: string | null = null
  if (bossStatus) {
    const main = bossStatus.find((r) => r.encounter_id === 0)
    if (main) {
      activeBossLabel = main.boss_name
      const max = main.max_hp ?? 0
      const remaining = main.remaining_hp ?? 0
      activeBossHpPct = max > 0 ? Math.round((remaining / max) * 100) : null
    }
    // A warded main reads 'warded' while its alive primes read 'active'.
    const openLabels = bossStatus
      .filter((r) => r.lifecycle_state === 'active')
      .sort((a, b) => (a.encounter_id ?? 0) - (b.encounter_id ?? 0))
      .map((r) =>
        (r.encounter_id ?? 0) === 0 ? 'Main' : `Prime ${r.encounter_id}`
      )
    openTargetsLabel = openLabels.length > 0 ? openLabels.join(' + ') : null
  }

  // Null so "no plan" never reads as "0 unassigned".
  let unassignedAttacks: number | null = null
  if (planSummary && planSummary.length > 0) {
    unassignedAttacks = Math.max(
      0,
      planSummary.reduce(
        (sum, p) =>
          sum + ((p.max_tokens_allowed ?? 0) - (p.total_tokens_used ?? 0)),
        0
      )
    )
  }

  let seasonOutlook: SeasonOutlookSummary | null = null
  let capacityLeft: number | null = null
  if (outlook) {
    capacityLeft = Math.round(outlook.tokensRemaining)
    if (outlook.finish) {
      const c = outlook.confidence
      seasonOutlook = {
        lap: outlook.finish.loopIndex + 1,
        pctIntoLap: Math.round(
          Math.max(0, Math.min(1, outlook.finish.pctIntoFinalStage)) * 100
        ),
        bossName: outlook.finish.bossName,
        confidence: (c === 'high' || c === 'medium' || c === 'low'
          ? c
          : 'low') as Confidence
      }
    }
  }

  const fmtDmg = (n: number): string =>
    Math.abs(n) >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : `${Math.round(n / 1000)}k`
  const patterns: GuildPattern[] = []

  {
    const byBoss = new Map<string, MemberSignalRow[]>()
    for (const t of teamUpgrades) {
      if (!t.worstBossName) continue
      const group = byBoss.get(t.worstBossName) ?? []
      group.push(t)
      byBoss.set(t.worstBossName, group)
    }
    let best: { boss: string; rows: MemberSignalRow[] } | null = null
    for (const [boss, rows] of byBoss) {
      if (rows.length >= 2 && (!best || rows.length > best.rows.length)) {
        best = { boss, rows }
      }
    }
    if (best) {
      const recoverable = best.rows.reduce(
        (sum, r) => sum + (r.readyNowUpside ?? 0),
        0
      )
      patterns.push({
        kind: 'team_selection',
        title: `${best.rows.length} players share the same ${getBossDisplayName(best.boss)} mismatch`,
        detail:
          recoverable > 0
            ? `A single pinned team note could recover an estimated ${fmtDmg(recoverable)} per attack cycle.`
            : 'A single pinned team note could correct all of them at once.',
        href: getHrefWithSeason('/boss-playbooks', season),
        ctaLabel: 'Open boss playbooks'
      })
    }
  }

  if (membersCappingWithin12h != null && membersCappingWithin12h > 0) {
    const cappedNow =
      tokenState?.players.filter((p) => p.tokens_available >= TOKEN_CAP)
        .length ?? 0
    const checkpoint =
      nextReviewSeconds != null
        ? ` before the next checkpoint (in ${Math.floor(nextReviewSeconds / 3600)}h ${Math.floor((nextReviewSeconds % 3600) / 60)}m)`
        : ''
    patterns.push({
      kind: 'token_timing',
      title: `${membersCappingWithin12h} member${membersCappingWithin12h === 1 ? '' : 's'} may cap before assignment`,
      detail:
        cappedNow > 0
          ? `${cappedNow} ${cappedNow === 1 ? 'is' : 'are'} at cap now; assign them${checkpoint}.`
          : `Assign them${checkpoint}.`,
      href: getHrefWithSeason('/boss-assignments', season),
      ctaLabel: 'Review token risk'
    })
  }

  if (wowImproved != null && wowImproved > 0) {
    patterns.push({
      kind: 'positive_trend',
      title: `${wowImproved} member${wowImproved === 1 ? '' : 's'} improved week over week`,
      detail:
        'Same-boss averages are up vs the prior week — recent coaching may be landing.',
      href: null,
      ctaLabel: null
    })
  }

  const body: OfficerBriefingResponse = {
    context: {
      guildCode,
      guildName: null,
      season,
      activeBossLabel,
      activeBossHpPct,
      openTargetsLabel,
      unassignedAttacks,
      seasonOutlook,
      capacityLeft,
      membersCappingWithin12h,
      nextReviewSeconds,
      generatedAt: new Date().toISOString()
    },
    needsReview,
    recognition,
    tokenRisk,
    teamUpgrades,
    counts: {
      needsReview: needsReview.length,
      recognition: recognition.length,
      tokenRisk: tokenRisk.length,
      teamUpgrades: teamUpgrades.length
    },
    teamUpgradeUpsideTotal,
    patterns
  }

  return Response.json(body)
})
