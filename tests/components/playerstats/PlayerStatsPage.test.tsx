import { useState } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayerStatsPage } from '@/app/components/playerstats/PlayerStatsPage'

const mocks = vi.hoisted(() => ({
  controllerOptions: vi.fn(),
  displayRole: vi.fn()
}))

vi.mock('@/app/components/playerstats/hooks/usePlayerStatsController', () => ({
  usePlayerStatsController: (options: {
    initialSearch: string
    selectedGuild: string
    selectedSeason: string
    userRole: string
  }) => {
    mocks.controllerOptions(options)
    const { initialSearch, selectedGuild, selectedSeason } = options
    const [searchTerm, setSearchTerm] = useState(initialSearch)
    const [player, setPlayer] = useState(initialSearch)

    return {
      state: {
        searchTerm,
        selection: {
          player,
          season: selectedSeason,
          guild: selectedGuild
        },
        stats: {},
        tokens: null,
        supabaseError: null,
        status: 'idle',
        context: null,
        playerMapping: null,
        availablePlayers: ['Timmy', 'Other Officer']
      },
      setSearchTerm,
      selectPlayer: setPlayer,
      fetchPlayerStats: vi.fn(),
      clusterCode: 'EOT'
    }
  }
}))

vi.mock('@/app/lib/hooks/useGuildDisplayLabel', () => ({
  useGuildDisplayLabel: (guildCode: string) => guildCode
}))

vi.mock('@/app/lib/hooks/usePerformanceOptimized', () => ({
  usePlayerSearchOptimized: () => []
}))

vi.mock('@/app/components/PlayerBattleLog', () => ({ default: () => null }))
vi.mock('@/app/components/playerstats/PlayerStatsDisplay', () => ({
  PlayerStatsDisplay: ({ userRole }: { userRole: string }) => {
    mocks.displayRole(userRole)
    return null
  }
}))

const STATS_PROPS = {
  userGuild: 'EOT_GR',
  userGuildName: 'Example Alliance',
  userDisplayName: 'Timmy',
  clusterCode: 'EOT',
  selectedSeason: '106',
  enableSearch: true
}

afterEach(() => {
  cleanup()
  mocks.controllerOptions.mockClear()
  mocks.displayRole.mockClear()
})

describe('PlayerStatsPage lookup authorization', () => {
  it.each(['officer', 'Officer', 'leader', 'Leader'])(
    'keeps Player Lookup enabled for the supported %s role',
    (userRole) => {
      render(<PlayerStatsPage {...STATS_PROPS} userRole={userRole} />)

      expect(
        screen.getByRole('heading', { name: 'Player Search' })
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Select player')).toBeInTheDocument()
      expect(mocks.controllerOptions).toHaveBeenLastCalledWith(
        expect.objectContaining({ userRole: userRole.toLowerCase() })
      )
      expect(mocks.displayRole).toHaveBeenLastCalledWith(userRole.toLowerCase())
    }
  )

  it.each(['member', 'Member', 'demo'])(
    'does not grant Player Lookup to the %s role',
    (userRole) => {
      render(<PlayerStatsPage {...STATS_PROPS} userRole={userRole} />)

      expect(
        screen.queryByRole('heading', { name: 'Player Search' })
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: 'Player Statistics' })
      ).toBeInTheDocument()
    }
  )
})

describe('PlayerStatsPage selected-player mobile flow', () => {
  it('selects another player with the floating identity header mounted above content at Pixel 8a width', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 412
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 915
    })
    window.dispatchEvent(new Event('resize'))

    render(<PlayerStatsPage {...STATS_PROPS} userRole="Officer" />)

    fireEvent.change(screen.getByLabelText('Select player'), {
      target: { value: 'Other Officer' }
    })

    const header = screen.getByTestId('selected-player-header')
    expect(window.innerWidth).toBe(412)
    expect(header).toHaveAttribute('data-player-identity', 'Other Officer')
    expect(within(header).getByText('Other Officer')).toBeInTheDocument()
    // Before chrome measurement, CSS keeps the mobile 48px offset, not the 88px desktop fallback.
    expect(header).toHaveClass('sticky')
    expect(header).toHaveClass('top-12', 'lg:top-[88px]')
    expect(header.style.top).toBe('')

    const content = header.nextElementSibling
    expect(content).not.toBeNull()
    expect(
      header.compareDocumentPosition(content!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    fireEvent.click(
      within(header).getByRole('button', { name: 'Back to My Stats' })
    )
    expect(
      within(screen.getByTestId('selected-player-header')).getByText('Timmy')
    ).toBeInTheDocument()
  })
})
