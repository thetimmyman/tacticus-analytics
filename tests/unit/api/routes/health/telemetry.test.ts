import { beforeEach, describe, expect, it, vi } from 'vitest'

const { serviceDbMock, requireAuthForApiMock } = vi.hoisted(() => ({
  serviceDbMock: vi.fn(),
  requireAuthForApiMock: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({
  serviceDb: serviceDbMock
}))

vi.mock('@/app/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
  return { ...actual, requireAuthForApi: requireAuthForApiMock }
})

import { GET } from '@/app/api/health/telemetry/route'

describe('GET /api/health/telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthForApiMock.mockResolvedValue({
      user: { id: 'user-1' },
      profile: { guild_code: 'TESTGLD' }
    })
  })

  it('rejects an unauthenticated caller (WI-6050)', async () => {
    const { AuthError } = await import('@/app/lib/auth')
    requireAuthForApiMock.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )

    const response = await GET()

    expect(response.status).toBe(401)
    expect(serviceDbMock).not.toHaveBeenCalled()
  })

  it('excludes suppression and manual aggregate audits from delivery telemetry', async () => {
    const logQueries: Array<{ eq: ReturnType<typeof vi.fn> }> = []
    let logQueryIndex = 0

    const makeLogQuery = () => {
      const countWhenFiltered = logQueryIndex++ === 0 ? 12 : 3
      const select = vi.fn()
      const gte = vi.fn()
      const eq = vi.fn()
      const query = {
        select,
        gte,
        eq,
        then: vi.fn((resolve: (value: { count: number }) => void) => {
          const excludesSuppressed = eq.mock.calls.some(
            ([column, value]) =>
              column === 'suppressed_by_master_toggle' && value === false
          )
          const excludesManualAggregates = eq.mock.calls.some(
            ([column, value]) => column === 'manual_override' && value === false
          )
          resolve({
            count:
              excludesSuppressed && excludesManualAggregates
                ? countWhenFiltered
                : 999
          })
        })
      }
      select.mockReturnValue(query)
      gte.mockReturnValue(query)
      eq.mockReturnValue(query)
      logQueries.push(query)
      return query
    }

    const syncMaybeSingle = vi.fn().mockResolvedValue({
      data: { last_successful_sync: '2026-08-03T12:00:00.000Z' }
    })
    const syncLimit = vi.fn().mockReturnValue({
      maybeSingle: syncMaybeSingle
    })
    const syncOrder = vi.fn().mockReturnValue({ limit: syncLimit })
    const syncSelect = vi.fn().mockReturnValue({ order: syncOrder })

    serviceDbMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === 'sync_health' ? { select: syncSelect } : makeLogQuery()
      )
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      api_calls_24h: 12,
      errors_24h: 3
    })
    expect(logQueries).toHaveLength(2)
    for (const query of logQueries) {
      expect(query.eq).toHaveBeenCalledWith(
        'suppressed_by_master_toggle',
        false
      )
      expect(query.eq).toHaveBeenCalledWith('manual_override', false)
    }
  })
})
