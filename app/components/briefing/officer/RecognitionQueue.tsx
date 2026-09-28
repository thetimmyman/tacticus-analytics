'use client'

import { Award } from 'lucide-react'
import type { MemberSignalRow } from '@/app/lib/officer-briefing/types'

interface RecognitionQueueProps {
  recognition: MemberSignalRow[]
  selectedMember: string | null
  onSelectMember: (displayName: string) => void
}

function formatPct(value: number | null): string {
  if (value == null) return '—'
  const rounded = Math.round(value)
  return rounded >= 0 ? `+${rounded}%` : `−${Math.abs(rounded)}%`
}

export function RecognitionQueue({
  recognition,
  selectedMember,
  onSelectMember
}: RecognitionQueueProps) {
  if (recognition.length === 0) return null

  return (
    <section
      className="rounded-xl border border-(--card-border) bg-card/30 overflow-hidden"
      aria-label="Recognition queue"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[color-mix(in_srgb,var(--card-border)_50%,transparent)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Award
            className="h-4 w-4"
            style={{ color: 'var(--success)' }}
            aria-hidden
          />
          <div>
            <h2 className="text-sm font-semibold text-primary-wh40k">
              Recognition queue
            </h2>
            <p className="text-[10px] uppercase tracking-wider text-(--text-tertiary)">
              Performance vs target score
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--success)_45%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-secondary-wh40k">
          {recognition.length} candidate{recognition.length === 1 ? '' : 's'}
        </span>
      </header>

      <ul className="divide-y divide-[color-mix(in_srgb,var(--card-border)_40%,transparent)] p-2">
        {recognition.map((row) => {
          const isSelected = row.displayName === selectedMember
          return (
            <li key={row.displayName}>
              <button
                type="button"
                onClick={() => onSelectMember(row.displayName)}
                aria-pressed={isSelected}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition hover:brightness-110"
                style={{
                  backgroundColor: isSelected
                    ? 'rgba(var(--card-bg-rgb), 0.5)'
                    : undefined
                }}
              >
                <span className="truncate text-sm font-medium text-primary-wh40k">
                  {row.displayName}
                </span>
                <span className="shrink-0 flex flex-col items-end">
                  <span
                    className="text-sm font-bold tabular-nums"
                    style={{ color: 'var(--success)' }}
                  >
                    {formatPct(
                      row.targetScore != null
                        ? (row.targetScore - 1) * 100
                        : null
                    )}
                  </span>
                  <span className="text-[9px] uppercase tracking-wide text-(--text-tertiary)">
                    vs target
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
