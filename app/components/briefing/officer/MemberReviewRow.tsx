'use client'

/** One "People to review" row with its bucket's metric; clicking selects the member. */

import { AlertTriangle, Coins, Award, ChevronRight } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import {
  SwapChips,
  ConfidenceBadge
} from '@/app/components/briefing/officer/SwapChips'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import type {
  MemberSignalRow,
  MemberClassification
} from '@/app/lib/officer-briefing/types'

interface MemberReviewRowProps {
  row: MemberSignalRow
  selected: boolean
  onSelect: (displayName: string) => void
}

function formatPct(value: number | null | undefined): string {
  if (value == null) return '—'
  const rounded = Math.round(value)
  // True minus glyph so negatives read as a signal, not a hyphen.
  return rounded >= 0 ? `+${rounded}%` : `−${Math.abs(rounded)}%`
}

function fmtK(n: number | null | undefined): string {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1000)}K`
  return `${Math.round(n)}`
}

interface BadgeDef {
  label: string
  color: string
}

/** Needs-review badge; null for recognition rows, generic "NEEDS SUPPORT" when unenriched. */
function badgeFor(row: MemberSignalRow): BadgeDef | null {
  if (row.bucket === 'recognition') return null
  if (row.bucket === 'token_risk') return null

  const classification: MemberClassification | null | undefined =
    row.classification
  switch (classification) {
    case 'needs_support_wrong_team':
      return { label: 'Team upgrade', color: 'var(--accent)' }
    case 'needs_support_correct_team':
      return { label: 'Execution review', color: 'var(--info)' }
    case 'doing_great':
      return { label: 'Watch', color: 'var(--success)' }
    default:
      return { label: 'Needs support', color: 'var(--warning)' }
  }
}

interface BucketMetric {
  text: string
  color: string
  icon: React.ReactNode
  hint: string | null
}

function metricFor(row: MemberSignalRow): BucketMetric {
  switch (row.bucket) {
    case 'recognition':
      return {
        text: formatPct(
          row.targetScore != null ? (row.targetScore - 1) * 100 : null
        ),
        color: 'var(--success)',
        icon: <Award className="h-3.5 w-3.5" aria-hidden />,
        hint: row.worstBossName
          ? `vs target on ${getBossDisplayName(row.worstBossName)}`
          : 'above target'
      }
    case 'token_risk':
      return {
        text:
          row.estimatedCapWaste != null
            ? `~${formatNumber(row.estimatedCapWaste, 0)} tokens lost`
            : 'cap risk',
        color: 'var(--info)',
        icon: <Coins className="h-3.5 w-3.5" aria-hidden />,
        hint: 'projected if cap-bound'
      }
    case 'team_upgrade': {
      // The independent swap-engine list uses the roster-adjusted metric.
      const hasRosterAdj = row.rosterAdjustedPct != null
      return {
        text: formatPct(
          hasRosterAdj ? row.rosterAdjustedPct : row.worstVsGuildPct
        ),
        color:
          row.classification === 'needs_support_wrong_team'
            ? 'var(--accent)'
            : row.classification === 'needs_support_correct_team'
              ? 'var(--info)'
              : 'var(--warning)',
        icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
        hint: row.worstBossName
          ? `worst on ${getBossDisplayName(row.worstBossName)}`
          : 'below guild average'
      }
    }
    case 'needs_review':
    default:
      // The route only adds needs_review rows below NEEDS_REVIEW_TARGET, so targetScore is set.
      return {
        text: formatPct(
          row.targetScore != null ? (row.targetScore - 1) * 100 : null
        ),
        color: 'var(--warning)',
        icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
        hint: row.worstBossName
          ? `worst on ${getBossDisplayName(row.worstBossName)}`
          : 'below target'
      }
  }
}

export function MemberReviewRow({
  row,
  selected,
  onSelect
}: MemberReviewRowProps) {
  const metric = metricFor(row)
  const badge = badgeFor(row)
  const isCoachingRow =
    row.bucket === 'needs_review' || row.bucket === 'team_upgrade'
  const upside =
    isCoachingRow && row.readyNowUpside != null && row.readyNowUpside > 0
      ? row.readyNowUpside
      : null
  // Count the worst-signal boss's own attacks (the % basis), not the member total.
  const attackCount =
    isCoachingRow && row.worstBattleCount != null
      ? row.worstBattleCount
      : row.battleCount

  return (
    <button
      type="button"
      onClick={() => onSelect(row.displayName)}
      aria-pressed={selected}
      className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition hover:brightness-110"
      style={{
        borderColor: selected ? 'var(--accent)' : 'var(--card-border)',
        backgroundColor: selected ? 'rgba(var(--card-bg-rgb), 0.5)' : undefined
      }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-primary-wh40k">
            {row.displayName}
          </p>
          {badge && (
            <span
              className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{ color: badge.color, borderColor: badge.color }}
            >
              {badge.label}
            </span>
          )}
        </div>
        <p className="truncate text-[11px] text-(--text-tertiary)">
          {metric.hint ?? '—'}
          {upside != null && (
            <>
              {' · '}
              <span style={{ color: 'var(--accent)' }}>
                +{fmtK(upside)}/attack
              </span>
            </>
          )}
          {' · '}
          {formatNumber(attackCount, 0)} attack{attackCount === 1 ? '' : 's'}
        </p>
        {isCoachingRow && row.swaps && row.swaps.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <SwapChips swaps={row.swaps} />
            {row.confidence && <ConfidenceBadge confidence={row.confidence} />}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="inline-flex items-center gap-1 text-sm font-bold tabular-nums"
          style={{ color: metric.color }}
        >
          {metric.icon}
          {metric.text}
        </span>
        <ChevronRight className="h-4 w-4 text-(--text-tertiary)" aria-hidden />
      </div>
    </button>
  )
}
