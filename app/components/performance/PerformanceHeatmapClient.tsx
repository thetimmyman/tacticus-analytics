'use client'

import { Fragment, useMemo, useState } from 'react'
import type {
  TokenPerformanceData,
  TokenPerformanceLoopEntry
} from '@/app/(dashboard)/guild-management/upcoming-assignments/types'
import { aggregateByPlayer } from '@/app/lib/boss-assignments/performance-leaderboard-aggregate'

interface PerformanceHeatmapClientProps {
  tokenPerformance: TokenPerformanceData
  /** Renders a "Primes" checkbox bound to the page-level scope. */
  includePrimes?: boolean
  onIncludePrimesChange?: (next: boolean) => void
}

// Diverging score gradient centred on 1.0 (yellow); clamps at 0.5 and 1.5.
function scoreCellStyle(score: number | null): { bg: string; text: string } {
  if (score === null)
    return { bg: 'transparent', text: 'var(--text-secondary)' }
  const clamped = Math.max(0.5, Math.min(1.5, score))
  if (clamped >= 1) {
    const t = (clamped - 1) / 0.5
    const r = Math.round(234 - t * 100)
    const g = Math.round(179 + t * 50)
    const b = Math.round(8 + t * 120)
    return { bg: `rgb(${r}, ${g}, ${b}, 0.45)`, text: '#fff' }
  } else {
    const t = (clamped - 0.5) / 0.5
    const r = Math.round(220 + t * 14)
    const g = Math.round(60 + t * 119)
    const b = Math.round(60 - t * 52)
    return { bg: `rgb(${r}, ${g}, ${b}, 0.45)`, text: '#fff' }
  }
}

const LOSS_FLOOR_TOKENS = 0.15

// Loss in expected tokens (not damage): tokens_spent × max(0, 1 − score).
function computeLossInTokens(
  entry: { score: number | null; tokensSpent: number } | undefined
): number {
  if (!entry || entry.score === null || entry.tokensSpent <= 0) return 0
  return entry.tokensSpent * Math.max(0, 1 - entry.score)
}

type SortKey =
  | { kind: 'player' }
  | { kind: 'avgScore' }
  | { kind: 'tokens' }
  | { kind: 'bosses' }
  | { kind: 'rankDelta' }
  | { kind: 'bossScore'; boss: string }
  | { kind: 'bossLoss'; boss: string }

function sortKeyEquals(a: SortKey, b: SortKey): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'bossScore' && b.kind === 'bossScore') return a.boss === b.boss
  if (a.kind === 'bossLoss' && b.kind === 'bossLoss') return a.boss === b.boss
  return true
}

// "Name_L2" / "Name_M1" → { name, rarityPrefix, set }; bare names get no badge.
function parseBossKey(key: string): {
  name: string
  rarityPrefix: 'L' | 'M' | null
  set: number | null
} {
  const match = key.match(/^(.+)_([ML])(\d+)$/)
  if (!match) return { name: key, rarityPrefix: null, set: null }
  const rawName = match[1]
  const rarityPrefix = match[2]
  const setNumber = match[3]
  if (
    !rawName ||
    (rarityPrefix !== 'L' && rarityPrefix !== 'M') ||
    !setNumber
  ) {
    return { name: key, rarityPrefix: null, set: null }
  }
  let name = rawName
  if (name === 'Prime1') name = 'Prime 1'
  else if (name === 'Prime2') name = 'Prime 2'
  return {
    name,
    rarityPrefix,
    set: parseInt(setNumber, 10)
  }
}

// "ScreamerKiller" → "Screamer Killer" so long names wrap in the narrow boss columns.
function splitCamelCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

