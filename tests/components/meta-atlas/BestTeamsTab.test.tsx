import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/components/error/DataErrorBoundary', () => ({
  DataErrorBoundary: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('@/app/(dashboard)/meta-atlas/components/TopTeamsTab', () => ({
  TopTeamsTab: () => <div>Compact teams</div>
}))

vi.mock('@/app/(dashboard)/meta-atlas/components/MetaAtlasTeamsTab', () => ({
  MetaAtlasTeamsTab: () => <div>Detailed teams</div>
}))

import { BestTeamsTab } from '@/app/(dashboard)/meta-atlas/components/BestTeamsTab'

const onDensityChange = vi.fn()

const baseProps = {
  density: 'compact' as const,
  onDensityChange,
  filters: null,
  filtersLoading: false,
  recsLoading: false,
  heroMappings: new Map(),
  groupedByRaritySet: [],
  displayBossCount: 0,
  availableMetaTeams: [],
  availableRaritySets: [],
  bossFilter: '',
  onBossFilterChange: vi.fn(),
  showAllBosses: false,
  onToggleShowAll: vi.fn(),
  selectedRaritySets: new Set<string>(),
  onToggleRaritySet: vi.fn(),
  onSelectAllRaritySets: vi.fn(),
  onClearRaritySets: vi.fn(),
  selectedMetaTeams: new Set<string>(),
  onToggleMetaTeam: vi.fn(),
  onClearMetaTeams: vi.fn(),
  currentSeason: '106'
}

describe('BestTeamsTab', () => {
  beforeEach(() => onDensityChange.mockReset())

  it('uses a controlled, accessible density toggle with 44px targets', () => {
    const { rerender } = render(<BestTeamsTab {...baseProps} />)

    const compact = screen.getByRole('button', { name: 'Compact' })
    const detailed = screen.getByRole('button', { name: 'Detailed' })
    expect(compact.getAttribute('aria-pressed')).toBe('true')
    expect(detailed.getAttribute('aria-pressed')).toBe('false')
    expect(compact.className).toContain('min-h-11')
    expect(detailed.className).toContain('min-h-11')
    expect(screen.getByText('Compact teams')).toBeTruthy()

    fireEvent.click(detailed)
    expect(onDensityChange).toHaveBeenCalledWith('detailed')

    rerender(<BestTeamsTab {...baseProps} density="detailed" />)
    expect(detailed.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Detailed teams')).toBeTruthy()
  })
})
