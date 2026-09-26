/** Guild-wide signals from the read API's `patterns`; hidden when none fired. */

import { Users, Timer, TrendingUp, ArrowUpRight } from 'lucide-react'
import type {
  GuildPattern,
  GuildPatternKind
} from '@/app/lib/officer-briefing/types'

const KIND_META: Record<
  GuildPatternKind,
  { label: string; color: string; icon: React.ReactNode }
> = {
  team_selection: {
    label: 'Team selection',
    color: 'var(--warning)',
    icon: <Users className="h-4 w-4" aria-hidden />
  },
  token_timing: {
    label: 'Token timing',
    color: 'var(--info)',
    icon: <Timer className="h-4 w-4" aria-hidden />
  },
  positive_trend: {
    label: 'Positive trend',
    color: 'var(--success)',
    icon: <TrendingUp className="h-4 w-4" aria-hidden />
  }
}

export function GuildPatterns({ patterns }: { patterns: GuildPattern[] }) {
  if (patterns.length === 0) return null

  return (
    <section
      className="rounded-xl border border-[var(--card-border)] bg-card/30 overflow-hidden"
      aria-label="Guild patterns"
    >
      <header className="flex flex-wrap items-baseline gap-2 border-b border-[color-mix(in_srgb,var(--card-border)_50%,transparent)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Guild patterns
        </h2>
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
          Signals worth acting on once, not member by member
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        {patterns.map((p) => {
          const meta = KIND_META[p.kind]
          return (
            <div
              key={p.kind}
              className="rounded-lg border border-[color-mix(in_srgb,var(--card-border)_60%,transparent)] bg-[var(--bg-primary)] p-3"
            >
              <p
                className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: meta.color }}
              >
                {meta.icon}
                {meta.label}
              </p>
              <p className="mt-1.5 text-sm font-bold text-[var(--text-primary)]">
                {p.title}
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                {p.detail}
              </p>
              {p.href && p.ctaLabel && (
                <a
                  href={p.href}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  {p.ctaLabel}
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                </a>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
