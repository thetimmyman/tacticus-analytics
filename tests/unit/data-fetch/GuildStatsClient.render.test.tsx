import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const useWarPlayersMock = vi.fn()

vi.mock('@/app/(dashboard)/wars/_hooks', () => ({
  useWarPlayers: (warId: string, side: string) => useWarPlayersMock(warId, side)
}))

vi.mock('@/app/(dashboard)/wars/_components/PlayerStatsTable', () => ({
  default: ({ players }: { players: unknown[] }) => (
    <div data-testid="player-stats-table">players:{players.length}</div>
  )
}))

const { default: WarPlayerStatsClient } =
  await import('@/app/(dashboard)/wars/_components/WarPlayerStatsClient')

function GuildStatsClient({ warId }: { warId: string }) {
  return <WarPlayerStatsClient warId={warId} side="guild" />
}

function makePlayer(points: number) {
  return {
    attacks: { points, total: 1, perfect: 0, winRate: 100 },
    defenses: { total: 0, conceded: 0, holdRate: 0 }
  }
}

afterEach(() => {
  useWarPlayersMock.mockReset()
})

describe('GuildStatsClient render-equivalence', () => {
  it('renders only the bare red error div on error', () => {
    useWarPlayersMock.mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error('x')
    })
    const { container, getByText } = render(<GuildStatsClient warId="w1" />)

    const errorCopy = getByText(
      'Failed to load guild player stats. Please try refreshing the page.'
    )
    expect(errorCopy.className).toContain('text-red-400')
    expect(
      container.querySelector('[data-testid="player-stats-table"]')
    ).toBeNull()
    expect(container.textContent).not.toContain('Guild Player Stats')
  })

  it('renders the summary + table skeletons inside a space-y-6 wrapper when loading', () => {
    useWarPlayersMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null
    })
    const { container } = render(<GuildStatsClient warId="w1" />)

    expect(container.querySelector('.space-y-6')).not.toBeNull()
    expect(
      container.querySelector('[data-testid="player-stats-table"]')
    ).toBeNull()
    expect(container.textContent).not.toContain('Guild Player Stats')
  })

  it('renders GuildSummaryCard with the computed total score + the player table on data', () => {
    useWarPlayersMock.mockReturnValue({
      data: [makePlayer(100), makePlayer(250)],
      isLoading: false,
      error: null
    })
    const { getByText, getByTestId } = render(<GuildStatsClient warId="w1" />)

    expect(getByText('Guild Stats')).toBeTruthy()
    expect(getByText('Guild Player Stats')).toBeTruthy()
    expect(getByText(/Official score 350/)).toBeTruthy()
    expect(getByTestId('player-stats-table').textContent).toBe('players:2')
  })
})
