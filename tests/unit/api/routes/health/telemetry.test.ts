import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

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

type QueryName = 'latest' | 'total' | 'failed'
type QueryResult = {
  data?: { last_successful_sync: string } | null
  count?: number | null
  error?: { message: string } | null
}

function useQueryResults(
  overrides: Partial<Record<QueryName, QueryResult>> = {}
) {
  const results: Record<QueryName, QueryResult> = {
    latest: {
      data: { last_successful_sync: '2026-01-01T00:00:00.000Z' },
      error: null
    },
    total: { count: 12, error: null },
    failed: { count: 3, error: null },
    ...overrides
  }
  let logQueryIndex = 0
  serviceDbMock.mockReturnValue({
    from: vi.fn((table: string) => {
      const result =
        results[
          table === 'sync_health'
            ? 'latest'
            : logQueryIndex++ === 0
              ? 'total'
              : 'failed'
        ]
      const query = {
        select: vi.fn(),
        order: vi.fn(),
        limit: vi.fn(),
        gte: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: QueryResult) => void) => resolve(result)
      }
      for (const method of [
        query.select,
        query.order,
        query.limit,
        query.gte,
        query.eq
      ])
        method.mockReturnValue(query)
      return query
    })
  })
}

const telemetryRequest = () =>
  new NextRequest('http://localhost/api/health/telemetry')

async function expectUnavailable(response: Response) {
  expect(response.status).toBe(503)
  const body = await response.json()
  expect(body).toMatchObject({ error: { message: 'telemetry_unavailable' } })
  expect(body).not.toHaveProperty('api_calls_24h')
  expect(body).not.toHaveProperty('errors_24h')
  expect(JSON.stringify(body)).not.toContain('synthetic database query failure')
}

describe('GET /api/health/telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthForApiMock.mockResolvedValue({
      user: { id: 'user-1' },
      profile: { guild_code: 'TESTGLD' }
    })
  })

  it('rejects an unauthenticated caller', async () => {
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

  it('preserves a genuinely measured zero and the successful numeric JSON contract', async () => {
    useQueryResults({
      total: { count: 0, error: null },
      failed: { count: 0, error: null }
    })
    const response = await GET(telemetryRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      last_poll_at: '2026-01-01T00:00:00.000Z',
      poll_cadence_seconds: 60,
      api_calls_24h: 0,
      errors_24h: 0
    })
  })

  it('retains the existing unavailable response for a thrown database failure', async () => {
    serviceDbMock.mockImplementationOnce(() => {
      throw new Error('synthetic database query failure')
    })
    await expectUnavailable(await GET(telemetryRequest()))
  })

  it.each(['latest', 'total', 'failed'] as const)(
    'returns unavailable for a resolved %s query error',
    async (name) => {
      useQueryResults({
        [name]: {
          data: null,
          count: null,
          error: { message: 'synthetic database query failure' }
        }
      })
      await expectUnavailable(await GET(telemetryRequest()))
    }
  )

  it.each([
    ['total', null],
    ['failed', null],
    ['total', undefined],
    ['failed', undefined]
  ] as const)(
    'returns unavailable for an absent %s count (%s)',
    async (name, count) => {
      useQueryResults({ [name]: { count, error: null } })
      await expectUnavailable(await GET(telemetryRequest()))
    }
  )
})
