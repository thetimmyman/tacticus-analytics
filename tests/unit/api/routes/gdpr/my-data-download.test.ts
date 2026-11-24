import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const db = vi.fn()
const requireSessionUser = vi.fn()
const apiSecurityMiddleware = vi.fn()

const REQUEST_ID = '9f8c3b2a-1d4e-4f5a-8b6c-7d8e9f0a1b2c'
const USER = { id: 'user-1' }
const FUTURE_EXPIRY = new Date(Date.now() + 60 * 60 * 1000).toISOString()
const PAST_EXPIRY = new Date(Date.now() - 60 * 60 * 1000).toISOString()

interface QueryResult {
  data: unknown
  error: unknown
}

function makeSupabase(singleResult: QueryResult) {
  const single = vi.fn().mockResolvedValue(singleResult)
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single
  }
  const supabase = { from: vi.fn().mockReturnValue(chain) }
  return { supabase, chain, single }
}

describe('GET /api/gdpr/my-data/[requestId]/download', () => {
  let GET: (
    request: NextRequest,
    ctx: { params: Promise<{ requestId: string }> }
  ) => Promise<Response>
  // Re-imported after resetModules so thrown AppErrors share the route's class identity.
  let Errors: (typeof import('@/app/lib/errors/AppError'))['Errors']

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
    apiSecurityMiddleware.mockResolvedValue(null)
    ;({ Errors } = await import('@/app/lib/errors/AppError'))

    vi.doMock('@/app/lib/db', () => ({ db }))
    vi.doMock('@/app/lib/api/session-user', () => ({ requireSessionUser }))
    vi.doMock('@/app/lib/middleware/api-security-middleware', () => ({
      apiSecurityMiddleware
    }))
    ;({ GET } =
      await import('@/app/api/gdpr/my-data/[requestId]/download/route'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const call = async (requestId: string): Promise<Response> =>
    GET(
      new NextRequest(
        `http://localhost/api/gdpr/my-data/${requestId}/download`
      ),
      { params: Promise.resolve({ requestId }) }
    )

  it('404s off the desktop profile before any database work', async () => {
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'hosted')

    const response = await call(REQUEST_ID)

    expect(response.status).toBe(404)
    expect(db).not.toHaveBeenCalled()
  })

  it('honors a security-middleware block before the session lookup', async () => {
    apiSecurityMiddleware.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })
    )

    const response = await call(REQUEST_ID)

    expect(response.status).toBe(429)
    expect(requireSessionUser).not.toHaveBeenCalled()
  })

  it('returns 401 when the session user is missing', async () => {
    requireSessionUser.mockRejectedValue(
      Errors.unauthorized('Not authenticated')
    )

    const response = await call(REQUEST_ID)

    expect(response.status).toBe(401)
  })

  it('rejects a malformed request id before querying', async () => {
    const { supabase } = makeSupabase({ data: null, error: null })
    db.mockResolvedValue(supabase)
    requireSessionUser.mockResolvedValue(USER)

    const response = await call('not-a-uuid')

    expect(response.status).toBe(400)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('404s when no export row exists for the caller', async () => {
    const { supabase } = makeSupabase({ data: null, error: null })
    db.mockResolvedValue(supabase)
    requireSessionUser.mockResolvedValue(USER)

    const response = await call(REQUEST_ID)

    expect(response.status).toBe(404)
    expect(supabase.from).toHaveBeenCalledWith('gdpr_data_exports')
    expect(supabase.from('gdpr_data_exports').select).toHaveBeenCalledWith(
      'status,expires_at,data_package'
    )
  })

  it('404s while the export is still pending', async () => {
    const { supabase } = makeSupabase({
      data: {
        status: 'pending',
        expires_at: FUTURE_EXPIRY,
        data_package: { profile: {} }
      },
      error: null
    })
    db.mockResolvedValue(supabase)
    requireSessionUser.mockResolvedValue(USER)

    const response = await call(REQUEST_ID)

    expect(response.status).toBe(404)
  })

  it('404s once the export has expired', async () => {
    const { supabase } = makeSupabase({
      data: {
        status: 'completed',
        expires_at: PAST_EXPIRY,
        data_package: { profile: {} }
      },
      error: null
    })
    db.mockResolvedValue(supabase)
    requireSessionUser.mockResolvedValue(USER)

    const response = await call(REQUEST_ID)

    expect(response.status).toBe(404)
  })

  it('streams the completed package as a no-store JSON attachment', async () => {
    const dataPackage = {
      profile: { displayName: 'Tester' },
      battles: []
    }
    const { supabase, chain } = makeSupabase({
      data: {
        status: 'completed',
        expires_at: FUTURE_EXPIRY,
        data_package: dataPackage
      },
      error: null
    })
    db.mockResolvedValue(supabase)
    requireSessionUser.mockResolvedValue(USER)

    const response = await call(REQUEST_ID)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8'
    )
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="local-profile-data.json"'
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.json()).toEqual(dataPackage)
    expect(chain.eq).toHaveBeenCalledWith('request_id', REQUEST_ID)
    expect(chain.eq).toHaveBeenCalledWith('user_id', USER.id)
  })

  it('500s when the package exceeds the supported download size', async () => {
    const oversized = { blob: 'x'.repeat(32 * 1024 * 1024) }
    const { supabase } = makeSupabase({
      data: {
        status: 'completed',
        expires_at: FUTURE_EXPIRY,
        data_package: oversized
      },
      error: null
    })
    db.mockResolvedValue(supabase)
    requireSessionUser.mockResolvedValue(USER)

    const response = await call(REQUEST_ID)

    expect(response.status).toBe(500)
  })
})
