import {
  formatDuration,
  formatNumber,
  formatPercentage
} from '@tacticus/app-core/formatters'

export type TrendDirection = 'improving' | 'declining' | 'stable'
export type ProblemSeverity = 'low' | 'medium' | 'high'

const trendDescriptions: Record<TrendDirection, string> = {
  improving: 'Performance is improving',
  declining: 'Performance is declining',
  stable: 'Performance is holding steady'
}

const tokenTrendDescriptions: Record<TrendDirection, string> = {
  improving: 'Token usage is trending down',
  declining: 'Token usage is increasing',
  stable: 'Token usage is steady'
}

const durationTrendDescriptions: Record<TrendDirection, string> = {
  improving: 'Kill times are getting faster',
  declining: 'Kill times are slowing down',
  stable: 'Kill times are steady'
}

const severityDescriptions: Record<ProblemSeverity, string> = {
  high: 'Immediate attention required',
  medium: 'Review teams and efficiency',
  low: 'Healthy performance'
}

const joinLines = (lines: Array<string | null | undefined>): string =>
  lines.filter(Boolean).join('\n')

export const summaryTooltips = {
  problemBosses: (count: number): string =>
    joinLines([
      'Problem bosses',
      'Low: no major issues detected',
      'Medium: some efficiency gaps',
      'High: major issues, fix quickly',
      `Bosses needing attention: ${count}`
    ]),
  performingWell: (count: number): string =>
    joinLines([
      'Strong performers',
      'Low: solid teams, on target',
      'Medium: mostly fine with room to tune',
      'High: standout performance worth noting',
      `Bosses in good shape: ${count}`
    ]),
  averageTokens: (averageTokens: number): string => {
    const category =
      averageTokens <= 30
        ? 'Fast clears'
        : averageTokens <= 50
          ? 'Moderate clears'
          : 'Slow clears'
    return joinLines([
      'Average tokens per boss',
      'Fast clears: 1-30 tokens',
      'Moderate clears: 31-50 tokens',
      'Slow clears: 51+ tokens',
      `Current average: ${formatNumber(averageTokens, 0)} tokens (${category})`
    ])
  },
  damageEfficiency: (
    averageDamage: number,
    averageEfficiencyPct: number
  ): string => {
    const efficiencyRatio = averageEfficiencyPct / 100
    const category =
      efficiencyRatio >= 0.8
        ? 'High efficiency'
        : efficiencyRatio >= 0.6
          ? 'Moderate efficiency'
          : 'Low efficiency'

    return joinLines([
      'Average damage per hit',
      'High efficiency: >=80% of max hit',
      'Moderate efficiency: 60-79% of max hit',
      'Low efficiency: <60% of max hit',
      `Current average: ${formatNumber(averageDamage, 0)} damage`,
      `Efficiency: ${formatPercentage(efficiencyRatio, 1)} (${category})`
    ])
  }
}

type BossForDamageTooltip = {
  averageDamagePerHit: number
  damageEfficiencyPct: number
  maxDamage: number
  timeTrend: TrendDirection
}

type BossForTokenTooltip = {
  hitCount: number
  tokenTrend: TrendDirection
}

type BossForTimeTooltip = {
  averageTimeToKill: number | null
  lastLoopTimeToKill: number | null
  durationTrend: TrendDirection
}

type BossForDamagePerHourTooltip = {
  avgDamagePerHour: number | null
}

type BossForAnalyticsTooltip = {
  consistencyScore?: {
    rating: string
    score: number
    description: string
  }
  trendAnalysis?: {
    direction: string
    strength: string
    confidence: number
  }
  hasAnomalies?: boolean
  riskLevel?: ProblemSeverity | null
}

type BossForPriorityTooltip = {
  problemSeverity: ProblemSeverity
}

const describeEfficiency = (ratio: number): string => {
  if (ratio >= 80) return 'High efficiency (>=80% of the best hit)'
  if (ratio >= 60) return 'Moderate efficiency (60-79% of the best hit)'
  return 'Low efficiency (<60% of the best hit)'
}

const describeTokens = (tokens: number): string => {
  if (tokens <= 30) return 'Fast clear target: 1-30 tokens'
  if (tokens <= 50) return 'Acceptable clear: 31-50 tokens'
  return 'Slow clear: 51+ tokens'
}

const describeDamagePerHour = (damagePerHour: number): string => {
  if (damagePerHour > 1_000_000) return 'High output (>1M damage/hour)'
  if (damagePerHour > 500_000) return 'Moderate output (0.5M-1M damage/hour)'
  return 'Low output (<0.5M damage/hour)'
}

const describeRiskLevel = (severity: ProblemSeverity): string => {
  switch (severity) {
    case 'high':
      return 'High priority boss'
    case 'medium':
      return 'Medium priority boss'
    case 'low':
      return 'Low priority boss'
  }
}

export const bossMetricTooltips = {
  damageEfficiency: (boss: BossForDamageTooltip): string => {
    const ratio = boss.damageEfficiencyPct
    return joinLines([
      'Damage efficiency',
      `Average damage per hit: ${formatNumber(boss.averageDamagePerHit, 0)}`,
      `Share of max hit: ${formatPercentage(ratio / 100, 1)}`,
      describeEfficiency(ratio),
      trendDescriptions[boss.timeTrend]
    ])
  },
  tokenUsage: (boss: BossForTokenTooltip): string =>
    joinLines([
      'Token usage',
      `Tokens spent: ${formatNumber(boss.hitCount, 0)}`,
      describeTokens(boss.hitCount),
      tokenTrendDescriptions[boss.tokenTrend]
    ]),
  timeToKill: (boss: BossForTimeTooltip): string => {
    const average =
      boss.averageTimeToKill != null
        ? formatDuration(boss.averageTimeToKill * 60)
        : 'Not available'
    const last =
      boss.lastLoopTimeToKill != null
        ? formatDuration(boss.lastLoopTimeToKill * 60)
        : 'Not available'

    return joinLines([
      'Time to kill',
      `Average: ${average}`,
      `Most recent loop: ${last}`,
      durationTrendDescriptions[boss.durationTrend]
    ])
  },
  damagePerHour: (boss: BossForDamagePerHourTooltip): string => {
    if (boss.avgDamagePerHour == null) {
      return joinLines(['Damage per hour', 'No completed runs recorded yet'])
    }

    return joinLines([
      'Damage per hour',
      `Output: ${formatNumber(boss.avgDamagePerHour, 0)} damage/hour`,
      describeDamagePerHour(boss.avgDamagePerHour)
    ])
  },
  analytics: (boss: BossForAnalyticsTooltip): string => {
    if (!boss.consistencyScore) {
      return 'Performance analytics will appear once enough data is available.'
    }

    const { consistencyScore, trendAnalysis, hasAnomalies, riskLevel } = boss

    return joinLines([
      'Performance analytics',
      `Consistency: ${consistencyScore.rating} (${consistencyScore.score}/100)`,
      consistencyScore.description,
      trendAnalysis
        ? `Trend: ${trendAnalysis.direction} (${Math.round(trendAnalysis.confidence)}% confidence)`
        : null,
      trendAnalysis ? `Trend strength: ${trendAnalysis.strength}` : null,
      hasAnomalies
        ? 'Alert: recent results look unusual'
        : 'No anomalies detected',
      riskLevel ? `Risk level: ${severityDescriptions[riskLevel]}` : null
    ])
  },
  priority: (boss: BossForPriorityTooltip): string =>
    joinLines([
      'Priority level',
      describeRiskLevel(boss.problemSeverity),
      severityDescriptions[boss.problemSeverity]
    ])
}
