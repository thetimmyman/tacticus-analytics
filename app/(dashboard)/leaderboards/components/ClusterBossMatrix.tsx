'use client'

import { useState, useEffect, useMemo } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { useDataContext } from '@/app/lib/hooks/useDataContext'
import { formatNumber } from '@tacticus/app-core/formatters'
import { Skeleton } from '@tacticus/ui-kit/loading'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { GUILD_DISPLAY_COMPACT } from '@/app/lib/guild-config-selects'
import {
  getClusterBossMatrixRPC,
  buildClusterBossMatrices,
  type ClusterBossMatrixRow,
  type BossColumn
} from '@/app/lib/data/cluster-boss-matrix'
import { MatrixMobileCards } from '@/app/components/tables/MatrixMobileCards'
import { createComponentLogger } from '@/app/lib/logging/client'

const logger = createComponentLogger(
  'leaderboards.components.ClusterBossMatrix'
)

interface ClusterBossMatrixProps {
  season: string
}

// Column-relative shading; alpha scales with distance from the midpoint so text stays readable.
const MAX_ALPHA = 0.34

function shadeStyle(
  value: number | null,
  min: number,
  max: number,
  higherIsBetter: boolean
): React.CSSProperties {
  if (value === null || max === min) return {}
  const norm = (value - min) / (max - min) // 0..1
  const goodness = higherIsBetter ? norm : 1 - norm // 1 = best
  if (goodness >= 0.5) {
    const a = ((goodness - 0.5) / 0.5) * MAX_ALPHA
    return { backgroundColor: `rgba(34, 197, 94, ${a.toFixed(3)})` }
  }
  const a = ((0.5 - goodness) / 0.5) * MAX_ALPHA
  return { backgroundColor: `rgba(239, 68, 68, ${a.toFixed(3)})` }
}

function columnRange(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 0 }
  return { min: Math.min(...values), max: Math.max(...values) }
}

