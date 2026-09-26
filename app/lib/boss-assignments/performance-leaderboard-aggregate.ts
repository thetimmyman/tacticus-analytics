import type {
  TokenPerformanceData,
  TokenPerformanceEntry
} from '@/app/lib/boss-assignments/token-performance-types'

export interface PlayerAggregateRow {
  /** Player ID, or display name in roster views. */
  playerKey?: string
  playerId?: string
  playerName: string
  bossCount: number
  /** Fewer than bossCount on novel tiers (no expected-damage denominator). */
  scoredBossCount: number
  tokensSpent: number
  expectedTokens: number
  /** Σ(score × tokens) / Σ(tokens): ratio-of-totals lets large bosses drown out primes. */
  weightedScore: number | null
  tierCounts: Record<string, number>
}

export interface GuildSummary {
  playerCount: number
  mean: number | null
  median: number | null
  pctAtOrAbove: number | null
}

export function aggregateByPlayer(
  data: TokenPerformanceData
): PlayerAggregateRow[] {
  const rows: PlayerAggregateRow[] = []

  Object.entries(data).forEach(([playerKey, bosses]) => {
    let tokensSpent = 0
    let expectedTokens = 0
    let bossCount = 0
    let scoredBossCount = 0
    let weightedScoreNumerator = 0
    let weightedScoreDenominator = 0
    const tierCounts: Record<string, number> = {}
    const entries = Object.values(
      bosses as Record<string, TokenPerformanceEntry>
    )
    const firstEntry = entries.find(
      (entry) =>
        typeof entry.displayName === 'string' ||
        typeof entry.playerId === 'string'
    )
    const playerId =
      typeof firstEntry?.playerId === 'string' &&
      firstEntry.playerId.trim().length > 0
        ? firstEntry.playerId.trim()
        : undefined
    const playerName =
      typeof firstEntry?.displayName === 'string' &&
      firstEntry.displayName.trim().length > 0
        ? firstEntry.displayName.trim()
        : playerKey

    entries.forEach((entry) => {
      if (entry.tokensSpent <= 0) return
      bossCount += 1
      tokensSpent += entry.tokensSpent
      tierCounts[entry.tier] = (tierCounts[entry.tier] ?? 0) + 1

      if (
        entry.expectedTokens !== null &&
        entry.expectedDamage !== null &&
        entry.expectedDamage > 0 &&
        entry.score !== null &&
        Number.isFinite(entry.score)
      ) {
        scoredBossCount += 1
        expectedTokens += entry.expectedTokens
        weightedScoreNumerator += entry.score * entry.tokensSpent
        weightedScoreDenominator += entry.tokensSpent
      }
    })

    const weightedScore =
      weightedScoreDenominator > 0
        ? weightedScoreNumerator / weightedScoreDenominator
        : null

    rows.push({
      playerKey,
      playerId,
      playerName,
      bossCount,
      scoredBossCount,
      tokensSpent,
      expectedTokens,
      weightedScore,
      tierCounts
    })
  })

  return rows
}

export function summarizeGuild(rows: PlayerAggregateRow[]): GuildSummary {
  const scored = rows
    .map((r) => r.weightedScore)
    .filter((s): s is number => s !== null)
  if (scored.length === 0) {
    return {
      playerCount: rows.length,
      mean: null,
      median: null,
      pctAtOrAbove: null
    }
  }

  const sorted = [...scored].sort((a, b) => a - b)
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? null)
  const atOrAbove = sorted.filter((v) => v >= 1).length

  return {
    playerCount: rows.length,
    mean,
    median,
    pctAtOrAbove: (atOrAbove / sorted.length) * 100
  }
}
