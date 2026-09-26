import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/tests/utils/render'
import WarRoomClient from './WarRoomClient'
import type { MetaTeam } from './types'

const mockUseWarRoom = vi.hoisted(() => vi.fn())
const mockUseHeroCatalog = vi.hoisted(() => vi.fn())

vi.mock('./hooks/useWarRoom', () => ({
  useWarRoom: mockUseWarRoom
}))

vi.mock('@/app/lib/catalogs', () => ({
  useHeroCatalog: mockUseHeroCatalog
}))

vi.mock('./MetaTeamTable', () => ({
  default: ({
    teams,
    onDelete
  }: {
    teams: MetaTeam[]
    onDelete: (team: MetaTeam) => void
  }) => (
    <div>
      {teams.map((team) => (
        <button key={team.id} type="button" onClick={() => onDelete(team)}>
          Delete {team.name}
        </button>
      ))}
    </div>
  )
}))

vi.mock('./TeamFormDialog', () => ({
  default: () => null
}))

const team: MetaTeam = {
  id: '10000000-0000-4000-8000-000000000001',
  guild_code: 'TEST',
  name: 'Ork swarm',
  side: 'offense',
  priority: null,
  notes: null,
  heroes: [{ unitId: 'alpha', role: 'core' }],
  created_at: '2026-09-25T00:00:00.000Z',
  updated_at: '2026-09-25T00:00:00.000Z'
}

describe('WarRoomClient', () => {
  beforeEach(() => {
    mockUseWarRoom.mockReturnValue({
      data: {
        guildCode: 'TEST',
        ownGuildCode: 'TEST',
        isOwnGuild: true,
        guilds: [{ guildCode: 'TEST', label: 'TEST', teamCount: 1 }],
        teams: [team]
      },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    })
    mockUseHeroCatalog.mockReturnValue({ data: undefined })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('hides edit controls and analytics when browsing another guild', () => {
    mockUseWarRoom.mockReturnValue({
      data: {
        guildCode: 'OTHER',
        ownGuildCode: 'TEST',
        isOwnGuild: false,
        guilds: [
          { guildCode: 'TEST', label: 'TEST', teamCount: 0 },
          { guildCode: 'OTHER', label: 'OTHER', teamCount: 1 }
        ],
        minRankIndex: 9,
        teams: [team],
        readiness: [],
        usage: [],
        myUsage: []
      },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    })

    renderWithProviders(<WarRoomClient canEdit />)

    expect(screen.queryByRole('button', { name: /New team/ })).toBeNull()
    expect(screen.queryByText('Analytics')).toBeNull()
    expect(screen.getByText(/read-only/)).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Guild' })).toBeTruthy()
  })

  it('surfaces a DELETE transport failure in the existing error state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network is offline'))
    )
    const user = userEvent.setup()

    renderWithProviders(<WarRoomClient canEdit />)
    await user.click(screen.getByRole('button', { name: 'Delete Ork swarm' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'network is offline'
    )
  })
})
