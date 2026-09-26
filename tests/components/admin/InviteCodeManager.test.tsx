import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor
} from '@testing-library/react'
import { InviteCodeManager } from '@/app/(dashboard)/admin/feature-releases/InviteCodeManager'

const GUILD = {
  guild_code: 'G1',
  guild_name: 'Guild One',
  cluster_code: null,
  member_count: 5,
  accounts_count: 3
}

const RECENT_CODE = {
  id: 'code-1',
  code: 'ABC123',
  player_id: 'p1',
  display_name: 'Player One',
  guild_code: 'G1',
  created_at: '2026-08-01T00:00:00Z',
  expires_at: '2099-01-01T00:00:00Z',
  used_at: null,
  revoked_at: null
}

const REDACTED_CODE = {
  ...RECENT_CODE,
  id: 'code-2',
  code: null,
  used_at: '2026-08-02T00:00:00Z'
}

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body)
  } as Response)
}

describe('InviteCodeManager DataTable migration', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/admin/users/guilds')) {
          return jsonResponse({ guilds: [GUILD] })
        }
        if (url.includes('/api/admin/invite-codes/guild-members')) {
          return jsonResponse({ members: [] })
        }
        if (url.includes('/api/admin/invite-codes?guild_code=')) {
          return jsonResponse({ codes: [RECENT_CODE, REDACTED_CODE] })
        }
        if (url.includes('/api/admin/invite-codes')) {
          return jsonResponse({ codes: [] })
        }
        return jsonResponse({})
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the Recent Invite Codes table headers in order and the first row', async () => {
    render(<InviteCodeManager />)

    const guildDropdownToggle = await screen.findByRole('button', {
      name: /select a guild/i
    })
    fireEvent.click(guildDropdownToggle)

    const guildOption = await screen.findByText('Guild One')
    fireEvent.click(guildOption)

    await screen.findByText('Recent Invite Codes')

    await waitFor(() => {
      expect(screen.getAllByRole('columnheader').length).toBe(5)
    })

    const headerCells = screen.getAllByRole('columnheader')
    expect(headerCells.map((cell) => cell.textContent)).toEqual([
      'Code',
      'Player',
      'Status',
      'Created',
      ''
    ])

    const rows = screen.getAllByRole('row')
    const firstDataRow = rows[1]
    if (!firstDataRow) throw new Error('expected a data row')
    expect(within(firstDataRow).getByText('ABC123')).toBeInTheDocument()
    expect(within(firstDataRow).getByText('Player One')).toBeInTheDocument()
  })

  it('renders redacted historical codes without a copy control', async () => {
    render(<InviteCodeManager />)

    fireEvent.click(
      await screen.findByRole('button', { name: /select a guild/i })
    )
    fireEvent.click(await screen.findByText('Guild One'))

    const redacted = await screen.findByText('Redacted')
    const row = redacted.closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).queryByRole('button')).not.toBeInTheDocument()
    expect(within(row!).getByText('Used')).toBeInTheDocument()
  })
})
