/** The only operator re-drive path; the admitted admin is the principal in gdpr_processing_log. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Errors as ErrorsType } from '@/app/lib/errors/AppError'

const REQUEST_ID = '33333333-3333-4333-8333-333333333333'
const ADMIN_ID = '22222222-2222-4222-8222-222222222222'

let mockRequireAppAdminUserId: ReturnType<typeof vi.fn>
let mockRedriveDataExport: ReturnType<typeof vi.fn>
let Errors: typeof ErrorsType

async function loadRoute() {
  return (await import('@/app/api/admin/gdpr/exports/[id]/redrive/route'))
    .POST as (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => Promise<Response>
}

const call = async (id = REQUEST_ID) => {
  const route = await loadRoute()
  return route(
    new NextRequest(`http://localhost/api/admin/gdpr/exports/${id}/redrive`, {
      method: 'POST'
    }),
    { params: Promise.resolve({ id }) }
  )
}

beforeEach(async () => {
  vi.resetModules()

  Errors = (await import('@/app/lib/errors/AppError')).Errors

  mockRequireAppAdminUserId = vi
    .fn()
    .mockResolvedValue({ user_id: ADMIN_ID, auth: { profile: {} } })
  mockRedriveDataExport = vi
    .fn()
    .mockResolvedValue({ outcome: 'redriven', status: 'completed' })

  const noop = () => undefined
  const fakeLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => fakeLogger
  }

  vi.doMock('@/app/lib/auth/app-admin', () => ({
    requireAppAdminUserIdForApi: mockRequireAppAdminUserId
  }))
  vi.doMock('@/app/lib/compliance/gdpr-manager', () => ({
    gdprManager: { redriveDataExport: mockRedriveDataExport }
  }))
  vi.doMock('@/app/lib/logging', () => ({
    createComponentLogger: () => fakeLogger,
    logger: fakeLogger,
    logError: noop,
    generateRequestId: () => 'req-test'
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/admin/gdpr/exports/[id]/redrive', () => {
  it('refuses an unauthenticated caller and never re-drives', async () => {
    mockRequireAppAdminUserId.mockRejectedValue(
      Errors.unauthorized('Unauthorized')
    )

    const response = await call()

    expect(response.status).toBe(401)
    expect(mockRedriveDataExport).not.toHaveBeenCalled()
  })

  it('refuses a non-admin caller and never re-drives', async () => {
    mockRequireAppAdminUserId.mockRejectedValue(
      Errors.forbidden('Admin access required')
    )

    const response = await call()

    expect(response.status).toBe(403)
    expect(mockRedriveDataExport).not.toHaveBeenCalled()
  })

  it('re-drives for an admin and names that admin as the invoker', async () => {
    const response = await call()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      requestId: REQUEST_ID,
      status: 'completed',
      redrivenBy: ADMIN_ID
    })
    // The gate's principal is the audited invoker.
    expect(mockRedriveDataExport).toHaveBeenCalledWith(REQUEST_ID, ADMIN_ID)
  })

  it('reports a re-drive that failed again as the row status, not as a 500', async () => {
    mockRedriveDataExport.mockResolvedValue({
      outcome: 'redriven',
      status: 'failed'
    })

    const response = await call()

    expect(response.status).toBe(200)
    expect((await response.json()).status).toBe('failed')
  })

  it('404s an unknown request id', async () => {
    mockRedriveDataExport.mockResolvedValue({ outcome: 'not_found' })

    const response = await call()

    expect(response.status).toBe(404)
  })

  it.each(['pending', 'processing', 'completed'])(
    '409s a %s row rather than re-driving it',
    async (status) => {
      mockRedriveDataExport.mockResolvedValue({
        outcome: 'not_redrivable',
        status
      })

      const response = await call()

      expect(response.status).toBe(409)
    }
  )

  it('rejects a non-UUID id before touching the export', async () => {
    const response = await call('not-a-uuid')

    expect(response.status).toBe(400)
    expect(mockRedriveDataExport).not.toHaveBeenCalled()
  })

  it('maps an unexpected manager failure to 500 without leaking its message', async () => {
    mockRedriveDataExport.mockRejectedValue(
      new Error('connection to db-internal-host failed')
    )

    const response = await call()
    const text = await response.text()

    expect(response.status).toBe(500)
    expect(text).not.toContain('db-internal-host')
  })
})
