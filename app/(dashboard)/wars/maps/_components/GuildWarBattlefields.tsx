'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { X, ImageOff } from 'lucide-react'
import {
  boardThumbnailUrl,
  getGuildWarSeason,
  guildWarSeasonIds,
  guildWarSourceBuildId,
  inferSeasonId,
  seasonLabel,
  zoneIconUrl
} from '@/app/(dashboard)/wars/maps/_data/guild-war-map'
import { boardDisplayName, zoneDisplayName } from '@/app/lib/war/war-naming'

interface GuildWarBattlefieldsProps {
  observedZoneTypes?: readonly string[]
}

export default function GuildWarBattlefields({
  observedZoneTypes = []
}: GuildWarBattlefieldsProps) {
  const inferred = useMemo(
    () => inferSeasonId(observedZoneTypes),
    [observedZoneTypes]
  )
  const [lightbox, setLightbox] = useState<string | null>(null)

  // Derived, not synced by an effect: an explicit pick wins, else the inference.
  const [pickedSeasonId, setPickedSeasonId] = useState<string | null>(null)
  const seasonId = pickedSeasonId ?? inferred

  const season = getGuildWarSeason(seasonId)

  const closeLightbox = useCallback(() => setLightbox(null), [])
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, closeLightbox])

  if (!season) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-6 text-sm text-slate-400">
        No Guild War season configuration is available in the current game data.
      </div>
    )
  }

  const lightboxUrl = lightbox ? boardThumbnailUrl(lightbox) : null

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Battlefields</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            The zone layout and the board pool both rotate by season, so these
            are read from the production game config rather than fixed. Seasons
            cycle {guildWarSeasonIds.map(seasonLabel).join(' → ')} →{' '}
            {seasonLabel(guildWarSeasonIds[0] ?? '')}.
          </p>
        </div>
        <div
          role="group"
          aria-label="Guild War season"
          className="flex flex-wrap gap-1 rounded-lg border border-slate-700 bg-slate-800/60 p-1"
        >
          {guildWarSeasonIds.map((id) => {
            const active = id === seasonId
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => setPickedSeasonId(id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'text-slate-400 hover:bg-slate-700/60 hover:text-slate-200'
                }`}
              >
                {seasonLabel(id)}
                {id === inferred && observedZoneTypes.length > 0 ? (
                  <span className="ml-1 text-[10px] text-emerald-400">•</span>
                ) : null}
              </button>
            )
          })}
        </div>
      </header>

      {/* Zone grid — the war map itself */}
      <section aria-labelledby="gw-zone-grid-heading">
        <h3
          id="gw-zone-grid-heading"
          className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-400"
        >
          Zone layout
        </h3>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {season.zoneGrid.flatMap((row) =>
            row.map((zoneType) => {
              const cfg = season.zoneTypes[zoneType]
              const icon = zoneIconUrl(cfg?.visualId)
              return (
                <div
                  key={zoneType}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/50 p-2 text-center sm:p-3"
                >
                  {icon ? (
                    <Image
                      src={icon}
                      alt=""
                      width={56}
                      height={56}
                      className="h-10 w-10 object-contain sm:h-14 sm:w-14"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center text-slate-600 sm:h-14 sm:w-14">
                      <ImageOff className="h-5 w-5" aria-hidden="true" />
                    </div>
                  )}
                  <span className="text-[11px] font-medium leading-tight text-slate-200 sm:text-xs">
                    {zoneDisplayName(zoneType)}
                  </span>
                  {typeof cfg?.score === 'number' ? (
                    <span className="text-[10px] tabular-nums text-slate-500">
                      {cfg.score.toLocaleString()} pts
                    </span>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* Board pool — click a thumbnail to enlarge */}
      <section aria-labelledby="gw-board-pool-heading">
        <h3
          id="gw-board-pool-heading"
          className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-400"
        >
          Board pool ({season.mapPool.length})
        </h3>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {season.mapPool.map(({ boardId, spawnPointsSet }) => {
            const thumb = boardThumbnailUrl(boardId)
            const boardName = boardDisplayName(boardId)
            return (
              <li key={boardId}>
                {thumb ? (
                  <button
                    type="button"
                    onClick={() => setLightbox(boardId)}
                    className="group w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-800/50 text-left transition-colors hover:border-amber-500/60 focus:border-amber-500 focus:outline-none"
                    aria-label={`Enlarge board ${boardName}`}
                  >
                    <Image
                      src={thumb}
                      alt=""
                      width={512}
                      height={512}
                      className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.03]"
                    />
                    <span className="block truncate px-2 py-1.5 text-xs font-medium text-slate-200">
                      {boardName}
                    </span>
                    {typeof spawnPointsSet === 'number' ? (
                      <span className="block px-2 pb-1.5 text-[10px] text-slate-500">
                        Spawn set {spawnPointsSet}
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <div className="w-full overflow-hidden rounded-lg border border-dashed border-slate-700 bg-slate-800/30">
                    <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 text-slate-600">
                      <ImageOff className="h-6 w-6" aria-hidden="true" />
                      <span className="px-2 text-center text-[10px] leading-tight">
                        no art in this build
                      </span>
                    </div>
                    <span className="block truncate px-2 py-1.5 text-xs font-medium text-slate-400">
                      {boardName}
                    </span>
                    {typeof spawnPointsSet === 'number' ? (
                      <span className="block px-2 pb-1.5 text-[10px] text-slate-500">
                        Spawn set {spawnPointsSet}
                      </span>
                    ) : null}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <p className="text-[11px] text-slate-500">
        Art extracted from production build {guildWarSourceBuildId}.
      </p>

      {lightbox && lightboxUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Board ${boardDisplayName(lightbox)}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={closeLightbox}
        >
          <div
            className="relative max-h-full w-full max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeLightbox}
              aria-label="Close"
              className="absolute -top-2 right-0 -translate-y-full rounded p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <X className="h-5 w-5" />
            </button>
            <Image
              src={lightboxUrl}
              alt={`Guild War board ${boardDisplayName(lightbox)}`}
              width={1024}
              height={1024}
              className="h-auto max-h-[80vh] w-full rounded-lg object-contain"
            />
            <p className="mt-2 text-center text-sm font-medium text-slate-200">
              {boardDisplayName(lightbox)}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
