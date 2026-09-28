/** Swap and confidence chips shared by the Team Upgrades row and the detail panel. */

import { ArrowRight } from 'lucide-react'
import type {
  Confidence,
  MemberClassification,
  SwapStep
} from '@/app/lib/officer-briefing/types'

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence'
}

export const CLASSIFICATION_META: Record<
  MemberClassification,
  { label: string; color: string; muted: boolean }
> = {
  needs_support_wrong_team: {
    label: 'Better team available',
    color: 'var(--warning)',
    muted: false
  },
  needs_support_correct_team: {
    label: 'Execution gap',
    color: 'var(--info)',
    muted: false
  },
  doing_great: { label: 'Doing great', color: 'var(--success)', muted: false },
  roster_limited: {
    label: 'Roster-limited',
    color: 'var(--text-tertiary)',
    muted: true
  },
  insufficient_data: {
    label: 'Insufficient data',
    color: 'var(--text-tertiary)',
    muted: true
  }
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span className="text-[10px] uppercase tracking-wide text-(--text-tertiary)">
      {CONFIDENCE_LABEL[confidence]}
    </span>
  )
}

export function SwapChips({ swaps }: { swaps: SwapStep[] }) {
  if (swaps.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {swaps.map((s) => (
        <span
          key={`${s.out}->${s.in}`}
          className="inline-flex items-center gap-1 rounded-full border border-(--card-border) px-2 py-0.5 text-[10px] text-secondary-wh40k"
        >
          <span className="text-(--text-tertiary)">{s.out}</span>
          <ArrowRight className="h-3 w-3 text-(--accent)" aria-hidden />
          <span style={{ color: 'var(--success)' }}>{s.in}</span>
        </span>
      ))}
    </div>
  )
}
