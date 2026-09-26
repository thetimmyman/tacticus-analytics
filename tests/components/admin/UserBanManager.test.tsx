import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  BanUserDialog,
  BannedUsersTab,
  formatLocalDateTimeInputValue
} from '@/app/(dashboard)/admin/feature-releases/UserBanManager'
import type { UserResult } from '@/app/(dashboard)/admin/feature-releases/user-manager-shared'

const TARGET: UserResult = {
  id: 1,
  user_id: 'user-1',
  player_id: 'PLAYER-9',
  username: 'target',
  display_name: 'Target Player',
  email: 'target@example.com',
  guild_code: 'G1',
  cluster_code: null,
  role: 'member',
  is_app_admin: false,
  is_alpha_tester: false,
  is_beta_tester: false,
  discord_user_id: '123456789012345678',
  discord_username: 'target-discord',
  avatar_url: null,
  source: 'player_mapping'
}

describe('BanUserDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lets an admin choose the durable identifiers applied to a ban', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          bans: [{ id: 'ban-1' }, { id: 'ban-2' }, { id: 'ban-3' }],
          unresolved: []
        })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onBanned = vi.fn()

    render(
      <BanUserDialog target={TARGET} onClose={vi.fn()} onBanned={onBanned} />
    )

    expect(screen.getByLabelText(/Supabase user/)).toBeChecked()
    expect(screen.getByLabelText(/Email address/)).toBeChecked()
    expect(screen.getByLabelText(/Discord identity/)).toBeChecked()
    expect(screen.getByLabelText(/Tacticus player/)).toBeChecked()

    fireEvent.click(screen.getByLabelText(/Email address/))
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Repeated harassment' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ban user' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(String(init?.body))).toMatchObject({
      user_id: 'user-1',
      subject_types: ['user_id', 'discord_user_id', 'player_id'],
      reason: 'Repeated harassment'
    })
    expect(onBanned).toHaveBeenCalledWith(
      'Banned Target Player across 3 identifiers'
    )
  })

  it('disables identifiers the account does not have', () => {
    render(
      <BanUserDialog
        target={{
          ...TARGET,
          player_id: null,
          discord_user_id: null,
          discord_username: null
        }}
        onClose={vi.fn()}
        onBanned={vi.fn()}
      />
    )

    expect(screen.getByLabelText(/Discord identity/)).toBeDisabled()
    expect(screen.getByLabelText(/Tacticus player/)).toBeDisabled()
  })

  it('formats the expiry minimum as local wall-clock time', () => {
    expect(formatLocalDateTimeInputValue(new Date(2026, 7, 24, 13, 5))).toBe(
      '2026-08-24T13:05'
    )
  })
})

describe('BannedUsersTab', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads older history through the paginated ledger endpoint', async () => {
    const row = (id: string, group: string, reason: string) => ({
      id,
      ban_group_id: group,
      auth_user_id: 'user-1',
      subject_type: 'email',
      subject_value: `${id}@example.com`,
      reason,
      banned_by: 'admin-1',
      banned_at: '2026-08-24T12:00:00Z',
      expires_at: null,
      lifted_at: '2026-08-24T13:00:00Z',
      lifted_by: 'admin-1',
      lift_reason: 'Appeal accepted'
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            activeBans: [],
            historyBans: [row('old-1', 'group-1', 'First history page')],
            nextHistoryCursor: 'cursor-1',
            historyHasMore: true
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            activeBans: [],
            historyBans: [row('old-2', 'group-2', 'Second history page')],
            nextHistoryCursor: null,
            historyHasMore: false
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            activeBans: [],
            historyBans: [
              row('just-lifted', 'group-3', 'Lifted during pagination')
            ],
            nextHistoryCursor: 'refreshed-cursor',
            historyHasMore: true
          })
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<BannedUsersTab refreshToken={0} onLifted={vi.fn()} />)
    await screen.findByText('No active bans.')
    fireEvent.click(screen.getByRole('button', { name: 'Show history' }))
    expect(await screen.findByText('First history page')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load older history' }))
    expect(await screen.findByText('Second history page')).toBeInTheDocument()
    expect(
      await screen.findByText('Lifted during pagination')
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/admin/users/bans?history_limit=100&history_cursor=cursor-1'
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/admin/users/bans?history_limit=100'
    )
  })
})
