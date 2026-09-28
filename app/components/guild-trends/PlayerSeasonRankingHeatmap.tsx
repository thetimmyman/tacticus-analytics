'use client'

import { useMemo, useState } from 'react'
import type { PerformanceMode } from '@tacticus/app-core/performance-calculations.types'
import { usePlayerSeasonRankings } from '@/app/lib/hooks/usePlayerSeasonRankings'
import { MemberName } from '@/app/components/ui/MemberName'
import type {
  PlayerSeasonRankingRow,
  RosterScope
} from '@/app/lib/calculations/experimental/player-season-rankings'

/**
 * Rows = players, columns = recent completed seasons, cell = % vs guild average. Only
 * `mode` and the window feed the query; scope and sort filter client-side.
 */

export interface PlayerSeasonRankingHeatmapProps {
  guildCode: string
  latestSeason: string
}

type WindowSize = 5 | 10

// Target weighting is capped at 5 seasons server-side (MAX_SEASONS), so its
// window never exceeds this; avoids empty S-6..S-10 columns.
const TARGET_MAX_SEASONS = 5

type SortKey =
  { kind: 'avg' } | { kind: 'player' } | { kind: 'season'; season: string }

const MODE_OPTIONS: ReadonlyArray<{ value: PerformanceMode; label: string }> = [
  { value: 'battle-weighted', label: 'Battle Weighting' },
  { value: 'token-weighted', label: 'Token Weighting' },
  { value: 'target-weighted', label: 'Target Weighting' }
]

const ROSTER_OPTIONS: ReadonlyArray<{ value: RosterScope; label: string }> = [
  { value: 'current', label: 'Current Members' },
  { value: 'all', label: 'Anyone Who Attacked' }
]

const segBtn = (active: boolean): string =>
  `px-3 py-2 rounded text-sm font-medium transition-all duration-300 border ${
    active
      ? 'bg-accent-wh40k text-(--bg-primary) border-accent-wh40k'
      : 'bg-card-bg border-primary-wh40k text-primary-wh40k hover:text-accent-wh40k'
  }`

/** Diverging colour centred on 0 (not 1.0); ±40% is full alpha. */
function vsGuildCellStyle(pct: number | null): {
  backgroundColor: string
  color: string
} {
  if (pct === null) {
    return { backgroundColor: 'transparent', color: 'var(--text-secondary)' }
  }
  const t = Math.min(1, Math.abs(pct) / 40)
  const alpha = 0.12 + t * 0.5
  const rgb = pct >= 0 ? '52, 211, 153' : '248, 113, 113'
  return { backgroundColor: `rgba(${rgb}, ${alpha})`, color: '#fff' }
}

