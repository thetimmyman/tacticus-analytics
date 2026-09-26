import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetaFilters } from '@/app/(dashboard)/meta-atlas/types'

const navigation = vi.hoisted(() => ({
  search: '',
  replace: vi.fn()
}))
const urlSync = vi.hoisted(() => ({ sync: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/meta-atlas',
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search)
}))

vi.mock('@/app/hooks/useDebounce', () => ({
  useDebounce: (value: string) => value
}))

vi.mock('@/app/lib/hooks/useMetaUrlSync', () => ({
  useMetaUrlSync: urlSync.sync
}))

import { useMetaAtlasFiltersState } from '@/app/(dashboard)/meta-atlas/hooks/useMetaAtlasFiltersState'

const tabOptions = {
  tabIds: ['best-teams', 'team-ideas', 'trends'],
  defaultTab: 'best-teams',
  aliases: { global: 'best-teams' }
} as const

const seasonFilters = {
  bosses: ['avatar'],
  current_season_bosses: [{ boss_type: 'avatar', boss_name: 'Avatar' }],
  seasons: ['106', '105'],
  current_season: '106',
  previous_season: '105',
  season_number: 106,
  rarity_sets: ['L1', 'M1'],
  rarity_sets_by_season: {
    '106': ['L1', 'M1'],
    '105': ['L1', 'M1']
  },
  meta_teams: ['Admech', 'Orkz']
} as MetaFilters

