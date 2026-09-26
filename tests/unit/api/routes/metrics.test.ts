import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach
} from 'vitest'
import { Registry } from 'prom-client'
import { createMockGetRequest } from '@/tests/utils'

const { mockQuery, mockServiceClient } = vi.hoisted(() => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn().mockResolvedValue({ data: null, error: null, count: 0 })
  }
  return {
    mockQuery: query,
    mockServiceClient: {
      from: vi.fn().mockReturnValue(query),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null })
    }
  }
})

vi.mock('@/app/lib/db', () => ({
  serviceDb: vi.fn(() => mockServiceClient)
}))

let GET: typeof import('@/app/api/metrics/route').GET

describe('GET /api/metrics', () => {
  const metricsSecret = 'test-metrics-secret'
  const originalMetricsSecret = process.env.METRICS_SECRET

  beforeAll(async () => {
    process.env.METRICS_SECRET = metricsSecret
    ;({ GET } = await import('@/app/api/metrics/route'))
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.METRICS_SECRET = metricsSecret
    mockServiceClient.from.mockReturnValue(mockQuery)
    mockQuery.then.mockResolvedValue({
      data: null,
      error: null,
      count: 0
    })
    mockServiceClient.rpc.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    if (originalMetricsSecret === undefined) {
      delete process.env.METRICS_SECRET
    } else {
      process.env.METRICS_SECRET = originalMetricsSecret
    }
  })

  const createAuthorizedRequest = () =>
    createMockGetRequest('/api/metrics', undefined, {
      authorization: `Bearer ${metricsSecret}`
    })

  const setupSuccessfulMocks = () => {
    const now = new Date().toISOString()
    mockQuery.then.mockResolvedValue({
      data: [
        {
          updated_at: now,
          health_status: 'healthy',
          avg_sync_time_ms: 123
        }
      ],
      error: null,
      count: 5
    })
    mockServiceClient.rpc.mockResolvedValue({
      data: { active_players: 100 },
      error: null
    })
  }

  it('returns 401 when authorization header is missing', async () => {
    setupSuccessfulMocks()

    const response = await GET(createMockGetRequest('/api/metrics'))

    expect(response.status).toBe(401)
  })

  it('returns 200 when authorization header is valid', async () => {
    setupSuccessfulMocks()

    const response = await GET(createAuthorizedRequest())

    expect(response.status).toBe(200)
  })

  it('returns 200 with Prometheus format metrics', async () => {
    setupSuccessfulMocks()

    const response = await GET(createAuthorizedRequest())
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
  })

  it('includes tacticus_ prefixed custom metrics', async () => {
    setupSuccessfulMocks()

    const response = await GET(createAuthorizedRequest())
    const text = await response.text()

    expect(text).toContain('tacticus_health_check_database_status')
    expect(text).toContain('tacticus_health_check_auth_status')
    expect(text).toContain('tacticus_memory_usage_bytes')
    expect(text).toContain('tacticus_uptime_seconds')
  })

  it('includes active guilds metric', async () => {
    setupSuccessfulMocks()

    const response = await GET(createAuthorizedRequest())
    const text = await response.text()

    expect(text).toContain('tacticus_active_guilds')
  })

  it('includes active players metric', async () => {
    setupSuccessfulMocks()

    const response = await GET(createAuthorizedRequest())
    const text = await response.text()

    expect(text).toContain('tacticus_active_players')
  })

  it('sets database status gauge based on connection result', async () => {
    setupSuccessfulMocks()

    const response = await GET(createAuthorizedRequest())
    const text = await response.text()

    expect(text).toMatch(
      /tacticus_health_check_database_status\{[^}]*\}\s+[01]/
    )
  })

  it('includes database status metric when database fails', async () => {
    mockQuery.then.mockRejectedValue(new Error('Connection failed'))

    const response = await GET(createAuthorizedRequest())
    const text = await response.text()

    expect(text).toContain('tacticus_health_check_database_status')
  })

  it('includes memory usage metrics by type', async () => {
    setupSuccessfulMocks()

    const response = await GET(createAuthorizedRequest())
    const text = await response.text()

    expect(text).toContain('tacticus_memory_usage_bytes{type="heap_used"')
    expect(text).toContain('tacticus_memory_usage_bytes{type="heap_total"')
    expect(text).toContain('tacticus_memory_usage_bytes{type="rss"')
  })

  it('includes api response time metric', async () => {
    setupSuccessfulMocks()

    const response = await GET(createAuthorizedRequest())
    const text = await response.text()

    expect(text).toContain('tacticus_api_response_time_seconds')
  })

  it('returns 500 with error message on complete failure', async () => {
    setupSuccessfulMocks()
    const metricsSpy = vi
      .spyOn(Registry.prototype, 'metrics')
      .mockRejectedValue(new Error('prom-client unavailable'))

    const response = await GET(createAuthorizedRequest())

    expect(response.status).toBe(500)
    metricsSpy.mockRestore()
  })

  it('includes environment label in metrics', async () => {
    setupSuccessfulMocks()

    const response = await GET(createAuthorizedRequest())
    const text = await response.text()

    expect(text).toContain('app="tacticus-analytics"')
  })

  it('includes last data update timestamp when available', async () => {
    setupSuccessfulMocks()

    const response = await GET(createAuthorizedRequest())
    const text = await response.text()

    expect(text).toContain('tacticus_last_data_update_timestamp')
  })

  it('includes cache hit rate metric', async () => {
    setupSuccessfulMocks()

    const response = await GET(createAuthorizedRequest())
    const text = await response.text()

    expect(text).toContain('tacticus_cache_hit_rate')
  })

  it('includes backup status metrics', async () => {
    setupSuccessfulMocks()

    const response = await GET(createAuthorizedRequest())
    const text = await response.text()

    expect(text).toContain('tacticus_last_backup_timestamp')
    expect(text).toContain('tacticus_last_backup_status')
  })
})
