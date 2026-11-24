import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Regression: a failing audit run must never echo raw DB error text to the caller.

describe('POST /api/cron/token-audit (route handler)', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let mockRunTokenAudit: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()

    mockRunTokenAudit = vi.fn().mockResolvedValue({
      success: true,
      guildsAudited: 0,
      held: false
    })

    vi.doMock('@/app/lib/token-audit/run-token-audit', () => ({
      runTokenAudit: mockRunTokenAudit
    }))
    vi.doMock('@/app/lib/scheduler/cron-guard', () => ({
      cronGuard: vi.fn().mockResolvedValue({ shouldExecute: true })
    }))

    vi.stubEnv('CRON_SECRET', 'top-secret')

    const mod = await import('@/app/api/cron/token-audit/route')
    POST = mod.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  const makeRequest = (
    auth?: string,
    url = 'http://localhost/api/cron/token-audit'
  ) =>
    new NextRequest(url, {
      method: 'POST',
      headers: auth ? { authorization: auth } : {}
    })

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(mockRunTokenAudit).not.toHaveBeenCalled()
  })

  it('runs the audit on a valid cron secret', async () => {
    const res = await POST(makeRequest('Bearer top-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockRunTokenAudit).toHaveBeenCalledTimes(1)
  })

  it('returns 400 for an unknown mode', async () => {
    const res = await POST(
      makeRequest(
        'Bearer top-secret',
        'http://localhost/api/cron/token-audit?mode=bogus'
      )
    )
    expect(res.status).toBe(400)
  })

  it('returns a generic 500 without raw database text when the audit fails', async () => {
    mockRunTokenAudit.mockRejectedValue(
      new Error('relation "token_audit_snapshots" does not exist')
    )

    const res = await POST(makeRequest('Bearer top-secret'))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('does not exist')
  })
})
