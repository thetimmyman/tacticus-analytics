import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { dbClient } from '@/app/lib/db/client'
import { useDebounce } from '@/app/hooks/useDebounce'
import {
  KNOWN_ZONE_TYPES,
  zoneDisplayName,
  zoneShortName
} from '@/app/lib/war/war-naming'

export const WAR_EXPLORER_PAGE_SIZE = 25

export type WarExplorerTab = 'matches' | 'activity' | 'zones'

export interface DataState<T> {
  data: T[]
  page: number
  total: number
  loading: boolean
  error: string | null
}

export function isValidWarExplorerTab(
  value: string | null
): value is WarExplorerTab {
  return value === 'matches' || value === 'activity' || value === 'zones'
}

// The Type column shows a derived name, so also match the term against zone types client-side.
export function buildZoneSearchClauses(search: string) {
  const needle = search.toLowerCase()
  return [
    `guild_code.ilike.%${search}%`,
    `zone_type.ilike.%${search}%`,
    ...KNOWN_ZONE_TYPES.filter(
      (zoneType) =>
        zoneDisplayName(zoneType).toLowerCase().includes(needle) ||
        zoneShortName(zoneType).toLowerCase().includes(needle)
    ).map((zoneType) => `zone_type.eq.${zoneType}`)
  ].join(',')
}

function initialState<T>(page: number): DataState<T> {
  return { data: [], page, total: 0, loading: true, error: null }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected error occurred'
}

export function useGuildWarExplorerData<
  WarMatch,
  PlayerAttempt,
  ZoneAssignment
>() {
  const supabase = dbClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlTab = searchParams.get('tab')
  const urlSearch = searchParams.get('q') || ''
  const urlPage = parseInt(searchParams.get('page') || '0', 10)
  const initialTab: WarExplorerTab = isValidWarExplorerTab(urlTab)
    ? urlTab
    : 'matches'

  const [activeTab, setActiveTab] = useState<WarExplorerTab>(initialTab)
  const [searchTerm, setSearchTerm] = useState(urlSearch)
  const debouncedSearch = useDebounce(searchTerm, 300)
  const [matchesState, setMatchesState] = useState<DataState<WarMatch>>(() =>
    initialState(activeTab === 'matches' ? urlPage : 0)
  )
  const [attemptsState, setAttemptsState] = useState<DataState<PlayerAttempt>>(
    () => initialState(activeTab === 'activity' ? urlPage : 0)
  )
  const [zonesState, setZonesState] = useState<DataState<ZoneAssignment>>(() =>
    initialState(activeTab === 'zones' ? urlPage : 0)
  )

  const fetchMatches = useCallback(async () => {
    setMatchesState((state) => ({ ...state, loading: true, error: null }))
    try {
      let query = supabase
        .from('guild_war_matches')
        .select('*', { count: 'exact' })
        .order('war_start_date', { ascending: false })
        .range(
          matchesState.page * WAR_EXPLORER_PAGE_SIZE,
          (matchesState.page + 1) * WAR_EXPLORER_PAGE_SIZE - 1
        )
      if (debouncedSearch) {
        query = query.or(
          `guild_code.ilike.%${debouncedSearch}%,opponent_guild_name.ilike.%${debouncedSearch}%,opponent_guild_code.ilike.%${debouncedSearch}%`
        )
      }
      const { data, count, error } = await query
      if (error) throw error
      setMatchesState((state) => ({
        ...state,
        data: (data || []) as WarMatch[],
        total: count || 0,
        loading: false,
        error: null
      }))
    } catch (error) {
      setMatchesState((state) => ({
        ...state,
        loading: false,
        error: errorMessage(error)
      }))
    }
  }, [supabase, matchesState.page, debouncedSearch])

  const fetchAttempts = useCallback(async () => {
    setAttemptsState((state) => ({ ...state, loading: true, error: null }))
    try {
      let query = supabase
        .from('guild_war_player_attempts')
        .select('*', { count: 'exact' })
        .order('attempt_start_time', { ascending: false })
        .range(
          attemptsState.page * WAR_EXPLORER_PAGE_SIZE,
          (attemptsState.page + 1) * WAR_EXPLORER_PAGE_SIZE - 1
        )
      if (debouncedSearch) {
        query = query.or(
          `guild_code.ilike.%${debouncedSearch}%,attacker_guild_name.ilike.%${debouncedSearch}%,player_name.ilike.%${debouncedSearch}%`
        )
      }
      const { data, count, error } = await query
      if (error) throw error
      setAttemptsState((state) => ({
        ...state,
        data: (data || []) as PlayerAttempt[],
        total: count || 0,
        loading: false,
        error: null
      }))
    } catch (error) {
      setAttemptsState((state) => ({
        ...state,
        loading: false,
        error: errorMessage(error)
      }))
    }
  }, [supabase, attemptsState.page, debouncedSearch])

  const fetchZones = useCallback(async () => {
    setZonesState((state) => ({ ...state, loading: true, error: null }))
    try {
      let query = supabase
        .from('guild_war_zones')
        .select('*', { count: 'exact' })
        .order('updated_at', { ascending: false })
        .range(
          zonesState.page * WAR_EXPLORER_PAGE_SIZE,
          (zonesState.page + 1) * WAR_EXPLORER_PAGE_SIZE - 1
        )
      if (debouncedSearch) {
        query = query.or(buildZoneSearchClauses(debouncedSearch))
      }
      const { data, count, error } = await query
      if (error) throw error
      setZonesState((state) => ({
        ...state,
        data: (data || []) as ZoneAssignment[],
        total: count || 0,
        loading: false,
        error: null
      }))
    } catch (error) {
      setZonesState((state) => ({
        ...state,
        loading: false,
        error: errorMessage(error)
      }))
    }
  }, [supabase, zonesState.page, debouncedSearch])

  useEffect(() => {
    if (activeTab === 'matches') void fetchMatches()
  }, [activeTab, fetchMatches])
  useEffect(() => {
    if (activeTab === 'activity') void fetchAttempts()
  }, [activeTab, fetchAttempts])
  useEffect(() => {
    if (activeTab === 'zones') void fetchZones()
  }, [activeTab, fetchZones])

  useEffect(() => {
    setMatchesState((state) => ({ ...state, page: 0 }))
    setAttemptsState((state) => ({ ...state, page: 0 }))
    setZonesState((state) => ({ ...state, page: 0 }))
  }, [debouncedSearch])

  useEffect(() => {
    const page =
      activeTab === 'matches'
        ? matchesState.page
        : activeTab === 'activity'
          ? attemptsState.page
          : zonesState.page
    const params = new URLSearchParams()
    if (activeTab !== 'matches') params.set('tab', activeTab)
    if (page > 0) params.set('page', String(page))
    if (debouncedSearch) params.set('q', debouncedSearch)
    const query = params.toString()
    router.replace(`/war-explorer${query ? `?${query}` : ''}`, {
      scroll: false
    })
  }, [
    activeTab,
    matchesState.page,
    attemptsState.page,
    zonesState.page,
    debouncedSearch,
    router
  ])

  return {
    activeTab,
    setActiveTab,
    searchTerm,
    setSearchTerm,
    debouncedSearch,
    matchesState,
    attemptsState,
    zonesState,
    setMatchesPage: (page: number) =>
      setMatchesState((state) => ({ ...state, page })),
    setAttemptsPage: (page: number) =>
      setAttemptsState((state) => ({ ...state, page })),
    setZonesPage: (page: number) =>
      setZonesState((state) => ({ ...state, page })),
    fetchMatches,
    fetchAttempts,
    fetchZones
  }
}
