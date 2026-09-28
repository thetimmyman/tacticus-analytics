'use client'

/** Live primes to clear before the warded main (resolvePrimeTargets); renders nothing if none. */

import { Crosshair, Gauge } from 'lucide-react'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import type { PrimeTarget } from '@/app/lib/briefing/types'

interface PrimeTargetsCardProps {
  targets: PrimeTarget[]
}

function PrimeBadge({ target }: { target: PrimeTarget }) {
  const isThreshold = target.behaviour === 'threshold'
  const Icon = isThreshold ? Gauge : Crosshair
  const label =
    isThreshold && typeof target.thresholdHpPct === 'number'
      ? `Threshold ↓${target.thresholdHpPct}%`
      : 'Kill'
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-(--card-border) px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary-wh40k">
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  )
}

function PrimeTargetsCard({ targets }: PrimeTargetsCardProps) {
  if (!targets || targets.length === 0) return null

  return (
    <section
      className="rounded-xl border border-(--card-border) bg-card/30 overflow-hidden"
      data-testid="prime-targets-card"
      aria-label="Prime targets"
    >
      <header className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--card-border)_50%,transparent)] px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-primary-wh40k">
            Prime targets
          </h2>
          <span className="text-[10px] uppercase tracking-wider text-(--text-tertiary)">
            Clear before the main
          </span>
        </div>
      </header>

      <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        {targets.map((target) => (
          <li
            key={target.encounterId}
            className="flex items-center gap-3 rounded-lg border border-[color-mix(in_srgb,var(--card-border)_40%,transparent)] bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] p-3"
          >
            <BossPortrait
              bossName={target.name}
              variant="portrait"
              size="medium"
              className="shrink-0 rounded-xl border border-[color-mix(in_srgb,var(--accent)_50%,transparent)]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-primary-wh40k">
                  {target.displayName}
                </p>
                <PrimeBadge target={target} />
              </div>
              <p className="text-[10px] uppercase tracking-wider text-(--text-tertiary)">
                {target.levelCode} · Prime {target.encounterId}
              </p>
              <div className="mt-2">
                <div className="flex justify-between text-[10px] text-(--text-tertiary)">
                  <span>HP remaining</span>
                  <span className="font-semibold text-secondary-wh40k">
                    {Math.round(target.hpPercentage)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--card-border)_60%,transparent)]">
                  <div
                    className="h-full rounded-full bg-accent-wh40k"
                    style={{
                      width: `${Math.max(0, Math.min(100, target.hpPercentage))}%`
                    }}
                  />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default PrimeTargetsCard
