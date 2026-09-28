'use client'

import Link from 'next/link'
import { Film, Pin, Play, Star } from 'lucide-react'
import clsx from 'clsx'
import type {
  SeasonalEncounterData,
  SeasonalHubReplay
} from '../../seasonal-hub-utils'
import { MiniTeam } from './encounter-blocks'
import { formatDamage } from './message-state'

/** Shared so header and footer agree. */
export function encounterCatalogHref(encounter: SeasonalEncounterData) {
  const params = new URLSearchParams({ boss: encounter.bossType })
  if (encounter.boardId) params.set('board', encounter.boardId)
  return `/replays?${params.toString()}`
}

function ReplayRow({ replay }: { replay: SeasonalHubReplay }) {
  const body = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {replay.isPinnedByGuild ? (
          <Pin
            className="h-3.5 w-3.5 shrink-0 text-(--accent)"
            aria-label="Pinned by your guild"
          />
        ) : replay.isFeatured ? (
          <Star
            className="h-3.5 w-3.5 shrink-0 text-amber-300"
            aria-label="Featured"
          />
        ) : (
          <Film className="h-3.5 w-3.5 shrink-0 text-(--text-tertiary)" />
        )}
        <span className="truncate text-xs font-semibold text-primary-wh40k">
          {replay.title}
        </span>
      </div>
      {replay.units.length > 0 && <MiniTeam units={replay.units} compact />}
      {replay.damage !== null && (
        <span className="shrink-0 font-mono text-xs font-semibold text-emerald-300">
          {formatDamage(replay.damage)}
        </span>
      )}
      {replay.mediaHref && (
        <Play
          className="h-3.5 w-3.5 shrink-0 text-(--accent)"
          aria-label="Has video"
        />
      )}
    </>
  )

  const rowClassName = clsx(
    'flex items-center gap-2 rounded-md border px-2 py-1.5',
    'border-(--card-border) bg-black/20',
    'hover:border-[color-mix(in_srgb,var(--accent)_55%,transparent)]'
  )

  return (
    <li>
      {replay.mediaHref ? (
        <a
          href={replay.mediaHref}
          target="_blank"
          rel="noopener noreferrer"
          className={rowClassName}
        >
          {body}
        </a>
      ) : (
        <Link href={replay.href} className={rowClassName}>
          {body}
        </Link>
      )}
    </li>
  )
}

export function EncounterReplays({
  encounter
}: {
  encounter: SeasonalEncounterData
}) {
  const { topReplays, availableReplayCount } = encounter
  const hasAny = topReplays.length > 0

  return (
    <section className="rounded-md border border-(--card-border) bg-black/15 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-(--text-tertiary)">
          Community replays
        </div>
        {availableReplayCount > 0 && (
          <Link
            href={encounterCatalogHref(encounter)}
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-(--accent) hover:underline"
          >
            {availableReplayCount === 1
              ? 'View 1 replay'
              : `View all ${availableReplayCount} replays`}
          </Link>
        )}
      </div>

      {hasAny ? (
        <div className="mt-2 space-y-2">
          {topReplays.length > 0 && (
            <ul className="space-y-1">
              {topReplays.map((replay) => (
                <ReplayRow key={replay.id} replay={replay} />
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs italic text-(--text-tertiary)">
          No community replays are available for this encounter yet.
        </p>
      )}
    </section>
  )
}
