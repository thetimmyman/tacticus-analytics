export interface WarMatch {
  id: string
  war_id: string
  opponent_guild_code?: string | null
  opponent_guild_name: string
  war_status: string
  guild_score: number
  opponent_score: number
  war_result: string | null
  war_start_date: string | null
  war_end_date: string | null
  war_season: number | null
  battlefield_level: number | null
  raw_loki_data?: unknown
}

export interface WarStats {
  total_wars: number
  wars_won: number
  wars_lost: number
  wars_drawn: number
  win_rate: number
  current_rank: number | null
  current_streak: number
  streak_type: 'win' | 'loss' | null
  avg_score_differential: number
  recent_form: string
}

export function calculateWarStats(matches: WarMatch[]): WarStats {
  const completedMatches = matches.filter((m) => m.war_status === 'completed')
  const wins = completedMatches.filter((m) => m.war_result === 'win').length
  const losses = completedMatches.filter((m) => m.war_result === 'loss').length
  const draws = completedMatches.filter((m) => m.war_result === 'draw').length
  const winRate =
    completedMatches.length > 0 ? (wins / completedMatches.length) * 100 : 0

  let currentStreak = 0
  let streakType: 'win' | 'loss' | null = null
  const sortedMatches = [...completedMatches].sort(
    (a, b) =>
      new Date(b.war_end_date || 0).getTime() -
      new Date(a.war_end_date || 0).getTime()
  )

  if (sortedMatches.length > 0) {
    const latestMatch = sortedMatches[0]
    const lastResult = latestMatch?.war_result
    if (lastResult === 'win' || lastResult === 'loss') {
      streakType = lastResult
      for (const match of sortedMatches) {
        if (match.war_result === lastResult) {
          currentStreak++
        } else {
          break
        }
      }
    }
  }

  const scoreDifferentials = completedMatches.map(
    (m) => m.guild_score - m.opponent_score
  )
  const avgScoreDifferential =
    scoreDifferentials.length > 0
      ? scoreDifferentials.reduce((a, b) => a + b, 0) /
        scoreDifferentials.length
      : 0

  const recentForm = sortedMatches
    .slice(0, 5)
    .map((m) => {
      switch (m.war_result) {
        case 'win':
          return 'W'
        case 'loss':
          return 'L'
        case 'draw':
          return 'D'
        default:
          return '-'
      }
    })
    .join('')

  return {
    total_wars: completedMatches.length,
    wars_won: wins,
    wars_lost: losses,
    wars_drawn: draws,
    win_rate: winRate,
    current_rank: null,
    current_streak: currentStreak,
    streak_type: streakType,
    avg_score_differential: Math.round(avgScoreDifferential),
    recent_form: recentForm
  }
}
