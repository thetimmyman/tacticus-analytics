import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ activeTab: 'best-teams' }))
const mocks = vi.hoisted(() => ({
  useRosterContext: vi.fn(),
  useMetaAtlasPersonalization: vi.fn(),
  useMetaAtlasRecommendations: vi.fn(),
  useRosterRoi: vi.fn()
}))

vi.mock('@tacticus/ui-kit', async () => {
  const React = await import('react')
  type TestTab = { id: string; label: string; content: ReactNode }
  return {
    Card: ({ children }: { children: ReactNode }) =>
      React.createElement('div', null, children),
    CardContent: ({ children }: { children: ReactNode }) =>
      React.createElement('div', null, children),
    Tabs: ({
      tabs,
      value,
      onChange
    }: {
      tabs: TestTab[]
      value: string
      onChange: (id: string) => void
    }) =>
      React.createElement(
        'div',
        null,
        tabs.map((tab) =>
          React.createElement(
            'button',
            { key: tab.id, type: 'button', onClick: () => onChange(tab.id) },
            tab.label
          )
        ),
        tabs.find((tab) => tab.id === value)?.content
      )
  }
})

vi.mock('@/app/components/error/DataErrorBoundary', () => ({
  DataErrorBoundary: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@/app/components/release/ReleaseStageBadge', () => ({
  ReleaseStageBadge: () => null
}))

vi.mock('@/app/lib/hooks/shared', () => ({
  useBossData: () => ({ bosses: [] })
}))

vi.mock('@/app/(dashboard)/meta-atlas/hooks/useMetaFilters', () => ({
  useMetaFilters: () => ({
    filters: {
      current_season: '106',
      previous_season: '105',
      seasons: ['106'],
      rarity_sets: ['L1']
    },
    loading: false
  })
}))

vi.mock('@/app/(dashboard)/meta-atlas/hooks/useBossResolution', () => ({
  useBossResolution: () => ({ resolveBoss: vi.fn() })
}))

vi.mock('@/app/(dashboard)/meta-atlas/hooks/useMetaAtlasFiltersState', () => ({
  useMetaAtlasFiltersState: () => ({
    selectedSeason: '106',
    availableSeasons: ['106'],
    availableRaritySets: ['L1'],
    selectedRaritySets: new Set(['L1']),
    selectedMetaTeams: new Set<string>(),
    bossFilter: '',
    debouncedBossFilter: '',
    showAllBosses: false,
    setSelectedSeason: vi.fn(),
    setBossFilter: vi.fn(),
    toggleShowAllBosses: vi.fn(),
    toggleRaritySet: vi.fn(),
    selectAllRaritySets: vi.fn(),
    clearRaritySets: vi.fn(),
    toggleMetaTeam: vi.fn(),
    clearMetaTeams: vi.fn(),
    activeTab: state.activeTab,
    setActiveTab: (tabId: string) => {
      state.activeTab = tabId
    }
  })
}))

vi.mock('@/app/(dashboard)/meta-atlas/hooks/useRosterContext', () => ({
  useRosterContext: mocks.useRosterContext
}))

vi.mock(
  '@/app/(dashboard)/meta-atlas/hooks/useMetaAtlasPersonalization',
  () => ({ useMetaAtlasPersonalization: mocks.useMetaAtlasPersonalization })
)

vi.mock(
  '@/app/(dashboard)/meta-atlas/hooks/useMetaAtlasRecommendations',
  () => ({ useMetaAtlasRecommendations: mocks.useMetaAtlasRecommendations })
)

vi.mock('@/app/(dashboard)/meta-atlas/hooks/useRosterRoi', () => ({
  useRosterRoi: mocks.useRosterRoi
}))

vi.mock('@/app/(dashboard)/meta-atlas/components/BestTeamsTab', async () => {
  const React = await import('react')
  return {
    BestTeamsTab: ({
      density,
      onDensityChange
    }: {
      density: 'compact' | 'detailed'
      onDensityChange: (density: 'compact' | 'detailed') => void
    }) =>
      React.createElement(
        'div',
        null,
        React.createElement(
          'button',
          { type: 'button', onClick: () => onDensityChange('compact') },
          `Compact (${density})`
        ),
        React.createElement(
          'button',
          { type: 'button', onClick: () => onDensityChange('detailed') },
          'Detailed'
        )
      )
  }
})

