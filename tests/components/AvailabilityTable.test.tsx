import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AvailabilityTable } from '@/app/components/gr-availability/AvailabilityTable'
import type { PlayerAvailability } from '@/app/components/gr-availability/types'

vi.mock('@/app/components/ui/PlayerLink', () => ({
  PlayerLink: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

const rows: PlayerAvailability[] = [
  {
    player_id: 'alpha',
    display_name: 'Alpha',
    tokens_available: 1,
    bombs_available: 1,
    token_state: 'regenerating',
    data_source: 'calculated',
    has_api_key: false,
    token_cooldown: '2h',
    bomb_cooldown: null,
    last_sync_at: null,
    last_battle_time: '2026-08-01T00:00:00.000Z',
    battles_with_damage: 2
  },
  {
    player_id: 'beta',
    display_name: 'Beta',
    tokens_available: 3,
    bombs_available: 0,
    token_state: 'capped',
    data_source: 'calculated',
    has_api_key: false,
    token_cooldown: null,
    bomb_cooldown: '3h',
    last_sync_at: null,
    last_battle_time: '2026-08-02T00:00:00.000Z',
    battles_with_damage: 8
  }
]

function firstPlayer(): string {
  const firstRow = within(screen.getAllByRole('rowgroup')[1]!).getAllByRole(
    'row'
  )[0]!
  return within(firstRow).getAllByRole('cell')[0]?.textContent ?? ''
}

describe('AvailabilityTable DataTable migration', () => {
  it('preserves the dense mobile header and default token ordering', () => {
    render(<AvailabilityTable sortedPlayers={rows} hasMounted={false} />)

    const activeHeader = screen.getByRole('button', {
      name: 'Sort Tkn ascending'
    })
    expect(activeHeader.className).toContain('text-[9px]')
    expect(firstPlayer()).toContain('Beta')
  })

  it('sorts every header through explicit scalar accessors', async () => {
    const user = userEvent.setup()
    render(<AvailabilityTable sortedPlayers={rows} hasMounted={false} />)

    const descendingFirst = [
      ['Player', 'Beta'],
      ['Tkn', 'Beta'],
      ['Next', 'Alpha'],
      ['Bmb', 'Alpha'],
      ['Next Bomb', 'Beta'],
      ['Last Battle', 'Beta'],
      ['Btl', 'Beta']
    ] as const

    for (const [header, first] of descendingFirst) {
      const button = screen.getByRole('button', {
        name: new RegExp(`^Sort (?:by )?${header}(?: ascending| descending)?$`)
      })
      if (button.getAttribute('aria-label')?.endsWith('ascending')) {
        await user.click(button)
        await user.click(button)
      } else {
        await user.click(button)
      }
      expect(firstPlayer()).toContain(first)
    }
  })
})
