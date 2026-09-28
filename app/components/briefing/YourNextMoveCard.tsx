'use client'

/**
 * "Your next move" card (derive-next-move.ts). Non-attack states look different
 * and confidence is shown, so a guess never reads as a command.
 */

import Link from 'next/link'
import {
  ArrowRight,
  Crosshair,
  Gauge,
  Pause,
  CheckCircle2,
  HelpCircle,
  Settings
} from 'lucide-react'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import type {
  NextMove,
  NextMoveReasonCode,
  NextMoveState,
  Confidence,
  PrimeTarget
} from '@/app/lib/briefing/types'

interface YourNextMoveCardProps {
  move: NextMove
}

const STATE_STYLE: Record<
  NextMoveState,
  { label: string; color: string; icon: React.ReactNode }
> = {
  attack: {
    label: 'Action available',
    color: 'var(--success)',
    icon: <Crosshair className="h-3.5 w-3.5" aria-hidden />
  },
  hold: {
    label: 'Hold',
    color: 'var(--warning)',
    icon: <Pause className="h-3.5 w-3.5" aria-hidden />
  },
  done: {
    label: 'Nothing to do now',
    color: 'var(--info)',
    icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
  },
  unknown: {
    label: 'Needs your check',
    color: 'var(--text-secondary)',
    icon: <HelpCircle className="h-3.5 w-3.5" aria-hidden />
  },
  setup_required: {
    label: 'Setup required',
    color: 'var(--accent)',
    icon: <Settings className="h-3.5 w-3.5" aria-hidden />
  }
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence'
}

type CheckTone = 'ok' | 'warn' | 'info'

const REASON_CHECK: Partial<
  Record<NextMoveReasonCode, { tone: CheckTone; label: string }>
> = {
  main_alive: { tone: 'ok', label: 'Main boss is up' },
  main_warded: { tone: 'warn', label: 'Main is warded' },
  clear_primes: { tone: 'warn', label: 'Clear primes first' },
  warding_unknown: { tone: 'info', label: 'Warding not confirmed' },
  main_defeated: { tone: 'info', label: 'Main defeated this loop' },
  token_available: { tone: 'ok', label: 'Raid token available' },
  no_token: { tone: 'warn', label: 'No raid token' },
  token_unknown: { tone: 'info', label: 'Token count unavailable' },
  token_at_cap: { tone: 'warn', label: 'At token cap — spend now' },
  bomb_range: { tone: 'warn', label: 'In bomb range — bombs finish it' },
  bomb_available: { tone: 'ok', label: 'Your bomb is ready' },
  no_bomb: { tone: 'warn', label: 'Your bomb is on cooldown' },
  bomb_unknown: { tone: 'info', label: 'Bomb status unavailable' },
  best_target_now: { tone: 'ok', label: 'Strongest target you can reach' },
  stronger_target_soon: { tone: 'info', label: 'Stronger target coming up' },
  value_unknown: { tone: 'info', label: 'Not enough history to rank' },
  pace_unknown: { tone: 'info', label: "Can't project upcoming targets" }
}

const TONE_COLOR: Record<CheckTone, string> = {
  ok: 'var(--success)',
  warn: 'var(--warning)',
  info: 'var(--text-secondary)'
}

function PrimeBadge({ target }: { target: PrimeTarget }) {
  const isThreshold = target.behaviour === 'threshold'
  const Icon = isThreshold ? Gauge : Crosshair
  const label =
    isThreshold && typeof target.thresholdHpPct === 'number'
      ? `↓${target.thresholdHpPct}%`
      : 'Kill'
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-(--card-border) px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-(--text-tertiary)">
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  )
}