vi.mock('@/app/(dashboard)/meta-atlas/components/MetaAtlasTeamsTab', () => ({
  MetaAtlasTeamsTab: () => <div>Team ideas</div>
}))
vi.mock('@/app/(dashboard)/meta-atlas/components/MetaTrends', () => ({
  MetaTrends: () => <div>Trends</div>
}))
vi.mock(
  '@/app/(dashboard)/meta-atlas/components/PersonalBenchmarksSection',
  () => ({ PersonalBenchmarksSection: () => <div>Gaps</div> })
)
vi.mock('@/app/(dashboard)/meta-atlas/components/MyGuildTab', () => ({
  default: () => <div>Guild</div>
}))
vi.mock('@/app/(dashboard)/meta-atlas/components/MetaScopeLinks', () => ({
  ContextualMetaScopeLinks: () => null
}))

import { MetaAtlasClient } from '@/app/(dashboard)/meta-atlas/MetaAtlasClient'

describe('MetaAtlasClient personalization query gates', () => {
  beforeEach(() => {
    state.activeTab = 'best-teams'
    mocks.useRosterContext.mockReset().mockReturnValue({
      heroMappings: new Map(),
      rosterEntries: [],
      rosterNames: [],
      rosterSignature: '',
      rosterQuery: { error: null, isLoading: false },
      hasRoster: false,
      abilityNotice: null
    })
    mocks.useMetaAtlasPersonalization.mockReset().mockReturnValue({
      currentTeams: [],
      currentTeamsLookup: {},
      currentTeamsLoading: false,
      personalizedPayload: undefined
    })
    mocks.useMetaAtlasRecommendations.mockReset().mockReturnValue({
      displayBosses: [],
      groupedByRaritySet: [],
      recsLoading: false,
      availableMetaTeams: []
    })
    mocks.useRosterRoi.mockReset().mockReturnValue({
      data: { results: [] },
      isLoading: false
    })
  })

  it('keeps both Best Teams densities global and enables private queries only for Team Ideas', () => {
    const { rerender } = render(<MetaAtlasClient guildCode="" />)

    expect(mocks.useRosterContext).toHaveBeenLastCalledWith({
      rosterEnabled: false
    })
    expect(
      mocks.useMetaAtlasPersonalization.mock.calls.at(-1)?.[0].enabled
    ).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Detailed' }))
    expect(mocks.useRosterContext).toHaveBeenLastCalledWith({
      rosterEnabled: false
    })
    expect(
      mocks.useMetaAtlasPersonalization.mock.calls.at(-1)?.[0].enabled
    ).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /Compact/ }))
    expect(mocks.useRosterContext).toHaveBeenLastCalledWith({
      rosterEnabled: false
    })

    fireEvent.click(screen.getByRole('button', { name: 'Team Ideas For You' }))
    rerender(<MetaAtlasClient guildCode="" />)
    expect(mocks.useRosterContext).toHaveBeenLastCalledWith({
      rosterEnabled: true
    })
    expect(
      mocks.useMetaAtlasPersonalization.mock.calls.at(-1)?.[0].enabled
    ).toBe(true)
  })

  it('waits for roster availability before allowing Team Ideas to reuse global recommendations', () => {
    state.activeTab = 'team-ideas'
    mocks.useRosterContext.mockReturnValue({
      heroMappings: new Map(),
      rosterEntries: [],
      rosterNames: [],
      rosterSignature: '',
      rosterQuery: { error: null, isLoading: true },
      hasRoster: false,
      abilityNotice: null
    })

    const { rerender } = render(<MetaAtlasClient guildCode="" />)

    expect(mocks.useMetaAtlasRecommendations.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        enabled: true,
        personalizedPayload: undefined,
        requirePersonalized: true
      })
    )

    mocks.useRosterContext.mockReturnValue({
      heroMappings: new Map(),
      rosterEntries: [],
      rosterNames: [],
      rosterSignature: '',
      rosterQuery: { error: null, isLoading: false },
      hasRoster: false,
      abilityNotice: null
    })
    rerender(<MetaAtlasClient guildCode="" />)

    expect(mocks.useMetaAtlasRecommendations.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        enabled: true,
        personalizedPayload: undefined,
        requirePersonalized: false
      })
    )
  })
})
