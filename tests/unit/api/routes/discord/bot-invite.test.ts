import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('POST /api/discord/bot-invite', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let rpc: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    mockCreateServiceClient = vi.fn()
    rpc = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    mockCreateServiceClient.mockReturnValue({ rpc })

    const routeModule = await import('@/app/api/discord/bot-invite/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  const createRequest = (
    body: object,
    inviteCode?: string,
    headers?: Record<string, string>
  ) => {
    const url = inviteCode
      ? `http://localhost/api/discord/bot-invite?guild_invite_code=${inviteCode}`
      : 'http://localhost/api/discord/bot-invite'
    return new NextRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    })
  }

  it('returns 400 when invite code or guild ID is missing', async () => {
    const missingCode = await POST(
      createRequest({ guild_id: '123456789012345678' })
    )
    const missingGuild = await POST(createRequest({}, 'VALIDCODE'))

    expect(missingCode.status).toBe(400)
    expect(missingGuild.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns 413 for an oversized chunked-style request body', async () => {
    const response = await POST(
      createRequest(
        {
          guild_id: '123456789012345678',
          padding: 'x'.repeat(9 * 1024)
        },
        'VALIDCODE'
      )
    )

    expect(response.status).toBe(413)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid', 404, 'Invalid or expired'],
    ['exhausted', 410, 'maximum uses'],
    ['expired', 410, 'expired'],
    ['already_used', 410, 'already been used'],
    ['guild_missing', 404, 'Guild configuration not found']
  ])(
    'maps the atomic %s result to HTTP %i',
    async (status, expectedStatus, message) => {
      rpc.mockResolvedValue({ data: { status }, error: null })

      const response = await POST(
        createRequest({ guild_id: '123456789012345678' }, 'VALIDCODE')
      )
      const body = await response.json()

      expect(response.status).toBe(expectedStatus)
      expect(body.error.message).toContain(message)
    }
  )

  it('creates the link through one atomic service-role RPC', async () => {
    rpc.mockResolvedValue({
      data: { status: 'linked', guild_code: 'TESTGLD' },
      error: null
    })

    const response = await POST(
      createRequest({ guild_id: '123456789012345678' }, 'VALIDCODE')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.message).toContain('successfully linked')
    expect(body.guild_code).toBe('TESTGLD')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('consume_discord_bot_invite', {
      p_invite_code: 'VALIDCODE',
      p_discord_guild_id: '123456789012345678',
      p_discord_user_id: null
    })
  })

  it('returns idempotent success when the mapping already exists', async () => {
    rpc.mockResolvedValue({
      data: { status: 'already_linked', guild_code: 'TESTGLD' },
      error: null
    })

    const response = await POST(
      createRequest({ guild_id: '123456789012345678' }, 'VALIDCODE')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.message).toContain('already linked')
  })

  it('fails closed when the atomic RPC fails or returns an unknown state', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'db error' } })
    const failed = await POST(
      createRequest({ guild_id: '123456789012345678' }, 'VALIDCODE')
    )

    rpc.mockResolvedValueOnce({ data: { status: 'unexpected' }, error: null })
    const unknown = await POST(
      createRequest({ guild_id: '123456789012345678' }, 'OTHERCODE')
    )

    expect(failed.status).toBe(500)
    expect(unknown.status).toBe(500)
  })

  it('rate-limits repeated attempts by requester IP and invite code', async () => {
    rpc.mockResolvedValue({ data: { status: 'invalid' }, error: null })

    const responses: Response[] = []
    for (let index = 0; index < 6; index += 1) {
      responses.push(
        await POST(
          createRequest({ guild_id: '123456789012345678' }, 'BRUTEFORCE', {
            'x-forwarded-for': '203.0.113.10'
          })
        )
      )
    }

    expect(responses.slice(0, 5).map((response) => response.status)).toEqual([
      404, 404, 404, 404, 404
    ])
    expect(responses[5].status).toBe(429)
    expect(responses[5].headers.get('Retry-After')).toBeTruthy()
    expect(rpc).toHaveBeenCalledTimes(5)
  })
})
