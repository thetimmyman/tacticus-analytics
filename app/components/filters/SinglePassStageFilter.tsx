'use client'

import { CSSProperties } from 'react'

export interface SinglePassStageFilterProps {
  /** Stages played once and never replayed, in display order; empty renders nothing. */
  singlePassStages: readonly string[]
  included: boolean
  onChange: (included: boolean) => void
  compact?: boolean
  className?: string
  label?: string
}

/** `['L1','L2','L3']` -> `'L1–L3'`; other lists are listed out. */
export function summariseStages(stages: readonly string[]): string {
  // Destructured so `noUncheckedIndexedAccess` narrows without a non-null assertion.
  const [first] = stages
  if (first === undefined) return ''
  const listed = stages.join(', ')
  if (stages.length <= 2) return listed

  const prefix = first.charAt(0)
  if (stages.some((stage) => stage.charAt(0) !== prefix)) return listed

  const tiers = stages.map((stage) => Number.parseInt(stage.slice(1), 10))
  if (tiers.some((tier) => !Number.isFinite(tier))) return listed

  const sorted = [...tiers].sort((a, b) => a - b)
  const low = sorted[0]
  const high = sorted[sorted.length - 1]
  if (low === undefined || high === undefined) return listed

  // Strict step of 1: count-vs-span would call [1, 1, 3] contiguous.
  let previous = low
  for (const tier of sorted.slice(1)) {
    if (tier !== previous + 1) return listed
    previous = tier
  }

  return `${prefix}${low}–${prefix}${high}`
}

/** Show/hide stages the guild left behind, without making data unreachable. Off by default. */
export function SinglePassStageFilter({
  singlePassStages = [],
  included = false,
  onChange,
  compact = true,
  className = '',
  label = 'Stages'
}: SinglePassStageFilterProps) {
  // Defaulted, not asserted: unwired callers render nothing instead of crashing.
  if (!singlePassStages || singlePassStages.length === 0) return null

  const pillSizeClasses = compact
    ? 'px-2.5 py-1 text-xs'
    : 'px-3 py-1.5 text-sm'
  const summary = summariseStages(singlePassStages)

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(!included)}
        className={`rarity-pill ${pillSizeClasses} ${included ? 'is-active' : ''}`.trim()}
        aria-pressed={included}
        aria-label={`Show single-pass stages ${summary}`}
        title={
          included
            ? `Hide ${summary} — played once on the first pass, never replayed`
            : `Show ${summary} — played once on the first pass, never replayed`
        }
        style={
          {
            '--rarity-pill-color': 'var(--text-tertiary)'
          } as CSSProperties
        }
      >
        <span className="font-semibold">{summary}</span>
        <span className="hidden sm:inline ml-1">single pass</span>
      </button>
    </div>
  )
}
