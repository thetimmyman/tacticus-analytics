'use client'

import { useId, useState } from 'react'
import clsx from 'clsx'
import {
  RadixDialog,
  RadixDialogContent,
  RadixDialogDescription,
  RadixDialogHeader,
  RadixDialogTitle,
  RadixDialogTrigger
} from '@tacticus/ui-kit/radix-dialog'
import { resolveHeroPortrait } from '@/app/lib/catalogs/hero-portrait-resolver'
import type { HeroCatalog } from '@/app/lib/catalogs'
import type { RosterHero } from '@/app/lib/hooks/shared/types'
import {
  getRankIconUrl,
  getRankName,
  getRarityFromProgressionIndex
} from '@/app/(dashboard)/roster/utils/roster-helpers'
import {
  getFrameUrl,
  getPortraitUrl,
  TILE_ASPECT_RATIO
} from '@/app/(dashboard)/roster/utils/tile-art'
import { TileStars } from '@/app/(dashboard)/roster/components/TileStars'
import {
  getStarsFromProgressionIndex,
  resolveRosterStars
} from '@/app/lib/tacticus/stars'
import type { HeroRole } from './types'

const ROLE_STYLES: Record<HeroRole, string> = {
  core: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
  flex: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300',
  mow: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300'
}
const ROLE_LABEL: Record<HeroRole, string> = {
  core: 'core',
  flex: 'flex',
  mow: 'MoW'
}

interface HeroCardProps {
  unitId: string
  role: HeroRole
  catalog: HeroCatalog | undefined
  usedCount?: number
  notReady?: boolean
  rosterHero?: RosterHero | null
  rosterStatus?: 'loading' | 'error' | 'ready'
  floorRankIndex?: number | null
}