function YourNextMoveCard({ move }: YourNextMoveCardProps) {
  const style = STATE_STYLE[move.state]
  const checks = move.reasonCodes
    .map((code) => {
      const c = REASON_CHECK[code]
      return c ? { code, ...c } : null
    })
    .filter(
      (c): c is { code: NextMoveReasonCode; tone: CheckTone; label: string } =>
        Boolean(c)
    )

  return (
    <section
      className="rounded-xl border border-(--card-border) bg-card/30 overflow-hidden"
      data-testid="your-next-move-card"
      aria-label="Your next move"
    >
      <header className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--card-border)_50%,transparent)] px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-primary-wh40k">
            Your next move
          </h2>
          <span className="text-[10px] uppercase tracking-wider text-(--text-tertiary)">
            Personal priority
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide"
          style={{ color: style.color, borderColor: style.color }}
        >
          {style.icon}
          {style.label}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[140px_1fr]">
        {/* Boss column */}
        <div className="flex flex-col items-center text-center sm:border-r sm:border-[color-mix(in_srgb,var(--card-border)_40%,transparent)] sm:pr-4">
          {move.target ? (
            <>
              <BossPortrait
                bossName={move.target.name}
                variant="portrait"
                size="large"
                className="rounded-2xl border-2 border-[color-mix(in_srgb,var(--accent)_70%,transparent)]"
              />
              <p className="mt-3 text-sm font-semibold text-primary-wh40k">
                {move.target.displayName}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-(--text-tertiary)">
                {move.target.levelCode}
                {move.target.encounterId === 0
                  ? ' · Main'
                  : ` · Prime ${move.target.encounterId}`}
              </p>
              <div className="mt-3 w-full">
                <div className="flex justify-between text-[10px] text-(--text-tertiary)">
                  <span>HP remaining</span>
                  <span className="font-semibold text-secondary-wh40k">
                    {Math.round(move.target.hpPercentage)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--card-border)_60%,transparent)]">
                  <div
                    className="h-full rounded-full bg-accent-wh40k"
                    style={{
                      width: `${Math.max(0, Math.min(100, move.target.hpPercentage))}%`
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-(--text-tertiary)">
              No active boss
            </div>
          )}
        </div>

        {/* Recommendation column */}
        <div className="min-w-0">
          <p
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: style.color }}
          >
            Recommended now
          </p>
          <h3 className="mt-1 text-xl font-bold leading-tight text-primary-wh40k sm:text-2xl">
            {move.headline}
          </h3>
          <p className="mt-2 max-w-prose text-sm text-secondary-wh40k">
            {move.detail}
          </p>

          {move.primeTargets && move.primeTargets.length > 0 && (
            <ul className="mt-3 space-y-1.5" aria-label="Live primes to clear">
              {move.primeTargets.map((p) => (
                <li
                  key={p.encounterId}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-secondary-wh40k"
                >
                  <span className="font-semibold text-primary-wh40k">
                    {p.displayName}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-(--text-tertiary)">
                    Prime {p.encounterId}
                  </span>
                  <span className="text-(--text-tertiary)" aria-hidden>
                    ·
                  </span>
                  <span>HP {Math.round(p.hpPercentage)}%</span>
                  <PrimeBadge target={p} />
                </li>
              ))}
            </ul>
          )}

          {move.economy?.waitFor && (
            <div className="mt-3 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_5%,transparent)] px-3 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-(--warning)">
                Wait for
              </span>
              <span className="text-sm font-semibold text-primary-wh40k">
                {move.economy.waitFor.displayName}
              </span>
              <span className="text-xs text-secondary-wh40k">
                {move.economy.waitFor.levelCode} · +
                {Math.round(move.economy.waitFor.upliftPct)}% ·{' '}
                {move.economy.waitFor.etaLabel}
              </span>
            </div>
          )}

          {checks.length > 0 && (
            <ul className="mt-3 space-y-1.5" aria-label="Decision check">
              {checks.map((check) => (
                <li
                  key={check.code}
                  className="flex items-center gap-2 text-xs text-secondary-wh40k"
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: TONE_COLOR[check.tone] }}
                    aria-hidden
                  />
                  {check.label}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {move.primaryAction && (
              <Link
                href={move.primaryAction.href}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent-wh40k px-3.5 py-2 text-sm font-semibold text-(--bg-primary) transition hover:brightness-110"
              >
                {move.primaryAction.label}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
            <span className="text-[10px] uppercase tracking-wide text-(--text-tertiary)">
              {CONFIDENCE_LABEL[move.confidence]}
            </span>
          </div>

          {move.basis.length > 0 && (
            <p className="mt-3 text-[11px] text-(--text-tertiary)">
              {move.basis.join(' · ')}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

export default YourNextMoveCard
