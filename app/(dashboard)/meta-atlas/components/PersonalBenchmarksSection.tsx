'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Gauge } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { PerformanceGapCard, PerformanceGapSummary } from './PerformanceGapCard'

interface PerformanceGap {
  boss_type: string
  rarity: string
  team_composition: string
  team_hash: string
  player_avg_damage: number
  meta_avg_damage: number
  meta_p90_damage: number
  gap_percentage: number
  improvement_potential: number
  attack_count: number
}

interface PersonalBenchmarksSectionProps {
  guildCode: string
  userDisplayName?: string
}

export function PersonalBenchmarksSection({
  guildCode,
  userDisplayName = ''
}: PersonalBenchmarksSectionProps) {
  const [playerName, setPlayerName] = useState(userDisplayName)
  const [gaps, setGaps] = useState<PerformanceGap[]>([])
  const [summary, setSummary] = useState<{
    teams_analyzed: number
    teams_with_meta_data?: number
    teams_skipped_low_attacks?: number
    teams_no_meta_match?: number
    gaps_found: number
    total_improvement_potential: number
    overall_percentile?: number | null
    overall_tier?:
      | 'elite'
      | 'excellent'
      | 'above_average'
      | 'average'
      | 'below_average'
      | 'needs_improvement'
      | null
    tier_distribution?: {
      elite: number
      excellent: number
      above_average: number
      average: number
      below_average: number
      needs_improvement: number
    }
    top_performers?: Array<{
      boss_type: string
      rarity: string
      team_composition: string
      team_hash: string
      player_avg_damage: number
      meta_avg_damage: number
      meta_p75_damage: number
      meta_p90_damage: number
      percentile: number
      tier:
        | 'elite'
        | 'excellent'
        | 'above_average'
        | 'average'
        | 'below_average'
        | 'needs_improvement'
      attack_count: number
      vs_average_pct: number
    }>
    watch_list?: Array<{
      boss_type: string
      rarity: string
      team_composition: string
      team_hash: string
      player_avg_damage: number
      meta_avg_damage: number
      meta_p75_damage: number
      meta_p90_damage: number
      percentile: number
      tier:
        | 'elite'
        | 'excellent'
        | 'above_average'
        | 'average'
        | 'below_average'
        | 'needs_improvement'
      attack_count: number
      vs_average_pct: number
    }>
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const hasAutoSearchedRef = useRef(false)

  const searchGaps = useCallback(
    async (name?: string) => {
      const searchName = name ?? playerName
      if (!searchName.trim()) return

      setLoading(true)
      setSearched(true)
      try {
        const params = new URLSearchParams({
          player_name: searchName.trim(),
          guild_code: guildCode,
          min_attacks: '3',
          min_gap_pct: '10',
          limit: '10'
        })
        const res = await fetch(`/api/meta/performance-gaps?${params}`)
        const data = await res.json()
        setGaps(data.gaps || [])
        setSummary(data.summary || null)
      } catch {
        setGaps([])
        setSummary(null)
      } finally {
        setLoading(false)
      }
    },
    [playerName, guildCode]
  )

  useEffect(() => {
    if (userDisplayName && !hasAutoSearchedRef.current) {
      hasAutoSearchedRef.current = true
      searchGaps(userDisplayName)
    }
  }, [userDisplayName, searchGaps])

  return (
    <div className="space-y-6">
      <Card className="bg-[var(--card-bg)] border-[var(--card-border)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-purple-400" />
            Find Your Performance Gaps
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchGaps()}
              placeholder="Enter your player name..."
              className="flex-1 px-4 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <Button
              onClick={() => searchGaps()}
              disabled={loading || !playerName.trim()}
              className="bg-purple-500 hover:bg-purple-600"
            >
              {loading ? <LoadingSpinner /> : 'Analyze'}
            </Button>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            We&apos;ll compare your team performances against meta averages to
            identify areas for improvement.
          </p>
        </CardContent>
      </Card>

      {searched && summary && (
        <PerformanceGapSummary
          gaps={gaps}
          playerName={playerName}
          totalImprovementPotential={summary.total_improvement_potential}
          overallPercentile={summary.overall_percentile}
          overallTier={summary.overall_tier}
          tierDistribution={summary.tier_distribution}
          topPerformers={summary.top_performers}
          watchList={summary.watch_list}
          teamsWithMetaData={summary.teams_with_meta_data}
          teamsAnalyzed={summary.teams_analyzed}
          teamsSkippedLowAttacks={summary.teams_skipped_low_attacks}
          teamsNoMetaMatch={summary.teams_no_meta_match}
        />
      )}

      {gaps.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {gaps.map((gap, i) => (
            <PerformanceGapCard key={gap.team_hash} gap={gap} rank={i + 1} />
          ))}
        </div>
      )}

      {searched && !loading && gaps.length === 0 && (
        <Card className="bg-[var(--card-bg)] border-[var(--card-border)]">
          <CardContent className="py-8 text-center text-[var(--text-secondary)]">
            {summary?.teams_analyzed === 0
              ? 'No battle data found for this player in the current season.'
              : 'Great job! No significant performance gaps found.'}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
