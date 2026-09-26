'use client'

/**
 * Token-alert nudge card on the member's stats page; dismissal is shared and permanent.
 * Inline color-mix tints because Tailwind drops /N on var().
 */

import { memo } from 'react'
import Link from 'next/link'
import { BellRing, ChevronRight } from 'lucide-react'
import { useTokenAlertNudge } from '@/app/components/token-usage/hooks/useTokenAlertNudge'
import {
  TOKEN_ALERT_NUDGE_TITLE,
  tokenAlertNudgeCta,
  tokenAlertNudgeHref
} from '@/app/components/token-usage/token-alert-nudge-content'

const accentMix = (percent: number) =>
  `color-mix(in srgb, var(--accent) ${percent}%, transparent)`

function TokenAlertNudgeCard() {
  const { eligible, linked, dismissed, dismiss } = useTokenAlertNudge()

  if (!eligible || dismissed) return null

  return (
    <section
      aria-labelledby="token-alert-nudge-title"
      className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5"
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--accent)]"
          style={{ backgroundColor: accentMix(14) }}
        >
          <BellRing className="h-5 w-5" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-2xs font-bold uppercase tracking-wider text-[var(--accent)]">
            New feature
          </p>
          <h2
            id="token-alert-nudge-title"
            className="mt-0.5 text-base font-semibold text-[var(--text-primary)]"
          >
            {TOKEN_ALERT_NUDGE_TITLE}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Get a Discord DM when your raid tokens are full, a set number of
            minutes before they cap, or every time you gain one.
          </p>
          {!linked && (
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              Token alerts need a linked Discord account.
            </p>
          )}

          {/* Column on narrow phones so the CTA never crowds the dismiss control. */}
          <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Link
              href={tokenAlertNudgeHref(linked)}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-semibold text-[var(--accent)] transition-colors duration-fast"
              style={{
                borderColor: accentMix(35),
                backgroundColor: accentMix(10)
              }}
            >
              {tokenAlertNudgeCta(linked)}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>

            <button
              type="button"
              onClick={dismiss}
              className="text-xs text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

export default memo(TokenAlertNudgeCard)
export { TokenAlertNudgeCard }
