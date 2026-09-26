import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useMetaAtlasRecommendations } from '@/app/(dashboard)/meta-atlas/hooks/useMetaAtlasRecommendations'
import type {
  BossData,
  CurrentSeasonBoss,
  MetaFilters
} from '@/app/(dashboard)/meta-atlas/types'

const avatar: CurrentSeasonBoss = {
  boss_type: 'avatar',
  boss_name: 'Avatar'
}

const filters: MetaFilters = {
  bosses: ['avatar'],
  current_season_bosses: [avatar],
  rarity_sets: ['L1'],
  rarity_sets_by_season: { '106': ['L1'] },
  seasons: ['106'],
  meta_teams: ['Admech'],
  current_season: '106',
  previous_season: '105',
  season_number: 106
}

const cachedGlobalData = new Map<string, BossData>([
  [
    'L1|avatar|0',
    {
      boss_type: 'avatar',
      boss_name: 'Avatar',
      boss_lookup_name: 'avatar',
      rarity_set: 'L1',
      encounter_index: 0,
      recommendations: [
        {
          team_hash: 'global-team',
          team_composition: 'Hero One, Hero Two, Hero Three',
          meta_team: 'Admech',
          rarity_set: 'L1',
          sub_boss_name: null,
          encounter_index: 0,
          damage_p90: 100,
          damage_p75: 90,
          damage_max: 120,
          damage_avg: 80,
          attack_count: 100,
          season: '106'
        }
      ],
      loading: false,
      error: null
    }
  ]
])

describe('useMetaAtlasRecommendations personalization cache isolation', () => {
  it('hides cached global chips and rows while Team Ideas waits for its private key', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    const globalKey = [
      'bossRecommendationsBatch',
      'avatar',
      '106',
      10,
      20,
      'global'
    ]
    queryClient.setQueryData(globalKey, cachedGlobalData)

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result, rerender } = renderHook(
      ({ requirePersonalized }) =>
        useMetaAtlasRecommendations({
          filters,
          showAllBosses: false,
          bossFilter: '',
          resolveBoss: (bossType, bossName) => ({
            boss_type: bossType,
            boss_name: bossName || bossType
          }),
          selectedRaritySets: new Set(['L1']),
          selectedMetaTeams: new Set<string>(),
          currentSeason: '106',
          requirePersonalized,
          enabled: true
        }),
      { initialProps: { requirePersonalized: false }, wrapper }
    )

    expect(result.current.availableMetaTeams).toEqual(['Admech'])
    expect(result.current.groupedByRaritySet).toHaveLength(1)

    rerender({ requirePersonalized: true })

    expect(result.current.recsLoading).toBe(true)
    expect(result.current.availableMetaTeams).toEqual([])
    expect(result.current.groupedByRaritySet).toEqual([])
    expect(queryClient.getQueryData(globalKey)).toBe(cachedGlobalData)
  })
})
