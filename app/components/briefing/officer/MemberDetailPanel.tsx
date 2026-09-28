'use client'

/**
 * On-demand member detail; fetches only while open. Upside is labelled an estimate and
 * roster_limited/insufficient verdicts render muted without a task.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Check, AlertCircle, ExternalLink } from 'lucide-react'
import { dbClient } from '@/app/lib/db/client'
import {
  HeadlineVerdict,
  CompactVerdictRow,
  type HeroIconMap
} from './MemberDetailPanelVerdicts'
import type {
  MemberDetailResponse,
  MemberBossVerdict,
  MemberClassification
} from '@/app/lib/officer-briefing/types'

interface MemberDetailPanelProps {
  displayName: string | null
  guildCode: string
  season: string
  /** Context the list API already batched, so the detail API skips a per-member fetch. */
  rowContext?: {
    tokensAvailable: number | null
    tokenCapacity: number | null
    lastBattleSecondsAgo: number | null
    targetScore?: number | null
  } | null
}

function formatAgo(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const ROSTER_STALE_MS = 24 * 60 * 60 * 1000

/** Only verdicts with a real recommendation (not roster_limited or insufficient_data). */
const ASSIGNABLE_CLASSIFICATIONS = new Set<MemberClassification>([
  'needs_support_wrong_team',
  'needs_support_correct_team'
])

function formatPct(value: number | null | undefined): string {
  if (value == null) return '—'
  const rounded = Math.round(value)
  return rounded >= 0 ? `+${rounded}%` : `−${Math.abs(rounded)}%`
}

function isRosterStale(rosterSyncedAt: string | null, nowMs: number): boolean {
  return (
    rosterSyncedAt == null ||
    nowMs - new Date(rosterSyncedAt).getTime() > ROSTER_STALE_MS
  )
}

/**
 * Tagged with its member so render can ignore a stale result without resetting
 * state in the effect; `Date.now()` is captured here to keep render pure.
 */
type DetailResult =
  | {
      member: string
      status: 'success'
      data: MemberDetailResponse
      rosterStale: boolean
    }
  | { member: string; status: 'error'; message: string }

export function MemberDetailPanel({
  displayName,
  guildCode,
  season,
  rowContext = null
}: MemberDetailPanelProps) {
  const queryClient = useQueryClient()
  const [result, setResult] = useState<DetailResult | null>(null)
  // Tagged by member so "Copied" clears when another member opens.
  const [copiedMember, setCopiedMember] = useState<string | null>(null)
  // Resets on member switch: the parent remounts via `key={selectedMember}`.
  const [assignState, setAssignState] = useState<
    'idle' | 'loading' | 'created' | 'already' | 'error'
  >('idle')
  const [assignError, setAssignError] = useState<string | null>(null)
  // "Mark reviewed" = assign (server re-derives) + acknowledge.
  const [reviewState, setReviewState] = useState<
    'idle' | 'loading' | 'done' | 'error'
  >('idle')
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const noteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const noteDialogRef = useRef<HTMLDivElement | null>(null)
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const noteReturnFocusRef = useRef<HTMLElement | null>(null)
  const { data: heroIconRows = [] } = useQuery({
    queryKey: ['officer-hero-icon-map'],
    queryFn: async (): Promise<Array<{ name: string; icon: string }>> => {
      const supabase = dbClient()
      const { data } = await supabase
        .from('hero_mappings')
        .select('display_name, web_icon_url')
        .not('web_icon_url', 'is', null)
      return (data ?? [])
        .filter(
          (m): m is { display_name: string; web_icon_url: string } =>
            Boolean(m.display_name) && Boolean(m.web_icon_url)
        )
        .map((m) => ({ name: m.display_name, icon: m.web_icon_url }))
    },
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000
  })

  const iconMap = useMemo<HeroIconMap>(() => {
    const map = new Map<string, string>()
    for (const { name, icon } of heroIconRows) {
      map.set(name, icon)
      map.set(name.toLowerCase(), icon)
    }
    return map
  }, [heroIconRows])

  useEffect(() => {
    if (!displayName) return
    let cancelled = false
    const member = displayName

    const params = new URLSearchParams({ display_name: member })
    if (season) params.set('season', season)

    fetch(`/api/officer/member-detail?${params.toString()}`, {
      cache: 'no-store'
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(
            res.status === 403
              ? 'Officer access required'
              : `Failed to load member detail (${res.status})`
          )
        }
        return (await res.json()) as MemberDetailResponse
      })
      .then((payload) => {
        if (!cancelled) {
          setResult({
            member,
            status: 'success',
            data: payload,
            rosterStale: isRosterStale(payload.rosterSyncedAt, Date.now())
          })
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult({
            member,
            status: 'error',
            message:
              err instanceof Error
                ? err.message
                : 'Failed to load member detail'
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [displayName, season])

  // aria-modal behaviour: Escape, focus cycle and restore, scroll lock.
  useEffect(() => {
    if (!noteOpen) return
    noteReturnFocusRef.current = document.activeElement as HTMLElement | null
    window.requestAnimationFrame(() => {
      noteTextareaRef.current?.focus()
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNoteOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const focusable = noteDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      noteReturnFocusRef.current?.focus()
      noteReturnFocusRef.current = null
    }
  }, [noteOpen])

  // Only honour a result for the selected member; anything else reads as loading.
  const current = result && result.member === displayName ? result : null
  const copied = copiedMember != null && copiedMember === displayName

  const invalidateCoachingTasks = () =>
    queryClient.invalidateQueries({
      queryKey: ['officer-coaching-tasks', guildCode, season]
    })

  async function handleCopy(member: string, note: string) {
    if (!note) return
    try {
      await navigator.clipboard.writeText(note)
      setCopiedMember(member)
      window.setTimeout(() => setCopiedMember(null), 2000)
    } catch {
      // Clipboard can be blocked; fail quietly.
    }
  }

  /** The server re-derives the verdict and trusts only the identity key. */
  async function handleAssignTask(
    member: string,
    season: string,
    verdict: MemberBossVerdict
  ) {
    setAssignState('loading')
    setAssignError(null)
    try {
      const res = await fetch('/api/officer/coaching-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: member,
          bossType: verdict.bossType,
          encounterIndex: verdict.encounterId,
          raritySet: verdict.rarity,
          season
        })
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? `Failed to assign task (${res.status})`)
      }
      const body = (await res.json()) as { alreadyOpen: boolean }
      setAssignState(body.alreadyOpen ? 'already' : 'created')
      await invalidateCoachingTasks()
    } catch (err) {
      setAssignState('error')
      setAssignError(
        err instanceof Error ? err.message : 'Failed to assign task'
      )
    }
  }

  async function handleMarkReviewed(
    member: string,
    season: string,
    verdict: MemberBossVerdict
  ) {
    setReviewState('loading')
    let taskChanged = false
    try {
      const postRes = await fetch('/api/officer/coaching-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: member,
          bossType: verdict.bossType,
          encounterIndex: verdict.encounterId,
          raritySet: verdict.rarity,
          season
        })
      })
      if (!postRes.ok) throw new Error(`assign failed (${postRes.status})`)
      const task = (await postRes.json()) as { id: string; status: string }
      taskChanged = true
      if (task.status === 'open') {
        const patchRes = await fetch(`/api/officer/coaching-tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'acknowledged' })
        })
        if (!patchRes.ok)
          throw new Error(`acknowledge failed (${patchRes.status})`)
      }
      setReviewState('done')
    } catch {
      setReviewState('error')
    } finally {
      if (taskChanged) await invalidateCoachingTasks()
    }
  }

  if (!displayName) {
    return (
      <section className="rounded-xl border border-(--card-border) bg-card/30 p-6 text-center">
        <p className="text-xs text-(--text-tertiary)">
          Select a member to see the roster-aware breakdown.
        </p>
      </section>
    )
  }

  if (!current) {
    return (
      <section className="rounded-xl border border-(--card-border) bg-card/30 p-4 space-y-3">
        <div className="h-4 w-1/3 animate-pulse rounded-sm bg-[color-mix(in_srgb,var(--card-border)_60%,transparent)]" />
        <div className="h-6 w-1/2 animate-pulse rounded-sm bg-[color-mix(in_srgb,var(--card-border)_60%,transparent)]" />
        <div className="h-20 w-full animate-pulse rounded-sm bg-[color-mix(in_srgb,var(--card-border)_40%,transparent)]" />
        <div className="h-12 w-full animate-pulse rounded-sm bg-[color-mix(in_srgb,var(--card-border)_40%,transparent)]" />
      </section>
    )
  }

  if (current.status === 'error') {
    return (
      <section className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_50%,transparent)] bg-card/30 p-4">
        <div
          className="flex items-center gap-2 text-sm"
          style={{ color: 'var(--danger)' }}
        >
          <AlertCircle className="h-4 w-4" aria-hidden />
          {current.message}
        </div>
      </section>
    )
  }

  const { data, rosterStale } = current
  const rosterUrl = `/player-stats?player=${encodeURIComponent(
    data.displayName
  )}&guild=${encodeURIComponent(data.guildCode)}&season=${encodeURIComponent(
    data.season
  )}`

  const others = data.headline
    ? data.verdicts.filter(
        (v) =>
          !(
            v.bossName === data.headline?.bossName &&
            v.encounterId === data.headline?.encounterId
          )
      )
    : data.verdicts

  return (
    <section
      className="rounded-xl border border-(--card-border) bg-card/30 overflow-hidden"
      aria-label={`Member detail for ${data.displayName}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[color-mix(in_srgb,var(--card-border)_50%,transparent)] px-4 py-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-primary-wh40k">
              {data.displayName}
            </h2>
            {rowContext?.targetScore != null && (
              <span
                className="text-sm font-bold tabular-nums"
                style={{
                  color:
                    rowContext.targetScore >= 1
                      ? 'var(--success)'
                      : 'var(--danger)'
                }}
              >
                {formatPct((rowContext.targetScore - 1) * 100)} vs target
              </span>
            )}
          </div>
          {(() => {
            // Last battle from the detail API; token bank from the batched list row.
            const lastAgo =
              data.lastBattleSecondsAgo ??
              rowContext?.lastBattleSecondsAgo ??
              null
            const tokens =
              rowContext?.tokensAvailable != null
                ? `${rowContext.tokensAvailable}/${rowContext.tokenCapacity ?? 3} tokens`
                : null
            const parts = [
              lastAgo != null ? `last battle ${formatAgo(lastAgo)}` : null,
              tokens
            ].filter(Boolean)
            return parts.length > 0 ? (
              <p className="text-[10px] text-(--text-tertiary)">
                {parts.join(' · ')}
              </p>
            ) : null
          })()}
        </div>
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          <a
            href={rosterUrl}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-(--card-border) px-2.5 py-1 text-left text-[11px] font-semibold leading-tight text-secondary-wh40k transition hover:brightness-110"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Open roster
          </a>
          {data.headline &&
            ASSIGNABLE_CLASSIFICATIONS.has(data.headline.classification) && (
              <button
                type="button"
                onClick={() =>
                  handleAssignTask(
                    data.displayName,
                    data.season,
                    data.headline!
                  )
                }
                disabled={
                  assignState === 'loading' ||
                  assignState === 'created' ||
                  assignState === 'already'
                }
                className="inline-flex min-w-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-left text-[11px] font-semibold leading-tight transition hover:brightness-110 disabled:opacity-60"
                style={{
                  borderColor: 'var(--accent)',
                  color:
                    assignState === 'created' || assignState === 'already'
                      ? 'var(--success)'
                      : 'var(--accent)'
                }}
              >
                {assignState === 'loading'
                  ? 'Assigning…'
                  : assignState === 'created'
                    ? 'Task assigned'
                    : assignState === 'already'
                      ? 'Already open'
                      : assignState === 'error'
                        ? 'Retry assign'
                        : 'Assign coaching task'}
              </button>
            )}
          {data.headline &&
            ASSIGNABLE_CLASSIFICATIONS.has(data.headline.classification) && (
              <button
                type="button"
                onClick={() =>
                  handleMarkReviewed(
                    data.displayName,
                    data.season,
                    data.headline!
                  )
                }
                disabled={reviewState === 'loading' || reviewState === 'done'}
                className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-(--card-border) px-2.5 py-1 text-left text-[11px] font-semibold leading-tight transition hover:brightness-110 disabled:opacity-60"
                style={{
                  color:
                    reviewState === 'done'
                      ? 'var(--success)'
                      : 'var(--text-secondary)'
                }}
              >
                {reviewState === 'loading'
                  ? 'Marking…'
                  : reviewState === 'done'
                    ? 'Reviewed'
                    : reviewState === 'error'
                      ? 'Retry mark reviewed'
                      : 'Mark reviewed'}
              </button>
            )}
          <button
            type="button"
            ref={noteTriggerRef}
            onClick={() => {
              noteReturnFocusRef.current = noteTriggerRef.current
              setNoteDraft(data.coachingNote)
              setNoteOpen(true)
            }}
            disabled={!data.coachingNote}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-(--card-border) px-2.5 py-1 text-left text-[11px] font-semibold leading-tight text-secondary-wh40k transition hover:brightness-110 disabled:opacity-40"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
            Copy coaching note
          </button>
        </div>
      </header>

      {/* Review/edit the suggested message before copying. */}
      {noteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onClick={() => setNoteOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Coaching note for ${data.displayName}`}
            ref={noteDialogRef}
            className="w-full max-w-lg rounded-xl border border-(--card-border) bg-(--bg-primary) p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-primary-wh40k">
                Coaching note for {data.displayName}
              </h3>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setNoteOpen(false)}
                className="text-(--text-tertiary) hover:text-primary-wh40k"
              >
                ×
              </button>
            </div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-(--text-tertiary)">
              Suggested message
            </p>
            <textarea
              ref={noteTextareaRef}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-(--card-border) bg-card/30 p-2 text-xs text-primary-wh40k"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNoteOpen(false)}
                className="rounded-md border border-(--card-border) px-3 py-1.5 text-[11px] font-semibold text-secondary-wh40k"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => handleCopy(data.displayName, noteDraft)}
                disabled={!noteDraft}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-bold disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent)', color: '#111' }}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    Copy to clipboard
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4 p-4">
        {assignState === 'error' && assignError && (
          <p className="text-[11px]" style={{ color: 'var(--danger)' }}>
            {assignError}
          </p>
        )}

        {rosterStale && (
          <p className="text-[11px] text-(--text-tertiary)">
            Roster data may be stale
            {data.rosterSyncedAt
              ? ` (last synced ${new Date(data.rosterSyncedAt).toLocaleDateString()})`
              : ' (never synced)'}
            — best-fieldable analysis may be out of date.
          </p>
        )}

        {data.headline ? (
          <HeadlineVerdict
            verdict={data.headline}
            iconMap={iconMap}
            recentAttacks={data.recentAttacks ?? []}
          />
        ) : (
          <p className="text-xs text-(--text-tertiary)">
            No verdict available for this member yet.
          </p>
        )}

        {others.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-widest text-(--text-tertiary)">
              Other bosses
            </p>
            <ul className="divide-y divide-[color-mix(in_srgb,var(--card-border)_40%,transparent)]">
              {others.map((v) => (
                <CompactVerdictRow
                  key={`${v.bossName}-${v.encounterId}`}
                  verdict={v}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[color-mix(in_srgb,var(--card-border)_40%,transparent)] px-4 py-2 text-[10px] text-(--text-tertiary)">
        <span>
          Model compares boss, difficulty, upgrades, and roster-feasible teams.
        </span>
        <span>Updated after last battle</span>
      </div>
    </section>
  )
}
