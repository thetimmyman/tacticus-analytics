'use client'

import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import { useSearchParams } from 'next/navigation'
import { useDebounce } from '@/app/hooks/useDebounce'
import { useMetaUrlSync } from '@/app/lib/hooks/useMetaUrlSync'
import type { MetaFilters } from '../types'

/** Tab state lives here so it shares the filters' single `router.replace`; two writers race. */
type MetaAtlasTabOptions = {
  /** Rendered tab ids; unknown ids fall back. */
  tabIds: readonly string[]
  defaultTab: string
  /** Retired ids → replacement, for old shared links. */
  aliases?: Readonly<Record<string, string>>
}

type PendingUrlSelection<T> = {
  value: T
  key: string
  hasObservedDifferentValue: boolean
  /** Keeps states that serialize to the URL default but look distinct until history changes. */
  presentationUrlKey?: string
  presentationHasSettled?: boolean
}

const canonicalSetKey = (values: ReadonlySet<string>): string =>
  Array.from(values).sort().join(',')

const parseSetParam = (value: string | null): Set<string> =>
  new Set(value?.split(',').filter(Boolean) ?? [])

const pendingSelection = <T>(
  value: T,
  key: string
): PendingUrlSelection<T> => ({
  value,
  key,
  hasObservedDifferentValue: false
})

function reconcilePendingSelection<T>(
  pending: PendingUrlSelection<T> | null,
  urlKey: string,
  setPending: Dispatch<SetStateAction<PendingUrlSelection<T> | null>>,
  urlSnapshotKey: string = urlKey
) {
  if (!pending) return
  if (pending.presentationUrlKey !== undefined) {
    if (
      !pending.hasObservedDifferentValue &&
      pending.presentationUrlKey !== urlSnapshotKey
    ) {
      setPending({ ...pending, hasObservedDifferentValue: true })
    } else if (
      pending.hasObservedDifferentValue &&
      !pending.presentationHasSettled &&
      pending.presentationUrlKey === urlSnapshotKey
    ) {
      setPending({ ...pending, presentationHasSettled: true })
    } else if (
      pending.presentationHasSettled &&
      pending.presentationUrlKey !== urlSnapshotKey
    ) {
      setPending(null)
    }
    return
  }
  if (pending.hasObservedDifferentValue && pending.key === urlKey) {
    setPending(null)
  } else if (!pending.hasObservedDifferentValue && pending.key !== urlKey) {
    setPending({ ...pending, hasObservedDifferentValue: true })
  }
}

type MetaAtlasFilterState = {
  selectedSeason: string | null
  availableSeasons: string[]
  availableRaritySets: string[]
  selectedRaritySets: Set<string>
  selectedMetaTeams: Set<string>
  bossFilter: string
  debouncedBossFilter: string
  showAllBosses: boolean
  setSelectedSeason: (season: string) => void
  setBossFilter: (value: string) => void
  toggleShowAllBosses: () => void
  toggleRaritySet: (raritySet: string) => void
  selectAllRaritySets: () => void
  clearRaritySets: () => void
  toggleMetaTeam: (team: string) => void
  clearMetaTeams: () => void
  activeTab: string
  setActiveTab: (tabId: string) => void
}

