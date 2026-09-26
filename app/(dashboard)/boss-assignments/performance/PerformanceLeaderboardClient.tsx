'use client'

import { useMemo, useState } from 'react'
import SeasonSelector from '@/app/components/SeasonSelector'
import type { TokenPerformanceData } from '@/app/(dashboard)/guild-management/upcoming-assignments/types'
import {
  aggregateByPlayer,
  summarizeGuild,
  type PlayerAggregateRow
} from '@/app/lib/boss-assignments/performance-leaderboard-aggregate'

interface PerformanceLeaderboardClientProps {
  tokenPerformance: TokenPerformanceData
  latestSeason: string
  selectedSeason: string
  guildCode: string
}

type SortKey = 'name' | 'tokens' | 'score' | 'bosses'

function scoreColorClass(score: number): string {
  if (score >= 1.15) return 'text-green-400'
  if (score >= 0.85) return 'text-amber-100'
  return 'text-red-400'
}

export default function PerformanceLeaderboardClient({
  tokenPerformance,
  latestSeason,
  selectedSeason
}: PerformanceLeaderboardClientProps) {
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortAsc, setSortAsc] = useState(false)

  const rows: PlayerAggregateRow[] = useMemo(
    () => aggregateByPlayer(tokenPerformance),
    [tokenPerformance]
  )
  const summary = useMemo(() => summarizeGuild(rows), [rows])

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'name':
          cmp = a.playerName.localeCompare(b.playerName)
          break
        case 'tokens':
          cmp = a.tokensSpent - b.tokensSpent
          break
        case 'bosses':
          cmp = a.bossCount - b.bossCount
          break
        case 'score': {
          const sa = a.weightedScore
          const sb = b.weightedScore
          if (sa === null && sb === null) cmp = 0
          else if (sa === null) cmp = 1
          else if (sb === null) cmp = -1
          else cmp = sa - sb
          break
        }
      }
      return sortAsc ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev)
    } else {
      setSortKey(key)
      setSortAsc(key === 'name') // names default ascending; numerics default descending
    }
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : ''

  const subNav = (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <SeasonSelector currentSeason={selectedSeason} compact />
    </div>
  )

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        {subNav}
        <div className="bg-card/50 rounded-lg border border-[color-mix(in_srgb,var(--primary)_20%,transparent)] p-8 text-center">
          <p className="text-amber-100/70">
            No token performance data yet for season {selectedSeason}. Scores
            will populate after players complete attacks.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {subNav}
      {/* Summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile label="Players" value={summary.playerCount.toString()} />
        <SummaryTile
          label="Guild avg"
          value={summary.mean !== null ? summary.mean.toFixed(2) : '\u2014'}
          colorClass={
            summary.mean !== null
              ? scoreColorClass(summary.mean)
              : 'text-amber-100'
          }
        />
        <SummaryTile
          label="Median"
          value={summary.median !== null ? summary.median.toFixed(2) : '\u2014'}
          colorClass={
            summary.median !== null
              ? scoreColorClass(summary.median)
              : 'text-amber-100'
          }
        />
        <SummaryTile
          label="At or above 1.0"
          value={
            summary.pctAtOrAbove !== null
              ? `${summary.pctAtOrAbove.toFixed(0)}%`
              : '\u2014'
          }
        />
      </div>

      {/* Leaderboard */}
      <div className="bg-card/50 rounded-lg border border-[color-mix(in_srgb,var(--primary)_20%,transparent)] overflow-hidden">
        <div className="p-4 border-b border-[color-mix(in_srgb,var(--primary)_20%,transparent)]">
          <h2 className="text-lg font-semibold text-[var(--primary)]">
            Token Performance Leaderboard
          </h2>
          <p className="text-xs text-amber-100/60 mt-1">
            Season {selectedSeason}
            {selectedSeason !== latestSeason && ' (historical)'}. Weighted score
            = actual damage / expected damage (summed across all bosses
            attacked). Expected damage per token = boss HP / anticipated tokens
            to kill.
          </p>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full">
            <thead className="sticky top-0 bg-[var(--bg-primary)] border-b border-[color-mix(in_srgb,var(--primary)_30%,transparent)]">
              <tr>
                <th
                  className="px-4 py-3 text-left text-sm font-medium text-amber-100/80 cursor-pointer hover:text-[var(--primary)]"
                  onClick={() => toggleSort('name')}
                >
                  Player{sortIndicator('name')}
                </th>
                <th
                  className="px-4 py-3 text-center text-sm font-medium text-amber-100/80 cursor-pointer hover:text-[var(--primary)]"
                  onClick={() => toggleSort('bosses')}
                >
                  Bosses{sortIndicator('bosses')}
                </th>
                <th
                  className="px-4 py-3 text-center text-sm font-medium text-amber-100/80 cursor-pointer hover:text-[var(--primary)]"
                  onClick={() => toggleSort('tokens')}
                >
                  Tokens{sortIndicator('tokens')}
                </th>
                <th className="px-4 py-3 text-center text-sm font-medium text-amber-100/80">
                  Expected
                </th>
                <th
                  className="px-4 py-3 text-center text-sm font-medium text-amber-100/80 cursor-pointer hover:text-[var(--primary)]"
                  onClick={() => toggleSort('score')}
                >
                  Weighted Score{sortIndicator('score')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-500/10">
              {sortedRows.map((row) => (
                <tr
                  key={row.playerName}
                  className="hover:bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] transition-colors"
                >
                  <td className="px-4 py-2 text-sm font-medium text-amber-100">
                    {row.playerName}
                  </td>
                  <td
                    className="px-4 py-2 text-sm text-center text-amber-100/80"
                    title={
                      row.scoredBossCount < row.bossCount
                        ? `${row.scoredBossCount} of ${row.bossCount} bosses scored — the rest lack enough history for a fair denominator (novel tier).`
                        : undefined
                    }
                  >
                    {row.scoredBossCount < row.bossCount ? (
                      <span>
                        {row.scoredBossCount}
                        <span className="text-amber-100/40">
                          /{row.bossCount}
                        </span>
                      </span>
                    ) : (
                      row.bossCount
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm text-center text-amber-100/80">
                    {row.tokensSpent}
                  </td>
                  <td className="px-4 py-2 text-sm text-center text-amber-100/60">
                    {row.expectedTokens > 0
                      ? row.expectedTokens.toFixed(1)
                      : '\u2014'}
                  </td>
                  <td className="px-4 py-2 text-sm text-center">
                    {row.weightedScore !== null ? (
                      <span
                        className={`font-semibold ${scoreColorClass(row.weightedScore)}`}
                      >
                        {row.weightedScore.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-amber-100/40">{'\u2014'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SummaryTile({
  label,
  value,
  colorClass = 'text-amber-100'
}: {
  label: string
  value: string
  colorClass?: string
}) {
  return (
    <div className="bg-card/50 rounded-lg border border-[color-mix(in_srgb,var(--primary)_20%,transparent)] p-3">
      <div className="text-xs text-amber-100/60">{label}</div>
      <div className={`text-xl font-semibold ${colorClass}`}>{value}</div>
    </div>
  )
}
