import { beforeEach, describe, expect, it, vi } from 'vitest'

const { serviceDbMock } = vi.hoisted(() => ({
  serviceDbMock: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({
  serviceDb: serviceDbMock
}))

import { GET } from '@/app/api/health/status/route'

describe('GET /api/health/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('counts only real failures while retaining the mixed-fanout aggregate in recovery ordering', async () => {
    const nowMs = Date.now()
    const now = new Date(nowMs).toISOString()
    const channelFailureAt = new Date(nowMs - 3 * 60_000).toISOString()
    const laterChannelDeliveryAt = new Date(nowMs - 2 * 60_000).toISOString()
    const aggregateFailureAt = new Date(nowMs - 60_000).toISOString()
    const logQueries: Array<{ eq: ReturnType<typeof vi.fn> }> = []

    const excludesManualAggregates = (eq: ReturnType<typeof vi.fn>) =>
      eq.mock.calls.some(
        ([column, value]) => column === 'manual_override' && value === false
      )

    const makeCountQuery = () => {
      const select = vi.fn()
      const gte = vi.fn()
      const eq = vi.fn()
      const query = {
        select,
        gte,
        eq,
        then: vi.fn((resolve: (value: { count: number }) => void) => {
          resolve({ count: excludesManualAggregates(eq) ? 5 : 6 })
        })
      }
      select.mockReturnValue(query)
      gte.mockReturnValue(query)
      eq.mockReturnValue(query)
      logQueries.push(query)
      return query
    }

    const makeLatestQuery = (
      filteredCreatedAt: string | null,
      unfilteredCreatedAt: string | null
    ) => {
      const select = vi.fn()
      const eq = vi.fn()
      const order = vi.fn()
      const limit = vi.fn()
      const maybeSingle = vi.fn().mockImplementation(async () => {
        const createdAt = excludesManualAggregates(eq)
          ? filteredCreatedAt
          : unfilteredCreatedAt
        return { data: createdAt ? { created_at: createdAt } : null }
      })
      const query = { select, eq, order, limit, maybeSingle }
      select.mockReturnValue(query)
      eq.mockReturnValue(query)
      order.mockReturnValue(query)
      limit.mockReturnValue(query)
      logQueries.push(query)
      return query
    }

    const syncMaybeSingle = vi.fn().mockResolvedValue({
      data: { last_successful_sync: now }
    })
    const syncLimit = vi.fn().mockReturnValue({
      maybeSingle: syncMaybeSingle
    })
    const syncOrder = vi.fn().mockReturnValue({ limit: syncLimit })
    const syncSelect = vi.fn().mockReturnValue({ order: syncOrder })
    const deliveryQueries = [
      makeCountQuery(),
      // Excluding the aggregate from the ordering would make the later delivery look recovered.
      makeLatestQuery(channelFailureAt, aggregateFailureAt),
      makeLatestQuery(laterChannelDeliveryAt, laterChannelDeliveryAt)
    ]
    let deliveryQueryIndex = 0

    serviceDbMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === 'sync_health'
          ? { select: syncSelect }
          : deliveryQueries[deliveryQueryIndex++]
      )
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      state: 'yellow',
      summary: '5 webhook errors in 24h'
    })
    expect(logQueries).toHaveLength(3)
    expect(logQueries[0]?.eq).toHaveBeenCalledWith('manual_override', false)
    for (const query of logQueries.slice(1)) {
      expect(query.eq).not.toHaveBeenCalledWith('manual_override', false)
    }
  })
})
