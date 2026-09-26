import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GuildJoinFlow from '@/app/components/clusters/GuildJoinFlow'

/** A bad code is `200 { valid: false, error }`; a rejected request is the `{ error: { code, message } }` envelope. */

vi.mock('@/app/hooks/useToast', () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  })
}))

const CODE = 'ABCDEF'

function mockFetch(status: number, payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        ({
          ok: status < 400,
          status,
          json: async () => payload
        }) as unknown as Response
    )
  )
}

async function submitCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByPlaceholderText('Enter your invite code'),
    CODE.toLowerCase()
  )
  await user.click(screen.getByRole('button', { name: /validate code/i }))
}

describe('GuildJoinFlow — invite validation error envelopes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the standardized message when the session has expired', async () => {
    mockFetch(401, {
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
        statusCode: 401,
        requestId: 'req-1'
      }
    })
    const user = userEvent.setup()
    render(<GuildJoinFlow />)

    await submitCode(user)

    expect(await screen.findByText('Unauthorized')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /validate code/i })
    ).toBeInTheDocument()
  })

  it('shows the standardized message when the rate limit rejects validation', async () => {
    mockFetch(429, {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded',
        statusCode: 429
      }
    })
    const user = userEvent.setup()
    render(<GuildJoinFlow />)

    await submitCode(user)

    expect(await screen.findByText('Rate limit exceeded')).toBeInTheDocument()
  })

  it('falls back to a readable sentence when the envelope carries no message', async () => {
    mockFetch(503, { detail: 'upstream unavailable' })
    const user = userEvent.setup()
    render(<GuildJoinFlow />)

    await submitCode(user)

    expect(
      await screen.findByText(
        'Unable to validate the invite code. Please try again.'
      )
    ).toBeInTheDocument()
  })

  it('still surfaces the handler string for a code that is simply wrong', async () => {
    mockFetch(200, { valid: false, error: 'Invalid invite code' })
    const user = userEvent.setup()
    render(<GuildJoinFlow />)

    await submitCode(user)

    expect(await screen.findByText('Invalid invite code')).toBeInTheDocument()
  })

  it('advances to the guild form on a valid code', async () => {
    mockFetch(200, {
      valid: true,
      cluster: {
        cluster_code: 'CLU',
        display_name: 'Test Cluster',
        max_guilds: 5
      }
    })
    const user = userEvent.setup()
    render(<GuildJoinFlow />)

    await submitCode(user)

    expect(
      await screen.findByText(/joining: test cluster/i)
    ).toBeInTheDocument()
  })
})