const fmtPct = (pct: number | null): string =>
  pct === null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`

/** Honours direction; nulls always last. */
function sortRows(
  rows: PlayerSeasonRankingRow[],
  sortKey: SortKey,
  sortAsc: boolean
): PlayerSeasonRankingRow[] {
  const valueOf = (r: PlayerSeasonRankingRow): number | null => {
    if (sortKey.kind === 'avg') return r.avg
    if (sortKey.kind === 'season')
      return r.cellsBySeason[sortKey.season] ?? null
    return null // 'player' sorts by name below
  }
  const dir = sortAsc ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sortKey.kind === 'player') {
      return dir * a.displayName.localeCompare(b.displayName)
    }
    const av = valueOf(a)
    const bv = valueOf(b)
    if (av === null && bv === null) return 0
    if (av === null) return 1 // nulls last regardless of direction
    if (bv === null) return -1
    return dir * (av - bv)
  })
}

export function PlayerSeasonRankingHeatmap({
  guildCode,
  latestSeason
}: PlayerSeasonRankingHeatmapProps) {
  const [mode, setMode] = useState<PerformanceMode>('battle-weighted')
  const [rosterScope, setRosterScope] = useState<RosterScope>('current')
  const [windowSize, setWindowSize] = useState<WindowSize>(5)
  const [sortKey, setSortKey] = useState<SortKey>({ kind: 'avg' })
  const [sortAsc, setSortAsc] = useState(false)

  const effectiveWindowSize =
    mode === 'target-weighted'
      ? Math.min(windowSize, TARGET_MAX_SEASONS)
      : windowSize
  const targetWindowClamped =
    mode === 'target-weighted' && windowSize > TARGET_MAX_SEASONS

  // Last N completed seasons, newest first; the in-progress season's % is unstable.
  const visibleSeasons = useMemo(() => {
    const latest = parseInt(latestSeason, 10)
    if (Number.isNaN(latest)) return []
    return Array.from({ length: effectiveWindowSize }, (_, i) =>
      String(latest - 1 - i)
    )
  }, [latestSeason, effectiveWindowSize])

  const { data, isLoading } = usePlayerSeasonRankings(
    guildCode,
    visibleSeasons,
    {
      mode
    }
  )

  const rows = useMemo<PlayerSeasonRankingRow[]>(() => {
    const all = data?.rows ?? []
    const scoped =
      rosterScope === 'current' ? all.filter((r) => r.isCurrent) : all
    return sortRows(scoped, sortKey, sortAsc)
  }, [data, rosterScope, sortKey, sortAsc])

  const toggleSort = (next: SortKey) => {
    const same =
      next.kind === sortKey.kind &&
      (next.kind !== 'season' ||
        (sortKey.kind === 'season' && next.season === sortKey.season))
    if (same) {
      setSortAsc((a) => !a)
    } else {
      setSortKey(next)
      setSortAsc(false)
    }
  }

  const sortIndicator = (key: SortKey): string => {
    const active =
      key.kind === sortKey.kind &&
      (key.kind !== 'season' ||
        (sortKey.kind === 'season' && key.season === sortKey.season))
    if (!active) return ''
    return sortAsc ? ' ▲' : ' ▼'
  }

  return (
    <div className="card-wh40k p-4 overflow-x-auto">
      <h3 className="subheading-wh40k text-green-400 text-base sm:text-lg mb-1">
        Player Season Ranking — vs Guild Average
      </h3>
      <p className="text-xs text-secondary-wh40k mb-3">
        % vs guild average · Legendary + Mythic · sorted by average
        {targetWindowClamped
          ? ' · target weighting is limited to the last 5 completed seasons'
          : ''}
      </p>

      {/* Controls */}
      <div className="card-wh40k p-4 mb-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div>
          <label className="block text-sm font-medium mb-2 text-accent-wh40k">
            Scoring Basis:
          </label>
          <div className="grid grid-cols-3 gap-2">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                className={segBtn(mode === opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-accent-wh40k">
            Roster:
          </label>
          <div className="grid grid-cols-2 gap-2">
            {ROSTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRosterScope(opt.value)}
                className={segBtn(rosterScope === opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-accent-wh40k">
            Seasons:
          </label>
          <div className="grid grid-cols-2 gap-2">
            {([5, 10] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindowSize(w)}
                className={segBtn(windowSize === w)}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-secondary-wh40k py-6 text-center">
          Loading player rankings…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-secondary-wh40k py-6 text-center">
          No player ranking data for this selection.
        </p>
      ) : (
        <table className="min-w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-card-bg">
            <tr className="text-left text-xs uppercase tracking-wide text-secondary-wh40k border-b border-(--card-border)">
              <th
                className="sticky left-0 z-20 bg-card-bg px-3 py-2 cursor-pointer select-none"
                onClick={() => toggleSort({ kind: 'player' })}
              >
                Player{sortIndicator({ kind: 'player' })}
              </th>
              {visibleSeasons.map((season) => (
                <th
                  key={season}
                  className="px-3 py-2 text-right cursor-pointer select-none whitespace-nowrap"
                  onClick={() => toggleSort({ kind: 'season', season })}
                >
                  S{season}
                  {sortIndicator({ kind: 'season', season })}
                </th>
              ))}
              <th
                className="px-3 py-2 text-right cursor-pointer select-none"
                onClick={() => toggleSort({ kind: 'avg' })}
              >
                Avg{sortIndicator({ kind: 'avg' })}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.playerId}
                className="border-t border-[color-mix(in_srgb,var(--card-border)_60%,transparent)]"
              >
                <td className="sticky left-0 z-10 bg-card-bg px-3 py-2 font-medium text-primary-wh40k whitespace-nowrap">
                  <MemberName value={row.displayName} />
                </td>
                {visibleSeasons.map((season) => {
                  const pct = row.cellsBySeason[season] ?? null
                  return (
                    <td
                      key={season}
                      className="px-3 py-2 text-right font-mono whitespace-nowrap"
                      style={vsGuildCellStyle(pct)}
                    >
                      {fmtPct(pct)}
                    </td>
                  )
                })}
                <td
                  className="px-3 py-2 text-right font-mono font-bold whitespace-nowrap"
                  style={vsGuildCellStyle(row.avg)}
                >
                  {fmtPct(row.avg)}
                  <span className="ml-1 text-[10px] font-normal opacity-70">
                    ({row.seasonsPlayed}/{effectiveWindowSize})
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
