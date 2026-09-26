import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClaimPage from '@/app/(public)/onboarding/claim/ClientPage'

/** The claim RPC must never be called from the browser; the page hands code and key to a server route. */

const rpc = vi.fn()
const searchParams = new URLSearchParams()
const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => searchParams
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } })
    },
    rpc: (...args: unknown[]) => rpc(...args)
  })
}))

const LIVE_CODE = 'A1B2C3D4E5F6'
const API_KEY = 'sk-target-player'

let fetchCalls: Array<{ url: string; body: Record<string, unknown> }>

function mockFetch(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    '/api/onboarding/validate-player-key': {
      success: true,
      playerName: 'ClaimPlayer'
    },
    '/api/onboarding/claim/consume': { success: true },
    '/api/onboarding/complete-via-invite': { success: true },
    '/api/player-api-key': { success: true },
    ...overrides
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : {}
      })
      const payload = responses[url] as
        { __status?: number; [key: string]: unknown } | undefined
      const status = (payload?.__status as number) ?? 200
      return {
        ok: status < 400,
        status,
        json: async () => payload ?? {}
      } as unknown as Response
    })
  )
}

async function driveToClaim(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Invite code'), LIVE_CODE)
  await user.click(screen.getByRole('button', { name: /verify/i }))

  await user.type(await screen.findByLabelText('Player API key'), API_KEY)
  await user.click(screen.getByRole('button', { name: /validate/i }))

  const claimButton = await screen.findByRole('button', {
    name: /claim my profile/i
  })
  await user.click(claimButton)
}

describe('onboarding claim — the binding is server-side', () => {
  beforeEach(() => {
    fetchCalls = []
    rpc.mockReset()
    push.mockReset()
    // The anon-executable preview RPC backs the pre-login code preview.
    rpc.mockResolvedValue({
      data: {
        valid: true,
        player_id: 'player-1',
        display_name: 'ClaimPlayer',
        guild_code: 'ZKFPH',
        guild_name: 'Claim Test Guild'
      },
      error: null
    })
  })

  it('claims through the server route, handing it BOTH the code and the key', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<ClaimPage />)

    await driveToClaim(user)

    await waitFor(() => {
      expect(
        fetchCalls.some((c) => c.url === '/api/onboarding/claim/consume')
      ).toBe(true)
    })

    const consume = fetchCalls.find(
      (c) => c.url === '/api/onboarding/claim/consume'
    )!
    expect(consume.body).toEqual({ code: LIVE_CODE, apiKey: API_KEY })
  })

  it('NEVER invokes validate_and_use_invite_code from the browser', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<ClaimPage />)

    await driveToClaim(user)

    await waitFor(() => {
      expect(
        fetchCalls.some((c) => c.url === '/api/onboarding/claim/consume')
      ).toBe(true)
    })

    const rpcNames = rpc.mock.calls.map((call) => call[0])
    expect(rpcNames).not.toContain('validate_and_use_invite_code')
    expect(rpcNames).toEqual(['get_invite_code_info'])
  })

  it('does not run the follow-up steps when the server refuses the claim', async () => {
    mockFetch({
      '/api/onboarding/claim/consume': {
        __status: 403,
        error: {
          code: 'POSSESSION_NAME_MISMATCH',
          message:
            'That API key does not belong to the player this invite was issued for.'
        }
      }
    })
    const user = userEvent.setup()
    render(<ClaimPage />)

    await driveToClaim(user)

    expect(
      await screen.findByText(/does not belong to the player/i)
    ).toBeInTheDocument()
    expect(
      fetchCalls.some((c) => c.url === '/api/onboarding/complete-via-invite')
    ).toBe(false)
    expect(fetchCalls.some((c) => c.url === '/api/player-api-key')).toBe(false)
  })

  it('still tells the user up front that the key needs Guild scope', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<ClaimPage />)

    await user.type(await screen.findByLabelText('Invite code'), LIVE_CODE)
    await user.click(screen.getByRole('button', { name: /verify/i }))

    const guildScope = await screen.findByText('Guild')
    expect(guildScope.tagName).toBe('STRONG')
  })
})
