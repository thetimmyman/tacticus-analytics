import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Regression: a failing herald post must never echo raw DB/engine error text to the client.

let mockDb: ReturnType<typeof vi.fn>
let mockServiceDb: ReturnType<typeof vi.fn>
let mockRequireGuildOfficerOrClusterLeader: ReturnType<typeof vi.fn>
let mockPostHeraldTestMessage: ReturnType<typeof vi.fn>

describe('POST /api/herald/test-fire', () => {
  let POST: (request: NextRequest) => Promise<Response>

  const validBody = {
    guild_code: 'GUILD123',
    boss_id: 'Magnus_E12',
    boss_display_name: 'Magnus the Red'
  }

  beforeEach(async () => {
    vi.resetModules()

    mockRequireGuildOfficerOrClusterLeader = vi.fn().mockResolvedValue({
      role: 'officer',
      guild_code: 'GUILD123',
      display_name: 'Officer Bob'
    })

    mockPostHeraldTestMessage = vi.fn().mockResolvedValue({
      channels: 1,
      posted: 1,
      failed: 0,
      scope: 'guild'
    })

    const authClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } })
      }
    }
    mockDb = vi.fn().mockResolvedValue(authClient)
    mockServiceDb = vi.fn().mockReturnValue({})

    vi.doMock('@/app/lib/db', () => ({
      db: mockDb,
      serviceDb: mockServiceDb
    }))
    vi.doMock('@/app/lib/auth/guild-permissions', () => ({
      requireGuildOfficerOrClusterLeader: mockRequireGuildOfficerOrClusterLeader
    }))
    vi.doMock('@/app/lib/herald/engine', async () => {
      const actual = await vi.importActual<
        typeof import('@/app/lib/herald/engine')
      >('@/app/lib/herald/engine')
      return {
        ...actual,
        postHeraldTestMessage: mockPostHeraldTestMessage
      }
    })

    const mod = await import('@/app/api/herald/test-fire/route')
    POST = mod.POST
  })

  const callRoute = async (body: Record<string, unknown> = validBody) => {
    const request = new NextRequest('http://localhost/api/herald/test-fire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return POST(request)
  }

  it('returns success when the test message posts', async () => {
    const response = await callRoute()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockPostHeraldTestMessage).toHaveBeenCalledTimes(1)
  })

  it('validates guild_code and boss_id', async () => {
    const response = await callRoute({ boss_id: 'Magnus_E12' })

    expect(response.status).toBe(400)
    expect(mockPostHeraldTestMessage).not.toHaveBeenCalled()
  })

  it('returns a generic 500 without raw database text when the test fire fails', async () => {
    mockPostHeraldTestMessage.mockRejectedValue(
      new Error('permission denied for table guild_config')
    )

    const response = await callRoute()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toBe('Herald test-fire failed')
    expect(JSON.stringify(body)).not.toContain('permission denied')
  })
})
