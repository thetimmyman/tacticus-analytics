'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ban, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { mergeReusableRoles } from '@/app/lib/boss-ops/roles'
import type {
  SeasonalBossCardData,
  SeasonalBossHubData,
  SeasonalEncounterData,
  SeasonalHubRoleEntry
} from '../seasonal-hub-utils'
import type { ReusableHeraldRole } from './seasonal-hub/types'
import {
  encounterSectionId,
  isEncounterSkipped,
  loadSeasonalHubSeason,
  reusableRolesFromHubData
} from './seasonal-hub/message-state'
import { StatusPill } from './seasonal-hub/encounter-blocks'
import { OpsPanel } from './seasonal-hub/OpsPanel'

type SeasonalBossHubProps = {
  data: SeasonalBossHubData | null
}

function ActiveEncounterDetail({
  card,
  data,
  reusableRoles,
  onRememberRoles,
  onDirtyChange
}: {
  card: SeasonalBossCardData
  data: SeasonalBossHubData
  reusableRoles: ReusableHeraldRole[]
  onRememberRoles: (roles: SeasonalHubRoleEntry[]) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  return (
    <OpsPanel
      card={card}
      data={data}
      reusableRoles={reusableRoles}
      onRememberRoles={onRememberRoles}
      onDirtyChange={onDirtyChange}
    />
  )
}

export function SeasonalBossHub({ data }: SeasonalBossHubProps) {
  const [selectedSeason, setSelectedSeason] = useState(
    String(data?.seasonNumber ?? '')
  )
  const [seasonDataByNumber, setSeasonDataByNumber] = useState<
    Record<string, SeasonalBossHubData>
  >(() =>
    data
      ? {
          ...(data.seasonsByNumber ?? {}),
          [String(data.seasonNumber)]: data
        }
      : {}
  )
  useEffect(() => {
    if (!data) return
    const primarySeason = String(data.seasonNumber)
    const incomingSeasons = data.seasonsByNumber ?? {}
    setSeasonDataByNumber((current) => {
      const alreadyCurrent =
        current[primarySeason] === data &&
        Object.entries(incomingSeasons).every(
          ([season, hub]) => current[season] === hub
        )
      return alreadyCurrent
        ? current
        : { ...current, ...incomingSeasons, [primarySeason]: data }
    })
  }, [data])
  const [loadingSeason, setLoadingSeason] = useState<string | null>(null)
  const [seasonLoadError, setSeasonLoadError] = useState<string | null>(null)
  const [selectedCardKey, setSelectedCardKey] = useState<string | null>(null)
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null)
  const [rememberedRolesByGuild, setRememberedRolesByGuild] = useState<
    Record<string, SeasonalHubRoleEntry[]>
  >({})

  // A ref, not state: it only gates imperative switches.
  const opsPanelDirtyRef = useRef(false)
  const handleOpsPanelDirtyChange = useCallback((dirty: boolean) => {
    opsPanelDirtyRef.current = dirty
  }, [])
  const confirmDiscardOpsEdits = () =>
    !opsPanelDirtyRef.current ||
    window.confirm(
      'You have unsaved ops edits on this encounter. Discard them?'
    )

  const reusableRoleScope = data?.guildCode ?? '__default__'
  const loadedHubData = useMemo(
    () =>
      data
        ? {
            ...data,
            seasonsByNumber: seasonDataByNumber
          }
        : null,
    [data, seasonDataByNumber]
  )
  const reusableRolesFromData = useMemo(
    () => reusableRolesFromHubData(loadedHubData),
    [loadedHubData]
  )
  const reusableRoles = useMemo(
    () =>
      mergeReusableRoles(
        reusableRolesFromData,
        rememberedRolesByGuild[reusableRoleScope] ?? []
      ),
    [rememberedRolesByGuild, reusableRoleScope, reusableRolesFromData]
  )

  const rememberReusableRoles = (roles: SeasonalHubRoleEntry[]) => {
    setRememberedRolesByGuild((current) => ({
      ...current,
      [reusableRoleScope]: mergeReusableRoles(
        current[reusableRoleScope] ?? [],
        roles
      )
    }))
  }

  const selectSeason = async (season: string) => {
    // Switching seasons remounts the ops panel; confirm before dropping edits.
    if (season !== selectedSeason && !confirmDiscardOpsEdits()) return
    if (seasonDataByNumber[season]) {
      setSelectedSeason(season)
      setSelectedCardKey(null)
      setSeasonLoadError(null)
      return
    }

    setLoadingSeason(season)
    setSeasonLoadError(null)
    try {
      const hub = await loadSeasonalHubSeason(season)
      setSeasonDataByNumber((current) => ({
        ...current,
        [season]: hub
      }))
      setSelectedSeason(season)
      setSelectedCardKey(null)
    } catch {
      setSeasonLoadError(`Could not load season ${season}. Please try again.`)
    } finally {
      setLoadingSeason(null)
    }
  }

  const activeData = useMemo(() => {
    if (!data) return null
    return seasonDataByNumber[selectedSeason] ?? null
  }, [data, seasonDataByNumber, selectedSeason])

  const cards = useMemo(() => {
    if (!activeData) return []
    return activeData.groups.flatMap((group) => group.cards)
  }, [activeData])

  const filteredGroups = useMemo(() => {
    if (!activeData) return []
    return activeData.groups.filter((group) => group.cards.length > 0)
  }, [activeData])

  const visibleCards = useMemo(
    () => filteredGroups.flatMap((group) => group.cards),
    [filteredGroups]
  )

  useEffect(() => {
    if (!pendingScrollId) return
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(pendingScrollId)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setPendingScrollId(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pendingScrollId, selectedCardKey])

  if (!data || !activeData || activeData.groups.length === 0) return null

  const totalBosses = cards.length
  const selectedSeasonIsCurrent =
    activeData.seasonNumber === data.currentSeasonNumber
  const selectedCard =
    visibleCards.find((card) => card.key === selectedCardKey) ??
    visibleCards[0] ??
    null
  const selectEncounter = (
    card: SeasonalBossCardData,
    encounter?: SeasonalEncounterData
  ) => {
    // Switching cards remounts the ops panel; confirm first. Same-card jumps never prompt.
    if (card.key !== selectedCard?.key && !confirmDiscardOpsEdits()) return
    setSelectedCardKey(card.key)
    setPendingScrollId(encounterSectionId(card.key, encounter?.key))
  }

  return (
    <>
      <section className="space-y-4 border-b border-[var(--card-border)] pb-6">
        <div className="rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_55%,transparent)] p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-[var(--text-primary)]">
                Season {activeData.seasonNumber}
              </h2>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--text-tertiary)]">
                <span>
                  {totalBosses} {selectedSeasonIsCurrent ? 'current' : 'season'}{' '}
                  bosses
                </span>
              </div>
            </div>

            {data.seasonOptions && data.seasonOptions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {data.seasonOptions.map((option) => {
                  const displayLabel = (option.label.split('·')[0] ?? '').trim()
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        if (option.available) void selectSeason(option.value)
                      }}
                      disabled={!option.available || loadingSeason !== null}
                      aria-busy={loadingSeason === option.value}
                      aria-pressed={selectedSeason === option.value}
                      className={clsx(
                        'rounded-md border px-2 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] transition-colors sm:px-3 sm:text-sm sm:tracking-[0.12em]',
                        selectedSeason === option.value
                          ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)]'
                          : 'border-transparent bg-transparent text-[var(--text-secondary)] hover:border-[var(--card-border)] hover:text-[var(--text-primary)]',
                        !option.available && 'cursor-not-allowed opacity-35'
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {loadingSeason === option.value && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                        {displayLabel}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {seasonLoadError && (
            <p className="mt-3 text-xs text-red-300" role="alert">
              {seasonLoadError}
            </p>
          )}
        </div>

        {filteredGroups.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_65%,transparent)] p-2 xl:sticky xl:top-32 xl:max-h-[calc(100vh-9rem)] xl:overflow-auto">
              <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                Encounters
              </div>
              {/* Scrollable strip on mobile; block list with side-encounter detail on desktop. */}
              <div className="flex gap-2 overflow-x-auto pb-1 xl:hidden">
                {visibleCards.map((card) => (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => selectEncounter(card)}
                    aria-pressed={selectedCard?.key === card.key}
                    className={clsx(
                      'flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1.5',
                      selectedCard?.key === card.key
                        ? 'border-[color-mix(in_srgb,var(--accent)_50%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                        : 'border-transparent bg-[color-mix(in_srgb,var(--bg-tertiary)_50%,transparent)] hover:border-[var(--card-border)]'
                    )}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                      {card.difficultyCode}
                    </span>
                    <BossPortrait
                      bossName={card.bossName}
                      lookupName={card.portraitLookupName}
                      size="small"
                      variant="thumbnail"
                    />
                    <StatusPill card={card} />
                  </button>
                ))}
              </div>

              <div className="hidden xl:block xl:space-y-1">
                {visibleCards.map((card) => (
                  <div
                    key={card.key}
                    className={clsx(
                      'group/nav min-w-0 rounded-md border transition-colors',
                      selectedCard?.key === card.key
                        ? 'border-[color-mix(in_srgb,var(--accent)_50%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                        : 'border-transparent hover:border-[var(--card-border)] hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_50%,transparent)]'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectEncounter(card)}
                      className="grid w-full grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 text-left"
                    >
                      <BossPortrait
                        bossName={card.bossName}
                        lookupName={card.portraitLookupName}
                        size="small"
                        variant="thumbnail"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                          {card.bossName}
                        </span>
                        <span className="block truncate text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                          {card.difficultyCode} · {card.boardId}
                        </span>
                      </span>
                      {data.canManageHerald ? (
                        <StatusPill card={card} />
                      ) : (
                        <span className="rounded-md border border-[var(--card-border)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">
                          {card.difficultyCode}
                        </span>
                      )}
                    </button>
                    {card.sideEncounters.length > 0 && (
                      <div className="hidden px-2 pb-2 xl:block">
                        <div className="space-y-1">
                          {card.sideEncounters.map((encounter) => {
                            const skipped = isEncounterSkipped(encounter)
                            return (
                              <button
                                key={encounter.key}
                                type="button"
                                onClick={() => selectEncounter(card, encounter)}
                                title={`${encounter.bossName} · ${encounter.boardId}${skipped ? ' · Skipped' : ''}`}
                                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-black/20 hover:text-[var(--text-primary)]"
                              >
                                <span className="min-w-0">
                                  <span
                                    className={clsx(
                                      'block break-words font-medium leading-snug',
                                      skipped
                                        ? 'text-[var(--text-tertiary)] line-through'
                                        : 'text-[var(--text-secondary)]'
                                    )}
                                  >
                                    {encounter.bossName}
                                  </span>
                                  <span className="mt-0.5 block break-all text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                                    {encounter.boardId}
                                  </span>
                                </span>
                                {skipped && (
                                  <Ban
                                    className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]"
                                    aria-label="Skipped"
                                  />
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </aside>

            <div className="min-w-0 space-y-3">
              {selectedCard ? (
                <ActiveEncounterDetail
                  key={`${selectedSeason}-${selectedCard.key}`}
                  card={selectedCard}
                  data={activeData}
                  reusableRoles={reusableRoles}
                  onRememberRoles={rememberReusableRoles}
                  onDirtyChange={handleOpsPanelDirtyChange}
                />
              ) : (
                <div className="rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_65%,transparent)] p-8 text-center text-sm text-[var(--text-tertiary)]">
                  No seasonal encounters available.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_65%,transparent)] p-8 text-center text-sm text-[var(--text-tertiary)]">
            No seasonal encounters available.
          </div>
        )}
      </section>
    </>
  )
}
