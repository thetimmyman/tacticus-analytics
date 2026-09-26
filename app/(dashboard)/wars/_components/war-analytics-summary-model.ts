import type {
  PlayerActivity,
  PlayerAgg,
  RangeOption,
  WarRow,
  ZoneAgg
} from './war-analytics-types'

export const MIN_ATTEMPTS_FOR_WIN_RATE = 5

export type SummaryTone = 'positive' | 'negative' | 'neutral' | 'info'

export function buildWarAnalyticsSummary({
  wars,
  players,
  offenseZones,
  defenseZones,
  playerActivity
}: {
  wars: WarRow[]
  players: PlayerAgg[]
  offenseZones: ZoneAgg[]
  defenseZones: ZoneAgg[]
  playerActivity: PlayerActivity[]
}) {
  const totalWars = wars.length
  const wins = wars.filter((war) => war.war_result === 'win').length
  const losses = wars.filter((war) => war.war_result === 'loss').length
  const draws = wars.filter((war) => war.war_result === 'draw').length
  const winRate = totalWars > 0 ? (wins / totalWars) * 100 : 0

  const totalGuildScore = wars.reduce(
    (sum, war) => sum + (war.guild_score ?? 0),
    0
  )
  const totalOpponentScore = wars.reduce(
    (sum, war) => sum + (war.opponent_score ?? 0),
    0
  )
  const avgGuildScore = totalWars > 0 ? totalGuildScore / totalWars : null
  const avgOpponentScore = totalWars > 0 ? totalOpponentScore / totalWars : null
  const avgScoreDiff =
    avgGuildScore !== null && avgOpponentScore !== null
      ? avgGuildScore - avgOpponentScore
      : null

  const offenseAttempts = offenseZones.reduce(
    (sum, zone) => sum + zone.attempts,
    0
  )
  const offenseWins = offenseZones.reduce((sum, zone) => sum + zone.wins, 0)
  const offenseWinRate =
    offenseAttempts > 0 ? (offenseWins / offenseAttempts) * 100 : null

  const defenseAttempts = defenseZones.reduce(
    (sum, zone) => sum + zone.attempts,
    0
  )
  const defenseWins = defenseZones.reduce((sum, zone) => sum + zone.wins, 0)
  const defenseHoldRate =
    defenseAttempts > 0 ? 100 - (defenseWins / defenseAttempts) * 100 : null

  const mostActive = [...players].sort((a, b) => b.attempts - a.attempts)[0]
  const bestWinRate =
    [...players]
      .filter((player) => player.attempts >= MIN_ATTEMPTS_FOR_WIN_RATE)
      .sort((a, b) => b.winRate - a.winRate)[0] ?? null
  const avgParticipation =
    playerActivity.length > 0
      ? playerActivity.reduce(
          (sum, player) => sum + player.participationRate,
          0
        ) / playerActivity.length
      : null

  return {
    totalWars,
    wins,
    losses,
    draws,
    winRate,
    avgGuildScore,
    avgOpponentScore,
    avgScoreDiff,
    offenseAttempts,
    offenseWinRate,
    defenseAttempts,
    defenseHoldRate,
    topScorer: players[0],
    mostActive,
    bestWinRate,
    avgParticipation,
    recentWars: wars,
    inactivePlayers: playerActivity.filter((p) => p.participationRate < 50),
    highlyInactive: playerActivity.filter((p) => p.warsInactive >= 3),
    recordTone: (totalWars === 0
      ? 'neutral'
      : wins >= losses
        ? 'positive'
        : 'negative') as SummaryTone,
    winRateTone: (totalWars === 0
      ? 'neutral'
      : winRate >= 50
        ? 'positive'
        : 'negative') as SummaryTone,
    diffTone: (avgScoreDiff === null
      ? 'neutral'
      : avgScoreDiff >= 0
        ? 'positive'
        : 'negative') as SummaryTone,
    offenseTone: (offenseWinRate === null
      ? 'neutral'
      : offenseWinRate >= 50
        ? 'positive'
        : 'negative') as SummaryTone,
    defenseTone: (defenseHoldRate === null
      ? 'neutral'
      : defenseHoldRate >= 50
        ? 'positive'
        : 'negative') as SummaryTone
  }
}

export function generateParticipationSummary(
  playerActivity: PlayerActivity[],
  range: RangeOption,
  totalWars: number,
  avgParticipation: number | null,
  labelFor: (name: string | null | undefined) => string
): string {
  const rangeLabel = range === 'all' ? 'All Wars' : `Last ${range} Wars`
  const avgLabel =
    avgParticipation !== null ? `${Math.round(avgParticipation)}%` : 'N/A'
  const highlyInactive = playerActivity.filter((p) => p.warsInactive >= 3)
  const fullParticipation = playerActivity.filter(
    (p) => p.participationRate === 100
  ).length
  const totalAttempts = playerActivity.reduce((sum, p) => sum + p.attempts, 0)
  const totalScore = playerActivity.reduce((sum, p) => sum + p.score, 0)

  let summary = `**Guild War Participation Report**\n`
  summary += `Range: ${rangeLabel} (${totalWars} wars) | Avg Participation: ${avgLabel}\n`
  summary += `Total Attacks: ${totalAttempts} | Total Score: ${totalScore}\n\n`

  if (highlyInactive.length > 0) {
    summary += `**Inactive Players (3+ wars missed):**\n`
    highlyInactive.forEach((p) => {
      summary += `• ${labelFor(p.player)} - ${p.warsInactive} wars missed (${Math.round(p.participationRate)}% participation)\n`
    })
    summary += '\n'
  } else {
    summary += `No players missing 3+ wars\n\n`
  }

  summary += `**All Players:**\n`
  playerActivity.forEach((p) => {
    const winLabel = p.attempts > 0 ? ` | Win: ${Math.round(p.winRate)}%` : ''
    const avgLabel = p.attempts > 0 ? ` | Avg: ${Math.round(p.avgScore)}` : ''
    summary += `• ${labelFor(p.player)} - ${Math.round(p.participationRate)}% participation | ${p.attempts} attacks${winLabel}${avgLabel}\n`
  })
  summary += `\nFull participation: ${fullParticipation} players`

  return summary
}