describe('useMetaAtlasFiltersState tab URL state', () => {
  beforeEach(() => {
    navigation.search = ''
    navigation.replace.mockReset()
    urlSync.sync.mockReset()
  })

  it('follows URL changes from browser back and forward navigation', () => {
    navigation.search = 'season=106&tab=team-ideas'
    const { result, rerender } = renderHook(() =>
      useMetaAtlasFiltersState(null, null, tabOptions)
    )

    expect(result.current.activeTab).toBe('team-ideas')

    navigation.search = 'season=106&tab=trends'
    rerender()
    expect(result.current.activeTab).toBe('trends')

    navigation.search = 'season=106&tab=team-ideas'
    rerender()
    expect(result.current.activeTab).toBe('team-ideas')
  })

  it('serializes a rapid filter and tab change through one URL-sync state', () => {
    navigation.search = 'season=106&boss=Avatar'
    const { result } = renderHook(() =>
      useMetaAtlasFiltersState(null, null, tabOptions)
    )

    act(() => {
      result.current.setBossFilter('Screamer')
      result.current.setActiveTab('team-ideas')
    })

    expect(result.current.activeTab).toBe('team-ideas')
    expect(navigation.replace).not.toHaveBeenCalled()
    expect(urlSync.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bossFilter: 'Screamer',
        activeTab: 'team-ideas',
        defaultTabId: 'best-teams'
      })
    )
  })

  it('serializes a rapid season and tab change through the same URL-sync state', () => {
    navigation.search = 'boss=Avatar'
    const { result, rerender } = renderHook(() =>
      useMetaAtlasFiltersState(null, null, tabOptions)
    )

    act(() => {
      result.current.setSelectedSeason('105')
      result.current.setActiveTab('trends')
    })

    expect(result.current.selectedSeason).toBe('105')
    expect(result.current.activeTab).toBe('trends')
    expect(navigation.replace).not.toHaveBeenCalled()
    expect(urlSync.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ season: '105', activeTab: 'trends' })
    )

    navigation.search = 'boss=Avatar&season=105&tab=trends'
    rerender()
    expect(result.current.selectedSeason).toBe('105')

    navigation.search = 'boss=Avatar&season=104&tab=trends'
    rerender()
    expect(result.current.selectedSeason).toBe('104')
  })

  it('keeps a return-to-current intent until earlier tab and season navigations settle', () => {
    const { result, rerender } = renderHook(() =>
      useMetaAtlasFiltersState(seasonFilters, null, tabOptions)
    )

    act(() => {
      result.current.setActiveTab('team-ideas')
      result.current.setSelectedSeason('105')
    })
    act(() => {
      result.current.setActiveTab('best-teams')
      result.current.setSelectedSeason('106')
    })

    expect(result.current.activeTab).toBe('best-teams')
    expect(result.current.selectedSeason).toBe('106')

    // The older navigation lands first; the latest intent must stay visible.
    navigation.search = 'season=105&tab=team-ideas'
    rerender()
    expect(result.current.activeTab).toBe('best-teams')
    expect(result.current.selectedSeason).toBe('106')
    expect(urlSync.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ season: '106', activeTab: 'best-teams' })
    )

    navigation.search = ''
    rerender()
    expect(result.current.activeTab).toBe('best-teams')
    expect(result.current.selectedSeason).toBe('106')

    navigation.search = 'season=105&tab=team-ideas'
    rerender()
    expect(result.current.activeTab).toBe('team-ideas')
    expect(result.current.selectedSeason).toBe('105')
  })

  it('uses the dashboard season as the omitted URL value when it differs from the data default', () => {
    const { result, rerender } = renderHook(() =>
      useMetaAtlasFiltersState(seasonFilters, '105', tabOptions)
    )

    expect(result.current.selectedSeason).toBe('105')

    act(() => result.current.setSelectedSeason('106'))
    expect(result.current.selectedSeason).toBe('106')
    expect(urlSync.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ season: '106', implicitSeason: '105' })
    )

    navigation.search = 'season=106'
    rerender()
    expect(result.current.selectedSeason).toBe('106')

    act(() => result.current.setSelectedSeason('105'))
    expect(urlSync.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ season: '105', implicitSeason: '105' })
    )

    navigation.search = ''
    rerender()
    expect(result.current.selectedSeason).toBe('105')
  })

  it('follows Back and Forward for every URL-backed filter after local intents settle', () => {
    const originalUrl = 'season=106&rarity=L1&teams=Admech&boss=Avatar&all=true'
    const updatedUrl = 'season=106&teams=Admech%2COrkz&boss=Screamer'
    navigation.search = originalUrl
    const { result, rerender } = renderHook(() =>
      useMetaAtlasFiltersState(seasonFilters, null, tabOptions)
    )

    expect(Array.from(result.current.selectedRaritySets)).toEqual(['L1'])
    expect(Array.from(result.current.selectedMetaTeams)).toEqual(['Admech'])
    expect(result.current.bossFilter).toBe('Avatar')
    expect(result.current.showAllBosses).toBe(true)

    act(() => {
      result.current.toggleRaritySet('M1')
      result.current.toggleMetaTeam('Orkz')
      result.current.setBossFilter('Screamer')
      result.current.toggleShowAllBosses()
    })

    expect(Array.from(result.current.selectedRaritySets).sort()).toEqual([
      'L1',
      'M1'
    ])
    expect(Array.from(result.current.selectedMetaTeams).sort()).toEqual([
      'Admech',
      'Orkz'
    ])
    expect(result.current.bossFilter).toBe('Screamer')
    expect(result.current.showAllBosses).toBe(false)

    navigation.search = updatedUrl
    rerender()

    navigation.search = originalUrl
    rerender()
    expect(Array.from(result.current.selectedRaritySets)).toEqual(['L1'])
    expect(Array.from(result.current.selectedMetaTeams)).toEqual(['Admech'])
    expect(result.current.bossFilter).toBe('Avatar')
    expect(result.current.debouncedBossFilter).toBe('Avatar')
    expect(result.current.showAllBosses).toBe(true)

    navigation.search = updatedUrl
    rerender()
    expect(Array.from(result.current.selectedRaritySets).sort()).toEqual([
      'L1',
      'M1'
    ])
    expect(Array.from(result.current.selectedMetaTeams).sort()).toEqual([
      'Admech',
      'Orkz'
    ])
    expect(result.current.bossFilter).toBe('Screamer')
    expect(result.current.showAllBosses).toBe(false)
  })

  it('keeps Clear visually empty while preserving no-filter URL and data semantics', () => {
    const { result, rerender } = renderHook(() =>
      useMetaAtlasFiltersState(seasonFilters, null, tabOptions)
    )

    expect(Array.from(result.current.selectedRaritySets)).toEqual(['L1', 'M1'])

    act(() => result.current.clearRaritySets())

    expect(result.current.selectedRaritySets.size).toBe(0)
    expect(urlSync.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ raritySets: new Set() })
    )

    // The canonical no-filter URL omits rarity; that must not re-select every chip.
    rerender()
    expect(result.current.selectedRaritySets.size).toBe(0)

    act(() => result.current.selectAllRaritySets())
    expect(Array.from(result.current.selectedRaritySets)).toEqual(['L1', 'M1'])

    navigation.search = 'rarity=L1'
    rerender()
    expect(Array.from(result.current.selectedRaritySets)).toEqual(['L1'])

    navigation.search = ''
    rerender()
    expect(Array.from(result.current.selectedRaritySets)).toEqual(['L1', 'M1'])
  })

  it('keeps a rapid Clear intent past an older explicit rarity replacement', () => {
    const { result, rerender } = renderHook(() =>
      useMetaAtlasFiltersState(seasonFilters, null, tabOptions)
    )

    act(() => result.current.toggleRaritySet('M1'))
    expect(Array.from(result.current.selectedRaritySets)).toEqual(['L1'])

    act(() => result.current.clearRaritySets())
    expect(result.current.selectedRaritySets.size).toBe(0)

    navigation.search = 'rarity=L1'
    rerender()
    expect(result.current.selectedRaritySets.size).toBe(0)

    navigation.search = ''
    rerender()
    expect(result.current.selectedRaritySets.size).toBe(0)

    navigation.search = 'rarity=M1'
    rerender()
    expect(Array.from(result.current.selectedRaritySets)).toEqual(['M1'])
  })

  it('falls back from a stale explicit season and asks URL sync to clean it', () => {
    navigation.search = 'season=999'
    const { result, rerender } = renderHook(
      ({ dashboardSeason }) =>
        useMetaAtlasFiltersState(seasonFilters, dashboardSeason, tabOptions),
      { initialProps: { dashboardSeason: '105' } }
    )

    expect(result.current.selectedSeason).toBe('105')
    expect(urlSync.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ season: '105', implicitSeason: '105' })
    )

    navigation.search = 'season=106'
    rerender({ dashboardSeason: '105' })
    expect(result.current.selectedSeason).toBe('106')

    navigation.search = ''
    rerender({ dashboardSeason: '999' })
    expect(result.current.selectedSeason).toBe('106')
  })

  it('removes the default tab and resolves retired or invalid ids', () => {
    navigation.search = 'season=106&tab=global'
    const { result, rerender } = renderHook(() =>
      useMetaAtlasFiltersState(null, null, tabOptions)
    )

    expect(result.current.activeTab).toBe('best-teams')

    navigation.search = 'season=106&tab=not-a-tab'
    rerender()
    expect(result.current.activeTab).toBe('best-teams')

    act(() => result.current.setActiveTab('best-teams'))
    expect(navigation.replace).not.toHaveBeenCalled()
    expect(urlSync.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeTab: 'best-teams',
        defaultTabId: 'best-teams'
      })
    )
  })
})
