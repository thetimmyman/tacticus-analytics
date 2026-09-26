'use client'

// Used below `lg`, where the table would only scroll sideways.

import { useState } from 'react'
import { ChevronDown, Settings2 } from 'lucide-react'
import clsx from 'clsx'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import {
  deriveSeedState,
  encounterLabel,
  levelLabel,
  type MergedRow
} from '../TargetsClient'

export interface TargetsAccordionProps {
  rows: MergedRow[]
  keyFor: (row: MergedRow) => string
  canEdit: boolean
  canManageHerald: boolean
  onEdit: (row: MergedRow) => void
  onOpenOps: (row: MergedRow) => void
  /** Clear a manual target so the row falls back to the historical average. */
  onReset: (row: MergedRow) => void
  /** Skipped via the ops rule; the planner uses its union with boss_target_tokens.skip. */
  opsSkippedKeys?: Set<string>
  editingKey: string | null
  renderEditor: (row: MergedRow) => React.ReactNode
}

interface BossGroup {
  key: string
  displayName: string
  bossType: string
  rarity: 'Legendary' | 'Mythic'
  set: number
  rows: MergedRow[]
}

/** Group by stage: main + its two primes share boss_type, rarity and set. */
function groupByBoss(rows: MergedRow[]): BossGroup[] {
  const groups = new Map<string, BossGroup>()
  for (const row of rows) {
    const key = `${row.boss_type}__${row.rarity}__${row.set}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        displayName: row.display_name,
        bossType: row.boss_type,
        rarity: row.rarity,
        set: row.set,
        rows: []
      }
      groups.set(key, group)
    }
    group.rows.push(row)
    if (row.encounter_id === 0) group.displayName = row.display_name
  }
  for (const group of groups.values()) {
    group.rows.sort((a, b) => a.encounter_id - b.encounter_id)
  }
  return Array.from(groups.values())
}

export function TargetsAccordion({
  rows,
  keyFor,
  canEdit,
  canManageHerald,
  onEdit,
  onOpenOps,
  onReset,
  opsSkippedKeys,
  editingKey,
  renderEditor
}: TargetsAccordionProps) {
  const groups = groupByBoss(rows)
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (groups.length === 0) return null

  return (
    <div className="space-y-2 p-2">
      {groups.map((group) => {
        const isOpen = open.has(group.key)
        // Only real, non-skipped targets count; an unset row is not an authored 0.
        const counted = group.rows.filter((r) => {
          const seed = deriveSeedState(r.target)
          return r.target && !seed.isSkipped && !seed.isNoneAvailable
        })
        const total = counted.reduce(
          (sum, r) => sum + (r.target?.target_tokens ?? 0),
          0
        )

        return (
          <article
            key={group.key}
            className="overflow-hidden rounded-lg border border-[var(--card-border)] bg-card/40"
          >
            <button
              type="button"
              onClick={() => toggle(group.key)}
              aria-expanded={isOpen}
              className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left"
            >
              {/* Only group headers (the main boss) get a portrait; the name lookup maps some primes
                  to the wrong boss. */}
              <BossPortrait
                bossName={group.displayName}
                size="small"
                variant="icon"
                lazy
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-[var(--text-primary)]">
                  {group.displayName}
                </span>
                <span className="mt-0.5 block text-2xs text-[var(--text-secondary)]">
                  {levelLabel(group.rarity, group.set)} · {counted.length}/
                  {group.rows.length} set
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-sm font-semibold text-[var(--primary)]">
                  {total > 0 ? total : '—'}
                </span>
                <span className="block text-2xs text-[var(--text-tertiary)]">
                  tokens
                </span>
              </span>
              <ChevronDown
                className={clsx(
                  'h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform',
                  isOpen && 'rotate-180'
                )}
              />
            </button>

            {isOpen && (
              <div className="border-t border-[var(--card-border)]">
                {group.rows.map((row) => {
                  const rowKey = keyFor(row)
                  const seed = deriveSeedState(row.target)
                  const showSkipped =
                    seed.isSkipped || opsSkippedKeys?.has(rowKey) === true
                  const isEditing = editingKey === rowKey
                  return (
                    <div
                      key={rowKey}
                      className={clsx(
                        'flex min-h-[52px] items-center gap-2 border-b border-[var(--card-border)] px-3 py-2 last:border-b-0',
                        (showSkipped || seed.isNoneAvailable) && 'opacity-50'
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[var(--text-primary)]">
                          {row.display_name}
                        </span>
                        <span
                          className={clsx(
                            'block text-2xs',
                            row.encounter_id === 0
                              ? 'text-[var(--text-secondary)]'
                              : 'text-purple-300'
                          )}
                        >
                          {encounterLabel(row.encounter_id)}
                          {seed.isNoneAvailable && ' · None available'}
                          {showSkipped && ' · Skipped'}
                          {seed.isTierFallback &&
                            ` · Fallback: ${seed.tierFallbackLabel}`}
                        </span>
                      </span>

                      {isEditing ? (
                        renderEditor(row)
                      ) : (
                        <button
                          type="button"
                          onClick={() => onEdit(row)}
                          disabled={!canEdit || seed.isSkipped}
                          className="min-h-[44px] min-w-[56px] rounded-md border border-[var(--card-border)] bg-black/20 px-2 text-right font-mono text-sm font-semibold text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Edit target tokens for ${row.display_name}`}
                        >
                          {seed.isNoneAvailable || showSkipped
                            ? '—'
                            : (row.target?.target_tokens ?? '—')}
                        </button>
                      )}

                      {canEdit &&
                        row.target?.source === 'officer_manual' &&
                        !isEditing && (
                          <button
                            type="button"
                            onClick={() => onReset(row)}
                            className="inline-flex h-11 shrink-0 items-center rounded-md border border-red-500/30 px-2 text-2xs text-red-300"
                            aria-label={`Reset target for ${row.display_name}`}
                            data-testid="targets-mutation-control"
                            title="Remove the manual target — falls back to the historical average"
                          >
                            Reset
                          </button>
                        )}
                      {canManageHerald && (
                        <button
                          type="button"
                          onClick={() => onOpenOps(row)}
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]"
                          aria-label={`Open ops settings for ${row.display_name}`}
                          data-testid="targets-mutation-control"
                        >
                          <Settings2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
