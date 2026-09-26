'use client'

/**
 * "Since your last visit" deltas. The cutoff advances only after hydration, so a
 * failed render or second tab never marks updates seen.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Sparkles, X } from 'lucide-react'
import type { BriefingDelta } from '@/app/lib/briefing/load-since-last-visit'

interface SinceLastVisitStripProps {
  deltas: BriefingDelta[]
  snapshotAtIso: string
}

export default function SinceLastVisitStrip({
  deltas,
  snapshotAtIso
}: SinceLastVisitStripProps) {
  const [dismissed, setDismissed] = useState(false)
  const advanced = useRef(false)

  useEffect(() => {
    if (advanced.current) return
    advanced.current = true
    void fetch('/api/briefing/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotAt: snapshotAtIso })
    }).catch(() => {
      /* best-effort; a missed advance just re-shows the same deltas next visit */
    })
  }, [snapshotAtIso])

  if (dismissed || deltas.length === 0) return null

  return (
    <div
      className="relative flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_5%,transparent)] py-2 pl-3 pr-9"
      aria-label="Since your last visit"
    >
      <Sparkles className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
      <span className="shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
        Since your last visit
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
        {deltas.map((d) =>
          d.href ? (
            <Link
              key={d.kind}
              href={d.href}
              className="hover:text-[var(--text-primary)] hover:underline"
            >
              {d.label}
            </Link>
          ) : (
            <span key={d.kind}>{d.label}</span>
          )
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  )
}
