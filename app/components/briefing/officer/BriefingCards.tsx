'use client'

/** The three summary cards; clicking one sets the list filter. */

import { AlertTriangle, TrendingUp, Award } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { BriefingFilter } from '@/app/components/briefing/officer/FilterChips'
import type { MemberSignalRow } from '@/app/lib/officer-briefing/types'

interface BriefingCardsProps {
  counts: {
    needsReview: number
    tokenRisk: number
    recognition: number
    teamUpgrades: number
  }
  /** Σ ready-now upside (the "+1.48M" headline). */
  teamUpgradeUpsideTotal: number
  /** Largest roster-gain % across members (not the top-upside row's). */
  largestGainPct: number | null
  needsReviewTop: MemberSignalRow | null
  recognitionTop: MemberSignalRow | null
  activeFilter: BriefingFilter
  onSelect: (filter: BriefingFilter) => void
}

interface CardDef {
  key: BriefingFilter
  label: string
  headline: string | null
  blurb: string
  kpi: string | null
  value: string
  /** A muted empty-state label, not a number. */
  isEmptyValue?: boolean
  sub: string | null
  color: string
  icon: React.ReactNode
}

function fmtK(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `+${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `+${Math.round(n / 1000)}k`
  return `+${Math.round(n)}`
}

function pctPhrase(pct: number): string {
  const rounded = Math.abs(Math.round(pct))
  return `${rounded}% ${pct < 0 ? 'below' : 'above'}`
}

export function BriefingCards({
  counts,
  teamUpgradeUpsideTotal,
  largestGainPct,
  needsReviewTop,
  recognitionTop,
  activeFilter,
  onSelect
}: BriefingCardsProps) {
  // Coach now: highest impact by target score (1.0 = on target).
  const coachPct =
    needsReviewTop?.targetScore != null
      ? (needsReviewTop.targetScore - 1) * 100
      : null
  const coachHeadline =
    needsReviewTop && coachPct != null
      ? `${needsReviewTop.displayName} is ${pctPhrase(coachPct)} target`
      : null
  // readyNowUpside exists only on wrong-team rows, identifying "team selection".
  const coachBlurb =
    needsReviewTop?.readyNowUpside && needsReviewTop.readyNowUpside > 0
      ? 'Most of the recoverable gap appears to be team selection, not roster strength.'
      : 'Below their target score for recent attacks.'
  const coachKpi =
    needsReviewTop?.readyNowUpside && needsReviewTop.readyNowUpside > 0
      ? `Ready-now team change: ${fmtK(needsReviewTop.readyNowUpside)} per attack`
      : null

  // Team opportunity: total available and largest gain (rosterAdjustedPct, not target score).
  const teamKpi =
    largestGainPct != null
      ? `Largest single gain: +${Math.abs(Math.round(largestGainPct))}%`
      : null

  const recogPct =
    recognitionTop?.targetScore != null
      ? (recognitionTop.targetScore - 1) * 100
      : null
  const recogHeadline =
    recognitionTop && recogPct != null
      ? `${recognitionTop.displayName} is ${pctPhrase(recogPct)} target`
      : null
  const recogKpi =
    recognitionTop?.strongStreak && recognitionTop.strongStreak > 1
      ? `Current streak: ${recognitionTop.strongStreak} strong attacks`
      : null

  const cards: CardDef[] = [
    {
      key: 'needs_support',
      label: 'Coach now',
      headline: coachHeadline,
      blurb: coachBlurb,
      kpi: coachKpi,
      value: formatNumber(counts.needsReview, 0),
      sub:
        counts.needsReview === 1
          ? '1 high-impact case'
          : `${formatNumber(counts.needsReview, 0)} cases`,
      color: 'var(--warning)',
      icon: <AlertTriangle className="h-5 w-5" aria-hidden />
    },
    {
      key: 'team_upgrades',
      label: 'Team opportunity',
      headline:
        teamUpgradeUpsideTotal > 0
          ? `${fmtK(teamUpgradeUpsideTotal).replace('+', '')} projected damage is being left available`
          : null,
      blurb:
        'These alternatives use characters already owned and battle-ready.',
      kpi: teamKpi,
      value:
        teamUpgradeUpsideTotal > 0
          ? fmtK(teamUpgradeUpsideTotal)
          : 'None ready',
      isEmptyValue: teamUpgradeUpsideTotal <= 0,
      sub:
        counts.teamUpgrades > 0
          ? `${counts.teamUpgrades} member${counts.teamUpgrades === 1 ? '' : 's'}`
          : null,
      color: 'var(--accent)',
      icon: <TrendingUp className="h-5 w-5" aria-hidden />
    },
    {
      key: 'doing_great',
      label: 'Worth recognizing',
      headline: recogHeadline,
      blurb: 'top performance this review window',
      kpi: recogKpi,
      value: formatNumber(counts.recognition, 0),
      sub:
        counts.recognition > 0
          ? `${counts.recognition} member${counts.recognition === 1 ? '' : 's'}`
          : null,
      color: 'var(--success)',
      icon: <Award className="h-5 w-5" aria-hidden />
    }
  ]

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
      {cards.map((card) => {
        const isActive = card.key === activeFilter
        return (
          <button
            key={card.label}
            type="button"
            onClick={() => onSelect(card.key)}
            aria-pressed={isActive}
            className="rounded-xl border bg-card/30 p-4 text-left transition hover:brightness-110"
            style={{
              borderColor: isActive ? card.color : 'var(--card-border)'
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-1.5">
              <p
                className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider"
                style={{ color: card.color }}
              >
                {card.icon}
                {card.label}
              </p>
              {card.sub && (
                <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">
                  {card.sub}
                </span>
              )}
            </div>
            {card.headline ? (
              <p className="mt-2 text-sm font-bold text-[var(--text-primary)]">
                {card.headline}
              </p>
            ) : (
              <p
                className={`mt-2 ${
                  card.isEmptyValue
                    ? 'text-sm font-semibold'
                    : 'text-2xl font-bold tabular-nums'
                }`}
                style={{
                  color: card.isEmptyValue ? 'var(--text-tertiary)' : card.color
                }}
              >
                {card.value}
              </p>
            )}
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
              {card.blurb}
            </p>
            {card.kpi && (
              <p
                className="mt-1.5 text-[11px] font-semibold"
                style={{ color: card.color }}
              >
                {card.kpi}
              </p>
            )}
          </button>
        )
      })}
    </div>
  )
}
