// Players without a projection sort last and must not crash render.

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import PlayerTokenChart from '@/app/components/token-usage/PlayerTokenChart'
import type {
  PlayerTokens,
  SortOption
} from '@/app/components/token-usage/types'
import type { SeasonForecastPlayerRow } from '@/app/lib/season-forecast/forecast-service'

function makePlayer(overrides: Partial<PlayerTokens> = {}): PlayerTokens {
  return {
    userId: 'p1',
    displayName: 'Alpha',
    totalTokens: 10,
    bossTokens: 5,
    primeTokens: 5,
    avgTokensPerLoop: 2,
    efficiency: 1000,
    tokensByRarity: {
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 5,
      legendary: 5,
      mythic: 0
    },
    ...overrides
  }
}

function makeProjection(
  overrides: Partial<SeasonForecastPlayerRow> = {}
): SeasonForecastPlayerRow {
  return {
    player_id: 'p1',
    display_name: 'Alpha',
    tokens_now: 2,
    next_token_seconds: 3600,
    tokens_will_regen: 4,
    tokens_at_season_end: 6,
    will_cap: false,
    estimated_cap_waste: 0,
    ...overrides
  }
}

describe('PlayerTokenChart — projection sort + overlay', () => {
  it('hides projectedBySeasonEnd option when showForecast is false', () => {
    render(
      <PlayerTokenChart
        players={[makePlayer()]}
        sortBy={'total' satisfies SortOption}
        onSortChange={() => undefined}
      />
    )
    const select = screen.getByLabelText(
      /sort players by/i
    ) as HTMLSelectElement
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).not.toContain('projectedBySeasonEnd')
  })

  it('exposes projectedBySeasonEnd option when showForecast is true', () => {
    render(
      <PlayerTokenChart
        players={[makePlayer()]}
        sortBy={'total' satisfies SortOption}
        onSortChange={() => undefined}
        showForecast
      />
    )
    const select = screen.getByLabelText(
      /sort players by/i
    ) as HTMLSelectElement
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toContain('projectedBySeasonEnd')
  })

  it('sorts bars by tokens_at_season_end desc when projection sort is active', () => {
    const players: PlayerTokens[] = [
      makePlayer({
        userId: 'p1',
        displayName: 'Alpha',
        projection: makeProjection({
          player_id: 'p1',
          tokens_at_season_end: 1
        })
      }),
      makePlayer({
        userId: 'p2',
        displayName: 'Beta',
        projection: makeProjection({
          player_id: 'p2',
          tokens_at_season_end: 5
        })
      }),
      makePlayer({
        userId: 'p3',
        displayName: 'Gamma',
        projection: makeProjection({
          player_id: 'p3',
          tokens_at_season_end: 3
        })
      })
    ]

    const { container } = render(
      <PlayerTokenChart
        players={players}
        sortBy={'projectedBySeasonEnd' satisfies SortOption}
        onSortChange={() => undefined}
        showForecast
      />
    )

    const labels = Array.from(
      container.querySelectorAll('div.font-medium')
    ).map((el) => (el.textContent ?? '').trim())

    expect(labels.slice(0, 3)).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  it('renders per-bar overlay "n (+m)" when projection sort is active', () => {
    const players: PlayerTokens[] = [
      makePlayer({
        userId: 'p1',
        displayName: 'Alpha',
        projection: makeProjection({
          player_id: 'p1',
          tokens_at_season_end: 6,
          tokens_will_regen: 4
        })
      })
    ]

    render(
      <PlayerTokenChart
        players={players}
        sortBy={'projectedBySeasonEnd' satisfies SortOption}
        onSortChange={() => undefined}
        showForecast
      />
    )

    expect(screen.getByText('6 (+4)')).toBeInTheDocument()
  })

  it('does NOT render overlay when projection sort is inactive', () => {
    const players: PlayerTokens[] = [
      makePlayer({
        userId: 'p1',
        displayName: 'Alpha',
        projection: makeProjection({
          player_id: 'p1',
          tokens_at_season_end: 6,
          tokens_will_regen: 4
        })
      })
    ]

    render(
      <PlayerTokenChart
        players={players}
        sortBy={'total' satisfies SortOption}
        onSortChange={() => undefined}
        showForecast
      />
    )

    expect(screen.queryByText('6 (+4)')).not.toBeInTheDocument()
  })

  it('cap-bound players get warning-color overlay', () => {
    const players: PlayerTokens[] = [
      makePlayer({
        userId: 'p1',
        displayName: 'Alpha',
        projection: makeProjection({
          player_id: 'p1',
          tokens_at_season_end: 3,
          tokens_will_regen: 1,
          will_cap: true,
          estimated_cap_waste: 4
        })
      })
    ]

    const { container } = render(
      <PlayerTokenChart
        players={players}
        sortBy={'projectedBySeasonEnd' satisfies SortOption}
        onSortChange={() => undefined}
        showForecast
      />
    )

    const overlay = within(container).getByText('3 (+1)')
    expect(overlay.className).toContain('text-(--warning)')
  })

  it('players without a projection sort to the end without crashing', () => {
    const players: PlayerTokens[] = [
      makePlayer({
        userId: 'p1',
        displayName: 'NoProj',
        projection: null
      }),
      makePlayer({
        userId: 'p2',
        displayName: 'WithProj',
        projection: makeProjection({
          player_id: 'p2',
          tokens_at_season_end: 5
        })
      })
    ]

    const { container } = render(
      <PlayerTokenChart
        players={players}
        sortBy={'projectedBySeasonEnd' satisfies SortOption}
        onSortChange={() => undefined}
        showForecast
      />
    )

    const labels = Array.from(
      container.querySelectorAll('div.font-medium')
    ).map((el) => (el.textContent ?? '').trim())
    expect(labels.slice(0, 2)).toEqual(['WithPr..', 'NoProj'])
  })
})

describe('PlayerTokenChart — base sort + metadata', () => {
  const makeBasePlayer = (overrides: Partial<PlayerTokens>): PlayerTokens =>
    ({
      userId: 'player',
      displayName: 'Player',
      totalTokens: 0,
      bossTokens: 0,
      primeTokens: 0,
      avgTokensPerLoop: 0,
      efficiency: 0,
      tokensByRarity: {
        common: 0,
        uncommon: 0,
        rare: 0,
        epic: 0,
        legendary: 0,
        mythic: 0
      },
      ...overrides
    }) as PlayerTokens

  it('sorts by total tokens and renders metadata', () => {
    const players = [
      makeBasePlayer({
        userId: 'alpha',
        displayName: 'Alpha',
        totalTokens: 10,
        tokensAvailable: 5,
        bombsAvailable: 1,
        burnedTokensUsage: 2,
        historicalAvg: 5,
        tokensByRarity: {
          common: 2,
          uncommon: 0,
          rare: 8,
          epic: 0,
          legendary: 0,
          mythic: 0
        }
      } as Partial<PlayerTokens>),
      makeBasePlayer({
        userId: 'bravo',
        displayName: 'Bravo',
        totalTokens: 4,
        tokensAvailable: -1,
        bombsAvailable: 0,
        tokensByRarity: {
          common: 0,
          uncommon: 0,
          rare: 0,
          epic: 4,
          legendary: 0,
          mythic: 0
        }
      } as Partial<PlayerTokens>)
    ]

    const { container } = render(
      <PlayerTokenChart
        players={players}
        sortBy={'total' satisfies SortOption}
        onSortChange={vi.fn()}
      />
    )

    const names = screen
      .getAllByText(/Alpha|Bravo/)
      .map((node) => node.textContent)
    expect(names).toEqual(['Alpha', 'Bravo'])

    expect(screen.getByText('5-vet')).toBeInTheDocument()
    expect(screen.getByText('placeholder')).toBeInTheDocument()
    expect(screen.getByText('Avail: 3')).toBeInTheDocument()
    expect(screen.getByText('Avail: 0')).toBeInTheDocument()
    expect(screen.getByText('Bombs: 1')).toBeInTheDocument()
    expect(screen.getByText('Bombs: 0')).toBeInTheDocument()
    expect(screen.getByText('Behind pace: 2')).toBeInTheDocument()
    expect(screen.getAllByText(/Behind pace:/)).toHaveLength(1)

    expect(container.querySelector('[title="common: 2"]')).not.toBeNull()
    expect(container.querySelector('[title="rare: 8"]')).not.toBeNull()
    expect(container.querySelector('[title="epic: 4"]')).not.toBeNull()
  })

  it('sorts by historical average and notifies on sort change', () => {
    const onSortChange = vi.fn()
    const players = [
      makeBasePlayer({
        userId: 'alpha',
        displayName: 'Alpha',
        totalTokens: 12,
        historicalAvg: undefined
      } as Partial<PlayerTokens>),
      makeBasePlayer({
        userId: 'bravo',
        displayName: 'Bravo',
        totalTokens: 6,
        historicalAvg: 8
      } as Partial<PlayerTokens>)
    ]

    render(
      <PlayerTokenChart
        players={players}
        sortBy={'historical' satisfies SortOption}
        onSortChange={onSortChange}
      />
    )

    const names = screen
      .getAllByText(/Alpha|Bravo/)
      .map((node) => node.textContent)
    expect(names).toEqual(['Bravo', 'Alpha'])

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'efficiency' }
    })
    expect(onSortChange).toHaveBeenCalledWith('efficiency')
  })
})
