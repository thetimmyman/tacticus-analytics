import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({
  search: '',
  replace: vi.fn()
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/meta-atlas',
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search)
}))

import { useMetaUrlSync } from '@/app/lib/hooks/useMetaUrlSync'

const baseState = {
  raritySets: new Set<string>(),
  metaTeams: new Set<string>(),
  bossFilter: '',
  showAllBosses: false
}

describe('useMetaUrlSync', () => {
  beforeEach(() => {
    navigation.search = ''
    navigation.replace.mockReset()
  })

  it('preserves an equal-size rarity selection outside the current universe', async () => {
    navigation.search = 'season=106'
    renderHook(() =>
      useMetaUrlSync({
        ...baseState,
        raritySets: new Set(['M5']),
        allRaritySets: ['L5']
      })
    )

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled())
    const [url] = navigation.replace.mock.calls.at(-1) ?? []
    const parsed = new URL(String(url), 'https://example.test')
    expect(parsed.searchParams.get('season')).toBe('106')
    expect(parsed.searchParams.get('rarity')).toBe('M5')
  })

  it('omits rarity only when the selected set exactly matches the universe', async () => {
    navigation.search = 'season=106&rarity=L5'
    renderHook(() =>
      useMetaUrlSync({
        ...baseState,
        raritySets: new Set(['L5']),
        allRaritySets: ['L5']
      })
    )

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled())
    const [url] = navigation.replace.mock.calls.at(-1) ?? []
    const parsed = new URL(String(url), 'https://example.test')
    expect(parsed.searchParams.get('season')).toBe('106')
    expect(parsed.searchParams.has('rarity')).toBe(false)
  })

  it('combines a pending season with tab and existing filter state', async () => {
    navigation.search = 'boss=Avatar'
    renderHook(() =>
      useMetaUrlSync({
        ...baseState,
        bossFilter: 'Avatar',
        season: '105',
        implicitSeason: '106',
        activeTab: 'trends',
        defaultTabId: 'best-teams'
      })
    )

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled())
    const [url] = navigation.replace.mock.calls.at(-1) ?? []
    const parsed = new URL(String(url), 'https://example.test')
    expect(parsed.searchParams.get('boss')).toBe('Avatar')
    expect(parsed.searchParams.get('season')).toBe('105')
    expect(parsed.searchParams.get('tab')).toBe('trends')
  })

  it('keeps the data default explicit when the dashboard season is implicit', async () => {
    renderHook(() =>
      useMetaUrlSync({
        ...baseState,
        season: '106',
        implicitSeason: '105'
      })
    )

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled())
    const [url] = navigation.replace.mock.calls.at(-1) ?? []
    const parsed = new URL(String(url), 'https://example.test')
    expect(parsed.searchParams.get('season')).toBe('106')
  })

  it('removes an invalid explicit season when state falls back to the implicit season', async () => {
    navigation.search = 'season=999'
    renderHook(() =>
      useMetaUrlSync({
        ...baseState,
        season: '105',
        implicitSeason: '105'
      })
    )

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenLastCalledWith('/meta-atlas', {
        scroll: false
      })
    )
  })

  it('reissues the latest URL when an older navigation lands late', async () => {
    const { rerender } = renderHook(
      ({ activeTab }) =>
        useMetaUrlSync({
          ...baseState,
          activeTab,
          defaultTabId: 'best-teams'
        }),
      { initialProps: { activeTab: 'team-ideas' } }
    )

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenLastCalledWith(
        '/meta-atlas?tab=team-ideas',
        { scroll: false }
      )
    )

    rerender({ activeTab: 'best-teams' })
    expect(navigation.replace).toHaveBeenCalledTimes(1)

    navigation.search = 'tab=team-ideas'
    rerender({ activeTab: 'best-teams' })

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenLastCalledWith('/meta-atlas', {
        scroll: false
      })
    )
    expect(navigation.replace).toHaveBeenCalledTimes(2)
  })
})