export default function ClusterBossMatrix({ season }: ClusterBossMatrixProps) {
  const { context, loading: contextLoading } = useDataContext()
  const [rows, setRows] = useState<ClusterBossMatrixRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guildLabels, setGuildLabels] = useState<Record<string, string>>({})
  const [loopIndex, setLoopIndex] = useState<number | null>(null)
  const [includeFinishers, setIncludeFinishers] = useState(false)
  const [includeSideBosses, setIncludeSideBosses] = useState(true)

  const supabase = dbClient()
  const clusterCode = context.clusterCode

  // State is set in the nested async fn, not the effect body, for the cascading-render rule.
  useEffect(() => {
    if (contextLoading) return
    let cancelled = false
    const load = async () => {
      if (!clusterCode) {
        setRows([])
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const data = await getClusterBossMatrixRPC(supabase, {
          clusterCode,
          season
        })
        if (cancelled) return
        setRows(data)
        setLoopIndex(null) // reset to default (max loop) for the new dataset
      } catch (err) {
        if (cancelled) return
        logger.error(
          { err, clusterCode, season },
          'get_cluster_boss_matrix failed'
        )
        setError('Could not load cluster boss data.')
        setRows([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [supabase, clusterCode, season, contextLoading])

  const matrices = useMemo(
    () =>
      buildClusterBossMatrices(rows, {
        loopIndex,
        includeFinishers,
        includeSideBosses
      }),
    [rows, loopIndex, includeFinishers, includeSideBosses]
  )

  // Resolve guild_code → label so the Guild column never shows a UUID.
  useEffect(() => {
    const missing = matrices.guilds.filter((g) => !(g in guildLabels))
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      const { data, error: labelError } = await supabase
        .from('guild_config')
        .select(GUILD_DISPLAY_COMPACT)
        .in('guild_code', missing)
      if (cancelled || labelError || !data) return
      setGuildLabels((prev) => {
        const next: Record<string, string> = { ...prev }
        for (const g of data) {
          if (g.guild_code) {
            next[g.guild_code] = formatGuildDisplayLabel(g, g.guild_code)
          }
        }
        for (const g of missing) {
          if (!(g in next)) next[g] = formatGuildDisplayLabel(null, g)
        }
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [matrices.guilds, guildLabels, supabase])

  const renderGuild = (guild: string) =>
    guildLabels[guild] ?? formatGuildDisplayLabel(null, guild)

  // Ordered by label; the lookup is inlined so memo deps stay [matrices.guilds, guildLabels].
  const orderedGuilds = useMemo(
    () =>
      [...matrices.guilds].sort((a, b) => {
        const la = guildLabels[a] ?? formatGuildDisplayLabel(null, a)
        const lb = guildLabels[b] ?? formatGuildDisplayLabel(null, b)
        return la.localeCompare(lb)
      }),
    [matrices.guilds, guildLabels]
  )

  const damageRanges = useMemo(() => {
    const ranges: Record<string, { min: number; max: number }> = {}
    for (const col of matrices.columns) {
      const vals: number[] = []
      for (const g of matrices.guilds) {
        const v = matrices.damage[g]?.[col.key]?.value
        if (v !== null && v !== undefined) vals.push(v)
      }
      ranges[col.key] = columnRange(vals)
    }
    return ranges
  }, [matrices])

  const tokenRanges = useMemo(() => {
    const ranges: Record<string, { min: number; max: number }> = {}
    for (const col of matrices.columns) {
      const vals: number[] = []
      for (const g of matrices.guilds) {
        const cell = matrices.tokens[g]?.[col.key]
        // Live (incomplete) cells are excluded from the kill-token comparison.
        if (cell && cell.value !== null && !cell.live) vals.push(cell.value)
      }
      ranges[col.key] = columnRange(vals)
    }
    return ranges
  }, [matrices])

  if (!contextLoading && !clusterCode) {
    return null // No cluster → nothing to compare. (Tab is leader+cluster gated.)
  }

  return (
    <div className="space-y-6">
      {/* Loop selector */}
      {!loading && matrices.loops.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="text-sm text-secondary-wh40k">Loop</label>
          <select
            value={matrices.selectedLoop ?? ''}
            onChange={(e) => setLoopIndex(Number(e.target.value))}
            className="px-3 py-1 bg-(--card-bg) text-primary-wh40k border border-(--card-border) rounded-sm"
          >
            {matrices.loops.map((loop) => (
              <option key={loop} value={loop}>
                Loop {loop + 1}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading || contextLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-600/30 bg-red-900/20 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : matrices.columns.length === 0 ? (
        <div className="rounded-lg border border-(--card-border) bg-(--card-bg) p-6 text-sm text-secondary-wh40k">
          No guild-raid data for this season yet.
        </div>
      ) : (
        <>
          {/* Damage per Boss */}
          <MatrixCard
            title="Damage per Boss"
            subtitle="Effective damage per token · Higher = greener (better)"
            subtitleShort="Damage per token · higher = better"
            note="Cell shading: relative to column best (highest dmg/token)"
            columns={matrices.columns}
            guilds={orderedGuilds}
            renderGuild={renderGuild}
            toggle={{
              label: 'Include finishers',
              checked: includeFinishers,
              onChange: setIncludeFinishers
            }}
            renderCell={(guild, col) => {
              const value = matrices.damage[guild]?.[col.key]?.value ?? null
              const range = damageRanges[col.key] ?? { min: 0, max: 0 }
              return {
                style: shadeStyle(value, range.min, range.max, true),
                content:
                  value === null ? (
                    <span className="text-secondary-wh40k">—</span>
                  ) : (
                    formatNumber(Math.round(value))
                  )
              }
            }}
          />

          {/* Tokens per Boss */}
          <MatrixCard
            title="Tokens per Boss"
            subtitle="Tokens to kill each boss · Fewer = greener (more efficient)"
            subtitleShort="Tokens to kill · fewer = better"
            note={
              includeSideBosses
                ? 'Cell shading: relative to column best (lowest tokens) · Includes side bosses'
                : 'Cell shading: relative to column best (lowest tokens) · Main boss only'
            }
            columns={matrices.columns}
            guilds={orderedGuilds}
            renderGuild={renderGuild}
            toggle={{
              label: 'Include side bosses',
              checked: includeSideBosses,
              onChange: setIncludeSideBosses
            }}
            renderCell={(guild, col) => {
              const cell = matrices.tokens[guild]?.[col.key]
              const value = cell?.value ?? null
              if (value === null) {
                return {
                  style: {},
                  content: <span className="text-secondary-wh40k">—</span>
                }
              }
              if (cell?.live) {
                // Incomplete kill: running count, no shading.
                return {
                  style: {},
                  content: (
                    <span>
                      {value}
                      <span className="ml-1 text-xs text-secondary-wh40k">
                        live
                      </span>
                    </span>
                  )
                }
              }
              const range = tokenRanges[col.key] ?? { min: 0, max: 0 }
              return {
                style: shadeStyle(value, range.min, range.max, false),
                content: value
              }
            }}
          />
        </>
      )}
    </div>
  )
}

interface MatrixCardProps {
  title: string
  subtitle: string
  /** Replaces `subtitle` below lg. */
  subtitleShort?: string
  note: string
  columns: BossColumn[]
  guilds: string[]
  renderGuild: (guild: string) => string
  toggle: {
    label: string
    checked: boolean
    onChange: (next: boolean) => void
  }
  renderCell: (
    guild: string,
    col: BossColumn
  ) => { style: React.CSSProperties; content: React.ReactNode }
}

function MatrixCard({
  title,
  subtitle,
  subtitleShort,
  note,
  columns,
  guilds,
  renderGuild,
  toggle,
  renderCell
}: MatrixCardProps) {
  return (
    <div className="bg-(--card-bg) border border-(--card-border) rounded-lg overflow-hidden">
      <div className="p-3 lg:p-4 border-b border-(--card-border) flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg lg:text-xl font-bold text-primary-wh40k">
            {title}
          </h3>
          <p className="text-xs lg:text-sm text-secondary-wh40k mt-1">
            {subtitleShort ? (
              <>
                <span className="lg:hidden">{subtitleShort}</span>
                <span className="hidden lg:inline">{subtitle}</span>
              </>
            ) : (
              subtitle
            )}
          </p>
          <p className="hidden lg:block text-xs italic text-secondary-wh40k mt-1">
            {note}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-secondary-wh40k">
          <input
            type="checkbox"
            checked={toggle.checked}
            onChange={(e) => toggle.onChange(e.target.checked)}
            className="rounded-sm"
          />
          {toggle.label}
        </label>
      </div>
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-(--bg-tertiary)">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-secondary-wh40k sticky left-0 bg-(--bg-tertiary)">
                Guild
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-right font-medium text-secondary-wh40k whitespace-nowrap"
                >
                  <span className="text-(--accent-wh40k) mr-1">
                    {col.levelLabel}
                  </span>
                  {col.bossLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {guilds.map((guild) => (
              <tr key={guild} className="border-t border-(--card-border)">
                <td className="px-3 py-2 font-bold text-(--primary) sticky left-0 bg-(--card-bg)">
                  {renderGuild(guild)}
                </td>
                {columns.map((col) => {
                  const { style, content } = renderCell(guild, col)
                  return (
                    <td
                      key={col.key}
                      className="px-3 py-2 text-right text-primary-wh40k tabular-nums"
                      style={style}
                    >
                      {content}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Below lg each guild becomes a card with wrapped boss tiles. */}
      <div className="lg:hidden p-3">
        <MatrixMobileCards
          rows={guilds}
          columns={columns}
          rowKey={(guild) => guild}
          colKey={(col) => col.key}
          renderRowHeader={(guild) => (
            <span className="font-bold text-(--primary)">
              {renderGuild(guild)}
            </span>
          )}
          renderColLabel={(col) => (
            <>
              <span className="text-(--accent-wh40k)">{col.levelLabel}</span>{' '}
              {col.bossLabel}
            </>
          )}
          renderCell={(guild, col) => {
            const { style, content } = renderCell(guild, col)
            return {
              style,
              content: <span className="tabular-nums">{content}</span>
            }
          }}
        />
      </div>
    </div>
  )
}