export default function HeroCard({
  unitId,
  role,
  catalog,
  usedCount = 0,
  notReady = false,
  rosterHero,
  rosterStatus = 'ready',
  floorRankIndex = null
}: HeroCardProps) {
  const [open, setOpen] = useState(false)
  const detailId = useId()
  const { hero, portraitUrl, displayName, fallbackBadge } = resolveHeroPortrait(
    unitId,
    catalog
  )
  const used = usedCount > 0
  const progressionIndex = rosterHero?.progressionIndex ?? 0
  const rarity = getRarityFromProgressionIndex(progressionIndex)
  const rankIcon =
    role !== 'mow' && rosterHero?.rank != null
      ? getRankIconUrl(rosterHero.rank)
      : null
  // Portraits key on canonical unit_id; roster rows may carry the native id as `id` or `engineId`.
  const artUrl =
    [rosterHero?.engineId, hero?.engineId, hero?.unitId, rosterHero?.id]
      .map((id) => (id ? getPortraitUrl(id) : null))
      .find(Boolean) ?? portraitUrl
  const abilityRows = rosterHero?.abilities ?? []
  const abilityText = abilityRows.length
    ? abilityRows
        .map(
          (ability, index) =>
            `${ability.id || `Ability ${index + 1}`} ${ability.level ?? '—'}`
        )
        .join(' · ')
    : [
        rosterHero?.active != null ? `Active ${rosterHero.active}` : null,
        rosterHero?.passive != null ? `Passive ${rosterHero.passive}` : null
      ]
        .filter(Boolean)
        .join(' · ')
  const ownershipText = rosterHero
    ? 'Owned'
    : rosterStatus === 'loading'
      ? 'Loading roster…'
      : rosterStatus === 'error'
        ? 'Roster unavailable; ownership unknown.'
        : 'Not owned'
  const rankText =
    role === 'mow'
      ? 'No hero gear rank'
      : rosterHero?.rank != null
        ? `Gear ${getRankName(rosterHero.rank)}`
        : rosterHero
          ? 'Gear rank unavailable'
          : null
  const floorText =
    role !== 'mow' && rosterHero?.rank != null && floorRankIndex != null
      ? `${rosterHero.rank >= floorRankIndex ? 'Meets' : 'Below'} battlefield floor (${getRankName(floorRankIndex)})`
      : null
  const stars = resolveRosterStars(rosterHero?.starLevel, progressionIndex)
  const starsProgressionIndex =
    rosterHero?.starLevel != null
      ? (Array.from({ length: 20 }, (_, index) => index).find(
          (index) => getStarsFromProgressionIndex(index) === stars
        ) ?? progressionIndex)
      : progressionIndex
  const levelText =
    rosterHero?.xpLevel != null ? `Level ${rosterHero.xpLevel}` : null

  return (
    <RadixDialog open={open} onOpenChange={setOpen}>
      <div className="flex w-[84px] shrink-0 flex-col items-center gap-1">
        <RadixDialogTrigger asChild>
          <button
            type="button"
            aria-label={`${displayName || unitId} details`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-describedby={detailId}
            title={`${displayName || unitId} · ${ROLE_LABEL[role]}${used ? ' · used this war' : ''}${notReady ? ' · not ready' : ''}`}
            className="group block w-full rounded-lg text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-(--accent)"
          >
            <div className="pt-[7%]">
              <div
                className={clsx(
                  'relative w-full transition-transform duration-150 group-hover:scale-[1.03]',
                  used ? 'opacity-45 grayscale' : '',
                  notReady && !used && 'rounded-md ring-2 ring-red-500/70'
                )}
                style={{ aspectRatio: TILE_ASPECT_RATIO }}
              >
                <div
                  className="absolute overflow-hidden bg-(--bg-secondary)"
                  style={{ inset: '3.2% 3.7%' }}
                >
                  {artUrl ? (
                    <img
                      src={artUrl}
                      alt={displayName || unitId}
                      loading="lazy"
                      className={`h-full w-full ${artUrl === portraitUrl ? 'object-contain p-[12%]' : 'object-cover object-top'}`}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-base font-semibold text-secondary-wh40k">
                      {fallbackBadge}
                    </div>
                  )}
                </div>
                <img
                  src={getFrameUrl(rarity)}
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 h-full w-full select-none"
                  loading="lazy"
                />
                {rankIcon && (
                  <img
                    src={rankIcon}
                    alt=""
                    className="pointer-events-none absolute bottom-[1%] left-[1%] w-[30%] object-contain drop-shadow-sm"
                    loading="lazy"
                  />
                )}
                {rosterHero?.xpLevel != null && (
                  <span className="absolute bottom-[3%] right-[4%] rounded-sm bg-black/75 px-1 text-[10px] font-semibold leading-4 text-white">
                    {rosterHero.xpLevel}
                  </span>
                )}
                {rosterHero && (
                  <TileStars
                    progressionIndex={starsProgressionIndex}
                    className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2"
                  />
                )}
                {used && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-[-4%] top-1/2 h-0.5 -translate-y-1/2 -rotate-12 rounded-sm bg-(--text-primary)"
                  />
                )}
                {used && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-white dark:ring-zinc-900"
                  />
                )}
              </div>
            </div>
            <span className="mt-0.5 block truncate text-center text-[11px] leading-tight text-primary-wh40k">
              {displayName || unitId}
            </span>
          </button>
        </RadixDialogTrigger>
        <span id={detailId} className="sr-only">
          Open details for {displayName || unitId}
        </span>
        <span
          className={clsx(
            'rounded-sm px-1 text-[8px] font-bold uppercase leading-3',
            ROLE_STYLES[role]
          )}
        >
          {ROLE_LABEL[role]}
        </span>
      </div>

      <RadixDialogContent className="max-w-sm">
        <RadixDialogHeader>
          <RadixDialogTitle>{displayName || unitId}</RadixDialogTitle>
          <RadixDialogDescription>
            {ROLE_LABEL[role]} · {ownershipText}
          </RadixDialogDescription>
        </RadixDialogHeader>
        <div className="space-y-1 text-sm text-secondary-wh40k">
          {rankText && <div>{rankText}</div>}
          {levelText && <div>{levelText}</div>}
          {rosterHero && (
            <div>
              {rarity} · {stars} stars
            </div>
          )}
          {floorText && <div>{floorText}</div>}
          {abilityText && <div>Abilities: {abilityText}</div>}
          {role === 'mow' && (
            <div>Gear floor does not apply to Machines of War.</div>
          )}
          {used && (
            <div>
              {usedCount === 1
                ? 'Used this war once'
                : `Used this war ${usedCount} times`}
            </div>
          )}
          {notReady && (
            <div className="text-red-500">
              Not ready for this battlefield floor.
            </div>
          )}
        </div>
      </RadixDialogContent>
    </RadixDialog>
  )
}
