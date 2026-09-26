import { describe, it, expect, vi, beforeEach } from 'vitest'

// The dedup query filters `manual_override` server-side, so fixtures stage only surviving rows.

let mockDb: ReturnType<typeof vi.fn>
let mockServiceDb: ReturnType<typeof vi.fn>
let mockRequireGuildOfficerOrClusterLeader: ReturnType<typeof vi.fn>
let mockPostHeraldManualOverride: ReturnType<typeof vi.fn>

interface RecentLogRow {
  created_at: string | null
  payload_preview: string | null
}

const buildServiceClient = (rows: RecentLogRow[]) => {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null })
  const order = vi.fn().mockReturnValue({ limit })
  const gte = vi.fn().mockReturnValue({ order, limit })
  const eq2 = vi.fn().mockReturnValue({ gte })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return {
    from: vi.fn().mockReturnValue({ select })
  }
}

describe('POST /api/herald/trigger-notification (WI-693 F19)', () => {
  let POST: (request: Request) => Promise<Response>

  const validBody = {
    guild_code: 'GUILD123',
    main_boss_id: 'Magnus_E0',
    boss_display_name: 'Magnus the Red',
    rarity: 'Legendary',
    prime: 'a'
  }

  const goodAuthUser = { id: 'user-1' }

  beforeEach(async () => {
    vi.resetModules()

    mockRequireGuildOfficerOrClusterLeader = vi.fn().mockResolvedValue({
      role: 'officer',
      guild_code: 'GUILD123',
      display_name: 'Officer Bob'
    })

    mockPostHeraldManualOverride = vi.fn().mockResolvedValue({
      channels: 1,
      posted: 1,
      failed: 0,
      scope: 'guild',
      role_ping_count: 2,
      prime_boss_id: 'Magnus_E1'
    })

    const authClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: goodAuthUser } })
      }
    }
    mockDb = vi.fn().mockResolvedValue(authClient)

    mockServiceDb = vi.fn().mockReturnValue(buildServiceClient([]))

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
        postHeraldManualOverride: mockPostHeraldManualOverride
      }
    })

    const mod = await import('@/app/api/herald/trigger-notification/route')
    POST = mod.POST as typeof POST
  })

  const callRoute = async (
    body: Record<string, unknown> = validBody
  ): Promise<Response> => {
    const req = new Request(
      'http://localhost/api/herald/trigger-notification',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )
    return POST(req)
  }

  it('dispatches on first call (no prior override in window)', async () => {
    const resp = await callRoute()
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.success).toBe(true)
    expect(body.posted).toBe(1)
    expect(mockPostHeraldManualOverride).toHaveBeenCalledTimes(1)
  })

  it('returns 409 with retry_after_seconds on double-fire within 30s window', async () => {
    // payload_preview is the bare prime boss id.
    const recentRow: RecentLogRow = {
      created_at: new Date(Date.now() - 10_000).toISOString(),
      payload_preview: 'Magnus_E1'
    }
    mockServiceDb.mockReturnValue(buildServiceClient([recentRow]))

    const resp = await callRoute()
    expect(resp.status).toBe(409)
    const body = await resp.json()
    // The AppError envelope passes through withErrorHandler, with a top-level mirror for direct clients.
    expect(body.error?.message).toBe('duplicate_override_request')
    expect(body.error?.code).toBe(3003)
    expect(typeof body.retry_after_seconds).toBe('number')
    expect(body.retry_after_seconds).toBeGreaterThan(0)
    expect(body.retry_after_seconds).toBeLessThanOrEqual(30)
    expect(resp.headers.get('Retry-After')).toBeTruthy()
    expect(mockPostHeraldManualOverride).not.toHaveBeenCalled()
  })

  it('does NOT dedup on rows for a different prime (E1 vs E2)', async () => {
    const recentRow: RecentLogRow = {
      created_at: new Date(Date.now() - 5_000).toISOString(),
      payload_preview: 'Magnus_E2'
    }
    mockServiceDb.mockReturnValue(buildServiceClient([recentRow]))

    const resp = await callRoute()
    expect(resp.status).toBe(200)
    expect(mockPostHeraldManualOverride).toHaveBeenCalledTimes(1)
  })

  it('does NOT dedup on non-override rows (filtered server-side by manual_override)', async () => {
    mockServiceDb.mockReturnValue(buildServiceClient([]))

    const resp = await callRoute()
    expect(resp.status).toBe(200)
    expect(mockPostHeraldManualOverride).toHaveBeenCalledTimes(1)
  })

  it('rejects non-officer auth via the canonical helper', async () => {
    // The real Errors.forbidden, or withErrorHandler wraps it in a 500.
    const { Errors } = await vi.importActual<
      typeof import('@/app/lib/errors/AppError')
    >('@/app/lib/errors/AppError')
    mockRequireGuildOfficerOrClusterLeader.mockRejectedValue(
      Errors.forbidden('Officer required', {
        endpoint: '/api/herald/trigger-notification'
      })
    )

    const resp = await callRoute()
    expect(resp.status).toBe(403)
    expect(mockPostHeraldManualOverride).not.toHaveBeenCalled()
  })

  it('validates main_boss_id must be _E0 format', async () => {
    const resp = await callRoute({ ...validBody, main_boss_id: 'Magnus_E1' })
    expect(resp.status).toBe(400)
    expect(mockPostHeraldManualOverride).not.toHaveBeenCalled()
  })

  it("validates prime must be 'a' or 'b'", async () => {
    const resp = await callRoute({ ...validBody, prime: 'c' })
    expect(resp.status).toBe(400)
    expect(mockPostHeraldManualOverride).not.toHaveBeenCalled()
  })

  it('exposes the 30s dedup window via __testing for follow-up tests', async () => {
    const mod = await import('@/app/lib/herald/trigger-notification')
    expect(mod.__testing.DEDUP_WINDOW_MS).toBe(30_000)
    expect(mod.__testing.computePrimeBossId('Magnus_E0', 'a')).toBe('Magnus_E1')
    expect(mod.__testing.computePrimeBossId('Magnus_E0', 'b')).toBe('Magnus_E2')
  })
})
