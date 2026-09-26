import Link from 'next/link'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'

const SIDES = ['offense', 'defense'] as const

const SIDE_LABELS: Record<(typeof SIDES)[number], string> = {
  offense: 'Offense',
  defense: 'Defense'
}

/** `chips`: two pills (Cores). `segmented`: compact switch at the end of the Lineups rail. */
type SideToggleVariant = 'chips' | 'segmented'

export default function SideTogglePills({
  active,
  basePath,
  variant = 'chips',
  season = null
}: {
  active: 'offense' | 'defense'
  basePath: '/wars/lineups' | '/wars/cores'
  variant?: SideToggleVariant
  season?: string | null
}) {
  const hrefFor = (side: (typeof SIDES)[number]) =>
    getHrefWithSeason(`${basePath}/${side}`, season)

  if (variant === 'segmented') {
    return (
      <div
        role="group"
        aria-label="Composition side"
        className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] p-0.5"
      >
        {SIDES.map((side) =>
          side === active ? (
            <span
              key={side}
              aria-current="page"
              className="inline-flex min-h-11 items-center rounded-full px-3 py-1 text-xs font-medium bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"
            >
              {SIDE_LABELS[side]}
            </span>
          ) : (
            <Link
              key={side}
              href={hrefFor(side)}
              className="inline-flex min-h-11 items-center rounded-full px-3 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {SIDE_LABELS[side]}
            </Link>
          )
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      {SIDES.map((side) =>
        side === active ? (
          <span
            key={side}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] text-[var(--bg-primary)]"
          >
            {SIDE_LABELS[side]}
          </span>
        ) : (
          <Link
            key={side}
            href={hrefFor(side)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] transition-colors"
          >
            {SIDE_LABELS[side]}
          </Link>
        )
      )}
    </div>
  )
}
