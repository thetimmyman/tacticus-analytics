import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClaimPage from '@/app/(public)/onboarding/claim/ClientPage'

/** Step 2 only checks /player, so a Player-only key fails at Step 3; the key field must return. */

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
const PLAYER_ONLY_KEY = 'sk-player-only'
const FULL_KEY = 'sk-player-and-guild'

const GUILD_SCOPE_COPY =
  'That API key was not accepted for guild access. A key with Player read access is all you need — create one at api.tacticusgame.com, then try again.'

let fetchCalls: Array<{ url: string; body: Record<string, unknown> }>
let consumeResponses: Array<Record<string, unknown>>

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : {}
      })

      let payload: Record<string, unknown> = { success: true }
      if (url === '/api/onboarding/validate-player-key') {
        payload = { success: true, playerName: 'ClaimPlayer' }
      } else if (url === '/api/onboarding/claim/consume') {
        payload = consumeResponses.shift() ?? { success: true }
      }

      const status = (payload.__status as number) ?? 200
      return {
        ok: status < 400,
        status,
        json: async () => payload
      } as unknown as Response
    })
  )
}

async function verifyCodeAndKey(
  user: ReturnType<typeof userEvent.setup>,
  apiKey: string
) {
  await user.type(await screen.findByLabelText('Invite code'), LIVE_CODE)
  await user.click(screen.getByRole('button', { name: /verify/i }))

  await user.type(await screen.findByLabelText('Player API key'), apiKey)
  await user.click(screen.getByRole('button', { name: /^validate$/i }))
}

describe('onboarding claim — recovering from a key the claim step refuses', () => {
  beforeEach(() => {
    fetchCalls = []
    consumeResponses = []
    rpc.mockReset()
    push.mockReset()
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
    mockFetch()
  })

  it('reopens the key field, with the reason, when the key lacks Guild scope', async () => {
    consumeResponses = [
      {
        __status: 400,
        error: { code: 'GUILD_SCOPE_REQUIRED', message: GUILD_SCOPE_COPY }
      }
    ]
    const user = userEvent.setup()
    render(<ClaimPage />)

    await verifyCodeAndKey(user, PLAYER_ONLY_KEY)
    await user.click(screen.getByRole('button', { name: /claim my profile/i }))

    const keyField = await screen.findByLabelText('Player API key')
    expect(keyField).toHaveValue(PLAYER_ONLY_KEY)
    expect(screen.getByText(GUILD_SCOPE_COPY)).toBeInTheDocument()
    expect(screen.queryByText('API Key Validated')).toBeNull()
  })

  it('lets the replacement key be validated and claimed without a reload', async () => {
    consumeResponses = [
      {
        __status: 400,
        error: { code: 'GUILD_SCOPE_REQUIRED', message: GUILD_SCOPE_COPY }
      },
      { success: true }
    ]
    const user = userEvent.setup()
    render(<ClaimPage />)

    await verifyCodeAndKey(user, PLAYER_ONLY_KEY)
    await user.click(screen.getByRole('button', { name: /claim my profile/i }))

    const keyField = await screen.findByLabelText('Player API key')
    await user.clear(keyField)
    await user.type(keyField, FULL_KEY)
    await user.click(screen.getByRole('button', { name: /^validate$/i }))
    await user.click(
      await screen.findByRole('button', { name: /claim my profile/i })
    )

    expect(await screen.findByText('Profile Claimed!')).toBeInTheDocument()
    const consumeBodies = fetchCalls
      .filter((call) => call.url === '/api/onboarding/claim/consume')
      .map((call) => call.body.apiKey)
    expect(consumeBodies).toEqual([PLAYER_ONLY_KEY, FULL_KEY])
  })

  it('keeps a way back to the field for rejections it does not recognize', async () => {
    consumeResponses = [
      {
        __status: 409,
        error: {
          code: 'GUILD_SYNC_STALE',
          message: 'This guild has not synced recently enough.'
        }
      }
    ]
    const user = userEvent.setup()
    render(<ClaimPage />)

    await verifyCodeAndKey(user, PLAYER_ONLY_KEY)
    await user.click(screen.getByRole('button', { name: /claim my profile/i }))

    expect(
      await screen.findByText('This guild has not synced recently enough.')
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /use a different key/i })
    )
    expect(await screen.findByLabelText('Player API key')).toBeInTheDocument()
  })
})