// Loop-scoped tokens-weighted score, same metric as `weightedScore` in `aggregateByPlayer`.
function loopWeightedScore(entries: TokenPerformanceLoopEntry[]): {
  weightedScore: number | null
  tokensSpent: number
  bossCount: number
} {
  let num = 0
  let den = 0
  let tokensSpent = 0
  let bossCount = 0
  entries.forEach((e) => {
    if (e.tokensSpent <= 0) return
    bossCount += 1
    tokensSpent += e.tokensSpent
    if (e.score !== null && Number.isFinite(e.score)) {
      num += e.score * e.tokensSpent
      den += e.tokensSpent
    }
  })
  return {
    weightedScore: den > 0 ? num / den : null,
    tokensSpent,
    bossCount
  }
}

export default function PerformanceHeatmapClient({
  tokenPerformance,
  includePrimes,
  onIncludePrimesChange
}: PerformanceHeatmapClientProps) {
  const [sortKey, setSortKey] = useState<SortKey>({ kind: 'avgScore' })
  const [sortAsc, setSortAsc] = useState(false)
  const [playerFilter, setPlayerFilter] = useState('')
  const [minTokens, setMinTokens] = useState(0)
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(new Set())

  const bossList = useMemo(() => {
    const keys = new Set<string>()
    Object.values(tokenPerformance).forEach((bosses) => {
      Object.keys(bosses).forEach((k) => keys.add(k))
    })
    // Legendary 1-5, then Mythic 1-5, then bare names alphabetically.
    return Array.from(keys).sort((a, b) => {
      const pa = parseBossKey(a)
      const pb = parseBossKey(b)
      const rarityOrder = (p: 'L' | 'M' | null) =>
        p === 'L' ? 0 : p === 'M' ? 1 : 2
      const ra = rarityOrder(pa.rarityPrefix)
      const rb = rarityOrder(pb.rarityPrefix)
      if (ra !== rb) return ra - rb
      if (pa.set !== null && pb.set !== null && pa.set !== pb.set)
        return pa.set - pb.set
      return pa.name.localeCompare(pb.name)
    })
  }, [tokenPerformance])

  // Loop indices in the data, ascending; the latest two define the Δ-rank.
  const loopList = useMemo(() => {
    const set = new Set<number>()
    Object.values(tokenPerformance).forEach((bosses) => {
      Object.values(bosses).forEach((entry) => {
        if (entry.perLoop) {
          Object.keys(entry.perLoop).forEach((k) => {
            const n = Number(k)
            if (Number.isFinite(n)) set.add(n)
          })
        }
      })
    })
    return Array.from(set).sort((a, b) => a - b)
  }, [tokenPerformance])

  const aggregated = useMemo(
    () => aggregateByPlayer(tokenPerformance),
    [tokenPerformance]
  )

  const loopAggByPlayer = useMemo(() => {
    const map = new Map<
      string,
      Map<number, ReturnType<typeof loopWeightedScore>>
    >()
    Object.entries(tokenPerformance).forEach(([playerKey, bosses]) => {
      const loopEntriesByLoop = new Map<number, TokenPerformanceLoopEntry[]>()
      Object.values(bosses).forEach((entry) => {
        if (!entry.perLoop) return
        Object.values(entry.perLoop).forEach((loopEntry) => {
          const arr = loopEntriesByLoop.get(loopEntry.loopIndex) ?? []
          arr.push(loopEntry)
          loopEntriesByLoop.set(loopEntry.loopIndex, arr)
        })
      })
      const inner = new Map<number, ReturnType<typeof loopWeightedScore>>()
      loopEntriesByLoop.forEach((entries, loopIdx) => {
        inner.set(loopIdx, loopWeightedScore(entries))
      })
      map.set(playerKey, inner)
    })
    return map
  }, [tokenPerformance])

  // Δ rank over the latest two loops (positive = moved up); missing players get null.
  const rankDeltaByPlayer = useMemo(() => {
    const result = new Map<string, number | null>()
    if (loopList.length < 2) {
      aggregated.forEach((p) => result.set(p.playerKey ?? p.playerName, null))
      return result
    }
    const latest = loopList[loopList.length - 1]
    const prev = loopList[loopList.length - 2]
    if (latest === undefined || prev === undefined) {
      aggregated.forEach((p) => result.set(p.playerKey ?? p.playerName, null))
      return result
    }
    const rankIn = (loopIdx: number): Map<string, number> => {
      const scored: { name: string; score: number }[] = []
      loopAggByPlayer.forEach((inner, playerName) => {
        const agg = inner.get(loopIdx)
        if (!agg || agg.weightedScore === null) return
        scored.push({ name: playerName, score: agg.weightedScore })
      })
      scored.sort((a, b) => b.score - a.score)
      const ranks = new Map<string, number>()
      scored.forEach((row, i) => ranks.set(row.name, i + 1))
      return ranks
    }
    const prevRanks = rankIn(prev)
    const latestRanks = rankIn(latest)
    aggregated.forEach((p) => {
      const playerKey = p.playerKey ?? p.playerName
      const a = prevRanks.get(playerKey)
      const b = latestRanks.get(playerKey)
      if (a === undefined || b === undefined) {
        result.set(playerKey, null)
        return
      }
      result.set(playerKey, a - b)
    })
    return result
  }, [aggregated, loopAggByPlayer, loopList])

  const filteredAndSorted = useMemo(() => {
    const normalizedFilter = playerFilter.trim().toLowerCase()
    const filtered = aggregated.filter((p) => {
      if (minTokens > 0 && p.tokensSpent < minTokens) return false
      if (
        normalizedFilter &&
        !p.playerName.toLowerCase().includes(normalizedFilter)
      )
        return false
      return true
    })

    const compareNumericNullsLast = (
      a: number | null,
      b: number | null
    ): number => {
      if (a === null && b === null) return 0
      if (a === null) return 1
      if (b === null) return -1
      return a - b
    }

    filtered.sort((a, b) => {
      let cmp = 0
      switch (sortKey.kind) {
        case 'player':
          cmp = a.playerName.localeCompare(b.playerName)
          break
        case 'avgScore':
          cmp = compareNumericNullsLast(a.weightedScore, b.weightedScore)
          break
        case 'tokens':
          cmp = a.tokensSpent - b.tokensSpent
          break
        case 'bosses':
          cmp = a.bossCount - b.bossCount
          break
        case 'rankDelta':
          // Missing entries are undefined too; both sort nulls-last.
          cmp = compareNumericNullsLast(
            rankDeltaByPlayer.get(a.playerKey ?? a.playerName) ?? null,
            rankDeltaByPlayer.get(b.playerKey ?? b.playerName) ?? null
          )
          break
        case 'bossScore': {
          const ea =
            tokenPerformance[a.playerKey ?? a.playerName]?.[sortKey.boss]
          const eb =
            tokenPerformance[b.playerKey ?? b.playerName]?.[sortKey.boss]
          cmp = compareNumericNullsLast(ea?.score ?? null, eb?.score ?? null)
          break
        }
        case 'bossLoss': {
          const la = computeLossInTokens(
            tokenPerformance[a.playerKey ?? a.playerName]?.[sortKey.boss]
          )
          const lb = computeLossInTokens(
            tokenPerformance[b.playerKey ?? b.playerName]?.[sortKey.boss]
          )
          cmp = la - lb
          break
        }
      }
      return sortAsc ? cmp : -cmp
    })
    return filtered
  }, [
    aggregated,
    tokenPerformance,
    sortKey,
    sortAsc,
    playerFilter,
    minTokens,
    rankDeltaByPlayer
  ])

  const handleSort = (key: SortKey) => {
    if (sortKeyEquals(key, sortKey)) {
      setSortAsc((prev) => !prev)
    } else {
      setSortKey(key)
      setSortAsc(key.kind === 'player') // names default asc, numerics default desc
    }
  }

  const sortIndicator = (key: SortKey) =>
    sortKeyEquals(key, sortKey) ? (sortAsc ? ' ▲' : ' ▼') : ''

  const togglePlayer = (playerKey: string) => {
    setExpandedPlayers((prev) => {
      const next = new Set(prev)
      if (next.has(playerKey)) next.delete(playerKey)
      else next.add(playerKey)
      return next
    })
  }

  const hasPerLoop = loopList.length > 0

  if (aggregated.length === 0) {
    return (
      <div className="bg-card/50 rounded-lg border border-[color-mix(in_srgb,var(--primary)_20%,transparent)] p-8 text-center">
        <p className="text-amber-100/70">
          No token performance data for this season.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-card/50 rounded-lg border border-[color-mix(in_srgb,var(--primary)_20%,transparent)] overflow-hidden">
      <div className="p-4 border-b border-[color-mix(in_srgb,var(--primary)_20%,transparent)] flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-(--primary)">
            Summary by Boss
          </h2>
          <p className="text-xs text-amber-100/60 mt-1">
            Per-player, per-boss token-equivalent score.
            <span className="text-green-400"> Green</span> = overperforming
            (score &gt; 1).
            <span className="text-red-400"> Red</span> = underperforming. The
            small −n.nn under a score is the loss in token-equivalent units: how
            many expected tokens-worth of damage the player owed but didn&apos;t
            deliver (losses under {LOSS_FLOOR_TOKENS} tokens are hidden; hover a
            cell for exact values).
            {hasPerLoop &&
              ' Click ▸ on a player row to drill into per-loop performance. Δ shows rank change between the latest two loops.'}{' '}
            Click a boss name (or its S / L buttons) to sort by that boss&apos;s
            score / loss; click again to flip direction.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {includePrimes !== undefined && onIncludePrimesChange && (
            <label
              className="flex items-center gap-1 text-amber-100/70"
              title="Include prime encounters in scores, columns, and the tables on this page. Mirrors the Compare buttons above — “Boss Only” = primes excluded."
            >
              <input
                type="checkbox"
                checked={includePrimes}
                onChange={(e) => onIncludePrimesChange(e.target.checked)}
                className="h-3 w-3"
              />
              Primes
            </label>
          )}
          <input
            type="text"
            value={playerFilter}
            onChange={(e) => setPlayerFilter(e.target.value)}
            placeholder="Filter player…"
            className="px-2 py-1 rounded-sm bg-(--bg-primary) border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] text-primary-wh40k placeholder-amber-100/40 focus:outline-hidden focus:border-[color-mix(in_srgb,var(--primary)_60%,transparent)]"
          />
          <label className="flex items-center gap-1 text-amber-100/70">
            Min tokens:
            <input
              type="number"
              min={0}
              value={minTokens}
              onChange={(e) =>
                setMinTokens(Math.max(0, Number(e.target.value) || 0))
              }
              className="w-14 px-2 py-1 rounded-sm bg-(--bg-primary) border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] text-primary-wh40k focus:outline-hidden focus:border-[color-mix(in_srgb,var(--primary)_60%,transparent)]"
            />
          </label>
          <span className="text-amber-100/50">
            {filteredAndSorted.length} / {aggregated.length} players
          </span>
        </div>
      </div>
      <div className="overflow-auto max-h-[75vh]">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-(--bg-primary)">
            <tr className="border-b border-[color-mix(in_srgb,var(--primary)_30%,transparent)]">
              {hasPerLoop && (
                <th className="sticky left-0 z-20 bg-(--bg-primary) px-1 py-2 w-6"></th>
              )}
              <th
                className={`sticky ${hasPerLoop ? 'left-6' : 'left-0'} z-20 bg-(--bg-primary) px-3 py-2 text-left font-medium text-amber-100/80 whitespace-nowrap cursor-pointer hover:text-(--primary)`}
                onClick={() => handleSort({ kind: 'player' })}
              >
                Player{sortIndicator({ kind: 'player' })}
              </th>
              {bossList.map((boss) => {
                const parsed = parseBossKey(boss)
                const prefix =
                  parsed.rarityPrefix && parsed.set !== null
                    ? `${parsed.rarityPrefix}${parsed.set}`
                    : null
                const prefixColor =
                  parsed.rarityPrefix === 'M'
                    ? 'text-purple-300'
                    : 'text-amber-300'
                return (
                  <th
                    key={boss}
                    className="px-1 pt-2 pb-1 text-center align-bottom font-medium text-amber-100/80 border-l border-[color-mix(in_srgb,var(--primary)_20%,transparent)] cursor-pointer hover:text-(--primary)"
                    onClick={() => handleSort({ kind: 'bossScore', boss })}
                    title={`${splitCamelCase(parsed.name)} — click to sort by this boss's score`}
                  >
                    {/* Vertical names keep ~13 columns on a laptop; clipped names show via the th tooltip. */}
                    <div className="flex flex-col items-center justify-end gap-1">
                      <div
                        className="whitespace-nowrap leading-none text-[10px]"
                        style={{
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                          maxHeight: 104,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {splitCamelCase(parsed.name)}
                      </div>
                      {prefix && (
                        <div
                          className={`text-[10px] font-semibold leading-none ${prefixColor}`}
                        >
                          {prefix}
                        </div>
                      )}
                    </div>
                  </th>
                )
              })}
              <th
                className="px-3 py-2 text-right font-medium text-amber-100/80 border-l border-[color-mix(in_srgb,var(--primary)_20%,transparent)] whitespace-nowrap cursor-pointer hover:text-(--primary)"
                onClick={() => handleSort({ kind: 'tokens' })}
              >
                Tokens{sortIndicator({ kind: 'tokens' })}
              </th>
              <th
                className="px-3 py-2 text-right font-medium text-amber-100/80 whitespace-nowrap cursor-pointer hover:text-(--primary)"
                onClick={() => handleSort({ kind: 'bosses' })}
              >
                Bosses{sortIndicator({ kind: 'bosses' })}
              </th>
              <th
                className="px-3 py-2 text-right font-medium text-amber-100/80 whitespace-nowrap cursor-pointer hover:text-(--primary)"
                onClick={() => handleSort({ kind: 'avgScore' })}
              >
                Avg Score{sortIndicator({ kind: 'avgScore' })}
              </th>
              {hasPerLoop && (
                <th
                  className="px-3 py-2 text-right font-medium text-amber-100/80 whitespace-nowrap cursor-pointer hover:text-(--primary)"
                  onClick={() => handleSort({ kind: 'rankDelta' })}
                  title="Rank change from the previous loop to the latest loop, ranked across the full guild (not affected by the player/min-tokens filter). Green ▲ = improved."
                >
                  Δ Rank{sortIndicator({ kind: 'rankDelta' })}
                </th>
              )}
            </tr>
            <tr className="border-b border-[color-mix(in_srgb,var(--primary)_30%,transparent)] text-[10px] text-amber-100/50">
              {hasPerLoop && (
                <th className="sticky left-0 z-20 bg-(--bg-primary) px-1 py-1 w-6"></th>
              )}
              <th
                className={`sticky ${hasPerLoop ? 'left-6' : 'left-0'} z-20 bg-(--bg-primary) px-3 py-1`}
              ></th>
              {bossList.map((boss) => (
                <th
                  key={`sub-${boss}`}
                  className="px-1 py-1 text-center border-l border-[color-mix(in_srgb,var(--primary)_20%,transparent)] whitespace-nowrap"
                >
                  <button
                    type="button"
                    title="Sort by this boss's score"
                    aria-label="Sort by this boss's score"
                    className="cursor-pointer hover:text-(--primary)"
                    onClick={() => handleSort({ kind: 'bossScore', boss })}
                  >
                    S{sortIndicator({ kind: 'bossScore', boss })}
                  </button>
                  <span className="px-0.5 text-amber-100/30">·</span>
                  <button
                    type="button"
                    title="Sort by this boss's loss"
                    aria-label="Sort by this boss's loss"
                    className="cursor-pointer hover:text-(--primary)"
                    onClick={() => handleSort({ kind: 'bossLoss', boss })}
                  >
                    L{sortIndicator({ kind: 'bossLoss', boss })}
                  </button>
                </th>
              ))}
              <th className="px-3 py-1"></th>
              <th className="px-3 py-1"></th>
              <th className="px-3 py-1"></th>
              {hasPerLoop && <th className="px-3 py-1"></th>}
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.map((player) => {
              const playerKey = player.playerKey ?? player.playerName
              const playerBosses = tokenPerformance[playerKey] ?? {}
              const isExpanded = expandedPlayers.has(playerKey)
              const playerLoopAgg = loopAggByPlayer.get(playerKey)
              const rankDelta = rankDeltaByPlayer.get(playerKey) ?? null
              const hasLoopData =
                hasPerLoop &&
                playerLoopAgg !== undefined &&
                playerLoopAgg.size > 0
              return (
                <Fragment key={playerKey}>
                  <tr className="border-t border-(--card-border)">
                    {hasPerLoop && (
                      <td className="sticky left-0 z-10 bg-(--bg-primary) px-1 py-1 text-center w-6">
                        {hasLoopData ? (
                          <button
                            type="button"
                            onClick={() => togglePlayer(playerKey)}
                            aria-expanded={isExpanded}
                            aria-label={
                              isExpanded
                                ? 'Collapse per-loop view'
                                : 'Expand per-loop view'
                            }
                            className="text-amber-100/60 hover:text-(--primary) font-mono text-xs leading-none"
                          >
                            {isExpanded ? '▾' : '▸'}
                          </button>
                        ) : null}
                      </td>
                    )}
                    <td
                      className={`sticky ${hasPerLoop ? 'left-6' : 'left-0'} z-10 bg-(--bg-primary) px-3 py-1 font-medium text-primary-wh40k whitespace-nowrap`}
                    >
                      {player.playerName}
                    </td>
                    {bossList.map((boss) => {
                      const entry = playerBosses[boss]
                      const score = entry?.score ?? null
                      const loss = computeLossInTokens(entry)
                      const scoreStyle = scoreCellStyle(score)
                      const tooltip = entry
                        ? `Tokens: ${entry.tokensSpent}\nScore: ${score !== null ? score.toFixed(2) : '—'}\nLoss (tokens): ${score !== null ? loss.toFixed(2) : 'n/a'}`
                        : ''
                      return (
                        <td
                          key={`${playerKey}-${boss}`}
                          className="px-1 py-0.5 text-center border-l border-[color-mix(in_srgb,var(--primary)_10%,transparent)] font-mono text-[11px]"
                          style={{
                            backgroundColor: scoreStyle.bg,
                            color: scoreStyle.text
                          }}
                          title={tooltip}
                        >
                          {/* Two lines at roughly single-line row height. */}
                          <div className="leading-[13px]">
                            {score !== null ? score.toFixed(2) : '—'}
                          </div>
                          {loss >= LOSS_FLOOR_TOKENS && (
                            <div className="text-[9px] leading-[10px] opacity-80">
                              −{loss.toFixed(2)}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-3 py-1 text-right text-secondary-wh40k border-l border-[color-mix(in_srgb,var(--primary)_20%,transparent)] font-mono">
                      {player.tokensSpent}
                    </td>
                    <td className="px-3 py-1 text-right text-secondary-wh40k font-mono">
                      {player.bossCount}
                    </td>
                    <td
                      className="px-3 py-1 text-right font-mono font-semibold border-l border-[color-mix(in_srgb,var(--primary)_20%,transparent)]"
                      style={
                        player.weightedScore !== null
                          ? {
                              backgroundColor: scoreCellStyle(
                                player.weightedScore
                              ).bg,
                              color: scoreCellStyle(player.weightedScore).text
                            }
                          : { color: 'var(--text-secondary)' }
                      }
                    >
                      {player.weightedScore !== null
                        ? player.weightedScore.toFixed(2)
                        : '—'}
                    </td>
                    {hasPerLoop && (
                      <td
                        className="px-3 py-1 text-right font-mono font-semibold"
                        style={{
                          color:
                            rankDelta === null
                              ? 'var(--text-secondary)'
                              : rankDelta > 0
                                ? '#34d399'
                                : rankDelta < 0
                                  ? '#f87171'
                                  : 'var(--text-secondary)'
                        }}
                        title={
                          rankDelta === null
                            ? 'No comparable loop history'
                            : `Rank moved by ${Math.abs(rankDelta)} between the previous loop and the latest loop`
                        }
                      >
                        {rankDelta === null
                          ? '—'
                          : rankDelta === 0
                            ? '—'
                            : rankDelta > 0
                              ? `▲ ${rankDelta}`
                              : `▼ ${Math.abs(rankDelta)}`}
                      </td>
                    )}
                  </tr>
                  {isExpanded &&
                    hasLoopData &&
                    loopList.map((loopIdx) => {
                      const loopAgg = playerLoopAgg!.get(loopIdx)
                      if (!loopAgg) return null
                      return (
                        <tr
                          key={`${playerKey}-loop-${loopIdx}`}
                          className="bg-card/40 border-t border-card-border/40"
                        >
                          <td className="sticky left-0 z-10 bg-card/40 px-1 py-1 w-6"></td>
                          <td
                            className={`sticky left-6 z-10 bg-card/40 px-3 py-1 text-amber-100/60 italic whitespace-nowrap pl-6`}
                          >
                            ↳ Loop {loopIdx + 1}
                          </td>
                          {bossList.map((boss) => {
                            const entry = playerBosses[boss]
                            const loopEntry = entry?.perLoop?.[loopIdx]
                            const score = loopEntry?.score ?? null
                            const loopEntryForLoss = loopEntry
                              ? {
                                  score: loopEntry.score,
                                  tokensSpent: loopEntry.tokensSpent
                                }
                              : undefined
                            const loss = computeLossInTokens(loopEntryForLoss)
                            const scoreStyle = scoreCellStyle(score)
                            // Null score: expected tokens unresolved, so loss shows "n/a", not "0.00".
                            const tooltip = loopEntry
                              ? `Loop ${loopIdx + 1}\nTokens: ${loopEntry.tokensSpent}\nScore: ${score !== null ? score.toFixed(2) : '—'}\nLoss (tokens): ${score !== null ? loss.toFixed(2) : 'n/a'}`
                              : `Loop ${loopIdx + 1}\nNo attacks`
                            return (
                              <td
                                key={`${playerKey}-${boss}-loop-${loopIdx}`}
                                className="px-1 py-0.5 text-center border-l border-[color-mix(in_srgb,var(--primary)_10%,transparent)] font-mono text-[11px]"
                                style={{
                                  backgroundColor: scoreStyle.bg,
                                  color: scoreStyle.text
                                }}
                                title={tooltip}
                              >
                                <div className="leading-[13px]">
                                  {score !== null ? score.toFixed(2) : '—'}
                                </div>
                                {loss >= LOSS_FLOOR_TOKENS && (
                                  <div className="text-[9px] leading-[10px] opacity-80">
                                    −{loss.toFixed(2)}
                                  </div>
                                )}
                              </td>
                            )
                          })}
                          <td className="px-3 py-1 text-right text-secondary-wh40k border-l border-[color-mix(in_srgb,var(--primary)_20%,transparent)] font-mono">
                            {loopAgg.tokensSpent}
                          </td>
                          <td className="px-3 py-1 text-right text-secondary-wh40k font-mono">
                            {loopAgg.bossCount}
                          </td>
                          <td
                            className="px-3 py-1 text-right font-mono border-l border-[color-mix(in_srgb,var(--primary)_20%,transparent)]"
                            style={
                              loopAgg.weightedScore !== null
                                ? {
                                    backgroundColor: scoreCellStyle(
                                      loopAgg.weightedScore
                                    ).bg,
                                    color: scoreCellStyle(loopAgg.weightedScore)
                                      .text
                                  }
                                : { color: 'var(--text-secondary)' }
                            }
                          >
                            {loopAgg.weightedScore !== null
                              ? loopAgg.weightedScore.toFixed(2)
                              : '—'}
                          </td>
                          <td className="px-3 py-1"></td>
                        </tr>
                      )
                    })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
