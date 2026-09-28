'use client'

/**
 * Open and acknowledged coaching tasks. Acknowledged tasks get a suggestion only;
 * resolving or dismissing is always an explicit officer action.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Clock, ListChecks } from 'lucide-react'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { formatEncounterLabel } from '@/app/lib/format/encounter-label'
import {
  CLASSIFICATION_META,
  SwapChips
} from '@/app/components/briefing/officer/SwapChips'
import type { CoachingTask } from '@/app/lib/officer-briefing/types'
import type { FollowUpResult } from '@/app/lib/officer-briefing/follow-up'

interface FollowUpsListProps {
  guildCode: string
  season: string
}

interface TaskWithFollowUp {
  task: CoachingTask
  followUp: FollowUpResult | null
}

async function fetchCoachingTasks(season: string): Promise<TaskWithFollowUp[]> {
  const params = new URLSearchParams({ season })
  const res = await fetch(`/api/officer/coaching-tasks?${params.toString()}`, {
    cache: 'no-store'
  })
  if (!res.ok) {
    throw new Error(`Failed to load coaching tasks (${res.status})`)
  }
  const body = (await res.json()) as { tasks: TaskWithFollowUp[] }
  return body.tasks
}

const OUTCOME_LABEL: Record<FollowUpResult['outcome'], string> = {
  swapped_improved: 'Swapped — improved',
  swapped_no_change: 'Swapped — no material change',
  execution_improved: 'Execution improved',
  execution_no_change: 'Execution — no material change',
  not_swapped: 'Not swapped yet',
  insufficient_new_evidence: 'Waiting on more attacks'
}

function outcomeLabel(task: CoachingTask, followUp: FollowUpResult): string {
  if (
    followUp.outcome === 'not_swapped' &&
    task.recommendedSwaps.length === 0
  ) {
    return 'Different team used'
  }
  return OUTCOME_LABEL[followUp.outcome]
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function OutcomeIcon({
  outcome
}: {
  outcome: FollowUpResult['outcome'] | undefined
}) {
  if (outcome === 'swapped_improved' || outcome === 'execution_improved') {
    return (
      <CheckCircle2
        className="h-3.5 w-3.5"
        style={{ color: 'var(--success)' }}
        aria-hidden
      />
    )
  }
  if (outcome === 'not_swapped') {
    return (
      <XCircle
        className="h-3.5 w-3.5"
        style={{ color: 'var(--warning)' }}
        aria-hidden
      />
    )
  }
  return <Clock className="h-3.5 w-3.5 text-(--text-tertiary)" aria-hidden />
}

function TaskRow({
  item,
  busy,
  onAction
}: {
  item: TaskWithFollowUp
  busy: boolean
  onAction: (
    id: string,
    status: 'acknowledged' | 'dismissed' | 'resolved',
    resolution?: string
  ) => void
}) {
  const { task, followUp } = item
  const meta = CLASSIFICATION_META[task.classification]
  const bossLabel = `${getBossDisplayName(task.bossType)}${formatEncounterLabel(task.encounterIndex, 'dot')}`
  const canResolve =
    Boolean(followUp) && followUp?.outcome !== 'insufficient_new_evidence'

  return (
    <li className="space-y-2 rounded-md border border-(--card-border) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-primary-wh40k">
            {task.displayName}
          </p>
          <p className="text-[11px] text-(--text-tertiary)">
            {bossLabel} · assigned {relativeAge(task.createdAt)}
          </p>
        </div>
        <span
          className="rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
          style={{ color: meta.color, borderColor: meta.color }}
        >
          {meta.label}
        </span>
      </div>

      <SwapChips swaps={task.recommendedSwaps} />

      {task.status === 'open' && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(task.id, 'acknowledged')}
            className="rounded-md border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-110 disabled:opacity-40"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            Mark acknowledged
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(task.id, 'dismissed')}
            className="rounded-md border border-(--card-border) px-2.5 py-1 text-[11px] text-secondary-wh40k transition hover:brightness-110 disabled:opacity-40"
          >
            Dismiss
          </button>
        </div>
      )}

      {task.status === 'acknowledged' && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[11px] text-secondary-wh40k">
            <OutcomeIcon outcome={followUp?.outcome} />
            {followUp
              ? outcomeLabel(task, followUp)
              : 'Waiting on more attacks'}
            {followUp?.deltaPct != null && (
              <span className="tabular-nums">
                {' · '}
                {followUp.deltaPct >= 0 ? '+' : ''}
                {Math.round(followUp.deltaPct * 100)}% avg
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !canResolve}
              onClick={() =>
                onAction(
                  task.id,
                  'resolved',
                  followUp && followUp.outcome !== 'insufficient_new_evidence'
                    ? followUp.outcome
                    : 'not_swapped'
                )
              }
              className="rounded-md border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-110 disabled:opacity-40"
              style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
            >
              Mark resolved
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(task.id, 'dismissed')}
              className="rounded-md border border-(--card-border) px-2.5 py-1 text-[11px] text-secondary-wh40k transition hover:brightness-110 disabled:opacity-40"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

export function FollowUpsList({ guildCode, season }: FollowUpsListProps) {
  const queryClient = useQueryClient()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['officer-coaching-tasks', guildCode, season],
    queryFn: () => fetchCoachingTasks(season),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000
  })

  async function handleAction(
    id: string,
    status: 'acknowledged' | 'dismissed' | 'resolved',
    resolution?: string
  ) {
    setPendingId(id)
    try {
      const res = await fetch(`/api/officer/coaching-tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolution })
      })
      if (res.ok) {
        await queryClient.invalidateQueries({
          queryKey: ['officer-coaching-tasks', guildCode, season]
        })
      }
    } finally {
      setPendingId(null)
    }
  }

  if (isLoading) {
    return (
      <section className="rounded-xl border border-(--card-border) bg-card/30 p-4">
        <div className="h-4 w-1/3 animate-pulse rounded-sm bg-[color-mix(in_srgb,var(--card-border)_60%,transparent)]" />
      </section>
    )
  }

  // Best-effort: the main briefing handles hard errors, so fail silently.
  if (error || !data) return null

  return (
    <section
      className="rounded-xl border border-(--card-border) bg-card/30 overflow-hidden"
      aria-label="Coaching follow-ups"
    >
      <header className="flex items-center gap-2 border-b border-[color-mix(in_srgb,var(--card-border)_50%,transparent)] px-4 py-3">
        <ListChecks className="h-4 w-4 text-(--accent)" aria-hidden />
        <h2 className="text-sm font-semibold text-primary-wh40k">
          Coaching follow-ups
        </h2>
        <span className="text-[11px] text-(--text-tertiary)">
          {data.length}
        </span>
      </header>
      <div className="p-4">
        {data.length === 0 ? (
          <p className="py-4 text-center text-xs text-(--text-tertiary)">
            No open coaching tasks — assign one from a member&apos;s detail
            panel.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.map((item) => (
              <TaskRow
                key={item.task.id}
                item={item}
                busy={pendingId === item.task.id}
                onAction={handleAction}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
