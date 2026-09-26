import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeaderSeatClaim } from '@/app/(public)/onboarding/dashboard/LeaderSeatClaim'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}))

const rpc = vi.fn()
let sessionUser: { id: string } | null = null

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser } }) },
    rpc: (...args: unknown[]) => rpc(...args)
  })
}))

const fetchMock = vi.fn()

describe('LeaderSeatClaim — the Player-only API key contract', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    rpc.mockReset()
    sessionUser = null
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks the first registrar for Player access only', () => {
    render(<LeaderSeatClaim guildName="Claim Test Guild" />)

    expect(screen.getByLabelText('Player API key')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /api\.tacticusgame\.com/i })
    ).toBeTruthy()

    const card = screen.getByLabelText('Player API key')
      .parentElement as HTMLElement
    expect(card.textContent).toContain('Player')
    expect(card.textContent).toContain('No invite code is needed')
    expect(card.textContent).not.toContain('Guild Raid')
    expect(card.textContent).not.toContain('Guild and Player')
  })

  it("shows the server's scope message instead of the generic fallback", async () => {
    const serverMessage =
      'We could not read your player profile with that key. Confirm it has Player read access.'
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: 'PLAYER_SCOPE_REQUIRED', message: serverMessage }
      })
    })

    const user = userEvent.setup()
    render(<LeaderSeatClaim guildName="Claim Test Guild" />)

    await user.type(screen.getByLabelText('Player API key'), 'some-key')
    await user.click(screen.getByRole('button', { name: /link my profile/i }))

    expect(await screen.findByText(serverMessage)).toBeTruthy()
    expect(
      screen.queryByText(/Could not verify that key against your roster\./)
    ).toBeNull()
  })

  // The parent unmounts this widget once the seat binds; without the signal a failed follow-up replaces success.
  it('tells the parent the seat was claimed, before refreshing', async () => {
    sessionUser = { id: 'user-1' }
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/onboarding/leader/claim-seat')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, code: 'A1B2C3D4E5F6' })
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    rpc.mockResolvedValue({ data: { success: true }, error: null })

    const onClaimed = vi.fn()
    const user = userEvent.setup()
    render(
      <LeaderSeatClaim guildName="Claim Test Guild" onClaimed={onClaimed} />
    )

    await user.type(screen.getByLabelText('Player API key'), 'some-key')
    await user.click(screen.getByRole('button', { name: /link my profile/i }))

    expect(await screen.findByText(/Your profile is linked/)).toBeTruthy()
    expect(onClaimed).toHaveBeenCalledTimes(1)
  })

  it('does not spend a rate-limit slot on an empty key', async () => {
    const user = userEvent.setup()
    render(<LeaderSeatClaim guildName="Claim Test Guild" />)

    await user.click(screen.getByRole('button', { name: /link my profile/i }))

    expect(await screen.findByText('Enter your Player API key')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
