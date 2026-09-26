'use client'

import { AlertCircle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react'
import type { RosterStrengthScore } from '@/app/lib/services/strength-precedence'

export type PrimarySource = 'playbook' | 'global_thresholds'

export type ScoreStatus = 'optimal' | 'strong' | 'suitable' | 'weak'

export type MemberStatus = ScoreStatus | 'no-roster' | 'no-requirements'

export type ScoreSource =
  | 'playbook_guild'
  | 'playbook_cluster'
  | 'playbook_global'
  | 'global_thresholds'

export interface TargetScore {
  target_id: string
  target_name: string
  score: number
  status: ScoreStatus
  coach_highlight: boolean
  source: ScoreSource
  details: RosterStrengthScore | null
}

export interface MemberGapData {
  player_id: string
  display_name: string
  has_roster: boolean
  has_api_key: boolean
  roster_count: number
  overall_score: number | null
  performance_vs_guild_avg: number | null
  status: MemberStatus
  target_scores: TargetScore[]
}

export interface MemberGapsResponse {
  guild_code: string
  season: string
  members: MemberGapData[]
  targets_analyzed: Array<{ target_id: string; target_name: string }>
  targets_label: string
  coach_mode: boolean
  active_source: PrimarySource | null
}

export interface ScoringConfig {
  primary_source: PrimarySource
  strength_target_rarity_set: string | null
  tier_optimal_pct: number
  tier_strong_pct: number
  tier_suitable_pct: number
}

export interface ScoringConfigResponse {
  guild_code: string
  config: ScoringConfig
  available_rarity_sets: string[]
  default_rarity_set: string | null
  can_edit: boolean
}

export type SortField =
  'name' | 'score' | 'status' | 'roster_count' | 'performance'
export type SortDirection = 'asc' | 'desc'
// Own key literal for the unsortable Targets column keeps DataTable keys unique.
export type MemberGapColumnKey = SortField | 'targets'
export type StatusFilter = 'all' | MemberStatus

export const DEFAULT_TIERS = {
  optimal: 100,
  strong: 80,
  suitable: 60
}

export const FALLBACK_ORDER: PrimarySource[] = ['playbook', 'global_thresholds']

export const SOURCE_LABELS: Record<
  PrimarySource,
  { title: string; short: string; description: string; badgeClass: string }
> = {
  playbook: {
    title: 'Boss Playbooks',
    short: 'Playbook',
    description: 'Minimum viable team requirements from boss playbooks.',
    badgeClass: 'bg-blue-500/10 text-blue-300 border-blue-500/30'
  },
  global_thresholds: {
    title: 'Global Strength Thresholds',
    short: 'Global Thresholds',
    description: 'Default global thresholds for roster strength.',
    badgeClass:
      'bg-gray-500/10 text-[var(--text-primary)] border-card-border/30'
  }
}

export const SOURCE_BADGES: Record<
  ScoreSource,
  { label: string; title: string; className: string }
> = {
  playbook_guild: {
    label: 'PG',
    title: 'Playbook: Guild',
    className: 'bg-blue-500/10 text-blue-300 border-blue-500/30'
  },
  playbook_cluster: {
    label: 'PC',
    title: 'Playbook: Cluster',
    className: 'bg-sky-500/10 text-sky-300 border-sky-500/30'
  },
  playbook_global: {
    label: 'P*',
    title: 'Playbook: Global',
    className:
      'bg-slate-500/10 text-[var(--text-primary)] border-card-border/30'
  },
  global_thresholds: {
    label: 'GT',
    title: 'Global Thresholds',
    className: 'bg-gray-500/10 text-[var(--text-primary)] border-card-border/30'
  }
}

export const STATUS_CONFIG: Record<
  MemberStatus,
  {
    label: string
    badgeClass: string
    className: string
    icon: typeof CheckCircle2
  }
> = {
  optimal: {
    label: 'Optimal',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    className: 'text-emerald-400 bg-emerald-400/10',
    icon: CheckCircle2
  },
  strong: {
    label: 'Strong',
    badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    className: 'text-blue-400 bg-blue-400/10',
    icon: CheckCircle2
  },
  suitable: {
    label: 'Suitable',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    className: 'text-amber-400 bg-amber-400/10',
    icon: AlertCircle
  },
  weak: {
    label: 'Weak',
    badgeClass: 'bg-red-500/20 text-red-300 border-red-500/30',
    className: 'text-red-400 bg-red-400/10',
    icon: XCircle
  },
  'no-roster': {
    label: 'No Roster',
    badgeClass:
      'bg-gray-500/20 text-[var(--text-secondary)] border-card-border/30',
    className: 'text-[var(--text-secondary)] bg-gray-400/10',
    icon: HelpCircle
  },
  'no-requirements': {
    label: 'No Requirements',
    badgeClass:
      'bg-gray-600/20 text-[var(--text-secondary)] border-card-border/30',
    className: 'text-[var(--text-secondary)] bg-gray-500/10',
    icon: HelpCircle
  }
}

// Status sort rank, weakest first; shared with the column's sortValue.
export const STATUS_SORT_ORDER: Record<MemberStatus, number> = {
  weak: 0,
  suitable: 1,
  strong: 2,
  optimal: 3,
  'no-roster': 4,
  'no-requirements': 5
}

export const formatPerformancePercent = (value: number) => {
  const rounded = Math.round(value)
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded}%`
}

export const getPerformanceColor = (value: number) => {
  if (value >= 10) return 'text-emerald-400'
  if (value >= 0) return 'text-emerald-300'
  if (value >= -10) return 'text-amber-400'
  return 'text-red-400'
}

export const parsePercent = (value: string, fallback: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

export function StatusBadge({ status }: { status: MemberStatus }) {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-full border ${config.badgeClass}`}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  )
}

export function ScoreDisplay({
  score,
  status
}: {
  score: number | null
  status: MemberStatus
}) {
  if (score === null) {
    return <span className="text-[var(--text-secondary)]">-</span>
  }

  const colorClass =
    status === 'optimal'
      ? 'text-emerald-400'
      : status === 'strong'
        ? 'text-blue-400'
        : status === 'suitable'
          ? 'text-amber-400'
          : status === 'weak'
            ? 'text-red-400'
            : 'text-[var(--text-secondary)]'

  return <span className={`font-semibold ${colorClass}`}>{score}%</span>
}

export function SourceBadge({ source }: { source: ScoreSource }) {
  const config = SOURCE_BADGES[source]
  return (
    <span
      title={config.title}
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${config.className}`}
    >
      {config.label}
    </span>
  )
}