export function useMetaAtlasFiltersState(
  filters: MetaFilters | null,
  dashboardSeason?: string | null,
  tabOptions?: MetaAtlasTabOptions
): MetaAtlasFilterState {
  const searchParams = useSearchParams()
  const urlSeason = searchParams.get('season')
  const urlRaritySets = searchParams.get('rarity')
  const urlMetaTeams = searchParams.get('teams')
  const urlBossFilter = searchParams.get('boss')
  const urlShowAll = searchParams.get('all') === 'true'
  const urlTab = searchParams.get('tab')

  const availableSeasons = useMemo(() => filters?.seasons || [], [filters])
  const defaultSeason = filters?.current_season ?? null
  const hasSeasonUniverse = filters !== null && availableSeasons.length > 0
  const isAvailableSeason = (season: string | null | undefined) =>
    Boolean(season && (!hasSeasonUniverse || availableSeasons.includes(season)))
  // Follow the dashboard season, then the data default; URL serialization must use the same value.
  const implicitSeason = isAvailableSeason(dashboardSeason)
    ? dashboardSeason!
    : isAvailableSeason(defaultSeason)
      ? defaultSeason!
      : (availableSeasons[0] ?? null)
  const validUrlSeason = isAvailableSeason(urlSeason) ? urlSeason : null
  const hasInvalidUrlSeason =
    hasSeasonUniverse && urlSeason !== null && validUrlSeason === null
  const urlSelectedSeason = validUrlSeason || implicitSeason
  const urlIntentSeason = validUrlSeason || implicitSeason || ''
  // Local intent until useMetaUrlSync commits the combined URL (one router writer).
  const [pendingSeason, setPendingSeason] =
    useState<PendingUrlSelection<string> | null>(null)
  reconcilePendingSelection(pendingSeason, urlIntentSeason, setPendingSeason)
  const selectedSeason = pendingSeason?.value ?? urlSelectedSeason

  // Read the URL every render so back/forward works; a state initializer would break it.
  const rawTab = urlTab ?? ''
  const resolvedTab = tabOptions?.aliases?.[rawTab] ?? rawTab
  const urlActiveTab = tabOptions
    ? resolvedTab && tabOptions.tabIds.includes(resolvedTab)
      ? resolvedTab
      : tabOptions.defaultTab
    : ''
  // Keep click intent until the URL catches up so an in-flight replace cannot flash the old tab.
  const [pendingTab, setPendingTab] =
    useState<PendingUrlSelection<string> | null>(null)
  // A rapid click back to the current tab waits for the URL to change and settle.
  reconcilePendingSelection(pendingTab, urlActiveTab, setPendingTab)
  const activeTab = pendingTab?.value ?? urlActiveTab

  const setActiveTab = useCallback(
    (tabId: string) => {
      if (!tabOptions?.tabIds.includes(tabId)) return
      if (pendingTab?.value === tabId) return
      if (!pendingTab && tabId === urlActiveTab) return
      setPendingTab(pendingSelection(tabId, tabId))
    },
    [pendingTab, setPendingTab, tabOptions, urlActiveTab]
  )

  // Completed seasons expose L1-M5; the live season only the tiers guilds have reached.
  const availableRaritySets = useMemo<string[]>(() => {
    if (!filters) return []
    if (
      selectedSeason &&
      filters.rarity_sets_by_season?.[selectedSeason]?.length
    ) {
      return filters.rarity_sets_by_season[selectedSeason]
    }
    return filters.rarity_sets
  }, [filters, selectedSeason])

  // Local input wins until its replacement settles; then Back/Forward is authoritative.
  const urlSelectedRaritySets = useMemo(
    () =>
      urlRaritySets
        ? parseSetParam(urlRaritySets)
        : new Set(filters ? availableRaritySets : []),
    [availableRaritySets, filters, urlRaritySets]
  )
  const urlRarityKey = canonicalSetKey(urlSelectedRaritySets)
  const [pendingRaritySets, setPendingRaritySets] =
    useState<PendingUrlSelection<Set<string>> | null>(null)
  reconcilePendingSelection(
    pendingRaritySets,
    urlRarityKey,
    setPendingRaritySets,
    urlRaritySets ?? ''
  )
  const selectedRaritySets = pendingRaritySets?.value ?? urlSelectedRaritySets

  const urlSelectedMetaTeams = useMemo(
    () => parseSetParam(urlMetaTeams),
    [urlMetaTeams]
  )
  const urlMetaTeamsKey = canonicalSetKey(urlSelectedMetaTeams)
  const [pendingMetaTeams, setPendingMetaTeams] = useState<PendingUrlSelection<
    Set<string>
  > | null>(null)
  reconcilePendingSelection(
    pendingMetaTeams,
    urlMetaTeamsKey,
    setPendingMetaTeams
  )
  const selectedMetaTeams = pendingMetaTeams?.value ?? urlSelectedMetaTeams

  const urlBossValue = urlBossFilter || ''
  const urlBossKey = urlBossValue.trim()
  const [pendingBossFilter, setPendingBossFilter] =
    useState<PendingUrlSelection<string> | null>(null)
  reconcilePendingSelection(pendingBossFilter, urlBossKey, setPendingBossFilter)
  const bossFilter = pendingBossFilter?.value ?? urlBossValue
  const debouncedLocalBossFilter = useDebounce(bossFilter, 300)
  // Debounce only while a local intent is outstanding; never overwrite browser navigation.
  const debouncedBossFilter = pendingBossFilter
    ? debouncedLocalBossFilter
    : urlBossValue

  const urlShowAllKey = String(urlShowAll)
  const [pendingShowAll, setPendingShowAll] =
    useState<PendingUrlSelection<boolean> | null>(null)
  reconcilePendingSelection(pendingShowAll, urlShowAllKey, setPendingShowAll)
  const showAllBosses = pendingShowAll?.value ?? urlShowAll

  const seasonForUrlSync =
    pendingSeason?.value ??
    (hasInvalidUrlSeason ? (implicitSeason ?? '') : undefined)

  useMetaUrlSync({
    raritySets: selectedRaritySets,
    metaTeams: selectedMetaTeams,
    bossFilter: debouncedBossFilter,
    showAllBosses,
    allRaritySets: availableRaritySets,
    season: seasonForUrlSync,
    implicitSeason,
    activeTab,
    defaultTabId: tabOptions?.defaultTab
  })

  const setBossFilter = useCallback(
    (value: string) => {
      const key = value.trim()
      if (pendingBossFilter?.key === key) return
      if (!pendingBossFilter && key === urlBossKey) return
      // The URL returned to this value before the debounce emitted: release the intent.
      if (
        key === urlBossKey &&
        debouncedLocalBossFilter.trim() === urlBossKey
      ) {
        setPendingBossFilter(null)
        return
      }
      setPendingBossFilter(pendingSelection(value, key))
    },
    [
      debouncedLocalBossFilter,
      pendingBossFilter,
      setPendingBossFilter,
      urlBossKey
    ]
  )

  const toggleShowAllBosses = useCallback(() => {
    const next = !showAllBosses
    const key = String(next)
    setPendingShowAll(pendingSelection(next, key))
  }, [setPendingShowAll, showAllBosses])

  const setRaritySelection = useCallback(
    (value: Set<string>) => {
      // Empty is "no filter" in the URL but a valid UI state; keep it until history changes the param.
      const key = canonicalSetKey(value)
      if (pendingRaritySets?.key === key) return
      if (!pendingRaritySets && key === urlRarityKey) return
      if (pendingRaritySets?.presentationHasSettled && key === urlRarityKey) {
        setPendingRaritySets(null)
        return
      }
      const presentationUrlKey = ''
      const urlSnapshotKey = urlRaritySets ?? ''
      const previousIntentMayNavigate =
        pendingRaritySets !== null &&
        pendingRaritySets.presentationUrlKey === undefined &&
        pendingRaritySets.key !== urlRarityKey
      setPendingRaritySets(
        value.size === 0
          ? {
              ...pendingSelection(value, key),
              presentationUrlKey,
              hasObservedDifferentValue: urlSnapshotKey !== presentationUrlKey,
              presentationHasSettled:
                urlSnapshotKey === presentationUrlKey &&
                !previousIntentMayNavigate
            }
          : pendingSelection(value, key)
      )
    },
    [pendingRaritySets, setPendingRaritySets, urlRarityKey, urlRaritySets]
  )

  const toggleRaritySet = useCallback(
    (rs: string) => {
      const next = new Set(selectedRaritySets)
      if (next.has(rs)) {
        next.delete(rs)
      } else {
        next.add(rs)
      }
      setRaritySelection(next)
    },
    [selectedRaritySets, setRaritySelection]
  )

  const selectAllRaritySets = useCallback(() => {
    setRaritySelection(new Set(availableRaritySets))
  }, [availableRaritySets, setRaritySelection])

  const clearRaritySets = useCallback(() => {
    setRaritySelection(new Set())
  }, [setRaritySelection])

  const setMetaTeamSelection = useCallback(
    (next: Set<string>) => {
      const key = canonicalSetKey(next)
      if (pendingMetaTeams?.key === key) return
      if (!pendingMetaTeams && key === urlMetaTeamsKey) return
      setPendingMetaTeams(pendingSelection(next, key))
    },
    [pendingMetaTeams, setPendingMetaTeams, urlMetaTeamsKey]
  )

  const toggleMetaTeam = useCallback(
    (team: string) => {
      const next = new Set(selectedMetaTeams)
      if (next.has(team)) {
        next.delete(team)
      } else {
        next.add(team)
      }
      setMetaTeamSelection(next)
    },
    [selectedMetaTeams, setMetaTeamSelection]
  )

  const clearMetaTeams = useCallback(() => {
    setMetaTeamSelection(new Set())
  }, [setMetaTeamSelection])

  const setSelectedSeason = useCallback(
    (season: string) => {
      if (pendingSeason?.value === season) return
      if (hasSeasonUniverse && !availableSeasons.includes(season)) return
      if (!pendingSeason && season === urlIntentSeason) return
      setPendingSeason(pendingSelection(season, season))
    },
    [
      availableSeasons,
      hasSeasonUniverse,
      pendingSeason,
      setPendingSeason,
      urlIntentSeason
    ]
  )

  return {
    selectedSeason,
    availableSeasons,
    availableRaritySets,
    selectedRaritySets,
    selectedMetaTeams,
    bossFilter,
    debouncedBossFilter,
    showAllBosses,
    setSelectedSeason,
    setBossFilter,
    toggleShowAllBosses,
    toggleRaritySet,
    selectAllRaritySets,
    clearRaritySets,
    toggleMetaTeam,
    clearMetaTeams,
    activeTab,
    setActiveTab
  }
}
