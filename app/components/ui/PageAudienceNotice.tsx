import { Lock } from 'lucide-react'

/**
 * States inline exactly who can see the page, derived from the real predicate
 * (PLAYER_STATS_AUDIENCE), so widening access without updating it is visible.
 */

export interface PageAudienceNoticeProps {
  /** Most- to least-obvious. */
  audience: readonly string[]
  label?: string
  footnote?: string
  className?: string
}

export function PageAudienceNotice({
  audience,
  label = 'Restricted page',
  footnote,
  className = ''
}: PageAudienceNoticeProps) {
  if (audience.length === 0) return null

  return (
    <div
      className={`rounded-lg border border-(--card-border) bg-(--card-bg) px-3 py-2 ${className}`}
      data-testid="page-audience-notice"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] px-2 py-1 font-semibold uppercase tracking-wide text-(--danger)">
          <Lock className="h-3 w-3" aria-hidden="true" />
          {label}
        </span>
        <span className="text-secondary-wh40k">visible to</span>
        {audience.map((who) => (
          <span
            key={who}
            className="rounded-md border border-(--card-border) px-2 py-1 text-primary-wh40k"
          >
            {who}
          </span>
        ))}
      </div>
      {footnote && (
        <p className="mt-1.5 text-[11px] leading-snug text-secondary-wh40k">
          {footnote}
        </p>
      )}
    </div>
  )
}
