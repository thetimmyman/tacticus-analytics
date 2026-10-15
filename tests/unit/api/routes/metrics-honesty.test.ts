import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createMockGetRequest } from '@/tests/utils'

vi.mock('@/app/lib/db', () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(resolve)
  }
  return {
    serviceDb: () => ({
      from: vi.fn(() => query),
      rpc: vi.fn(async () => ({ data: null, error: null })),
      auth: {}
    })
  }
})

vi.mock('@/app/lib/health', () => ({
  checkNginxRouting: async () => ({ healthy: false, checked: false }),
  checkCloudflaredTunnel: async () => ({ healthy: false, checked: false }),
  checkPostgrestSchemaHealth: async () => ({ healthy: false, checked: false })
}))

let GET: typeof import('@/app/api/metrics/route').GET
const secret = 'M'.repeat(32)
const previous = process.env.METRICS_SECRET

beforeAll(async () => {
  process.env.METRICS_SECRET = secret
  ;({ GET } = await import('@/app/api/metrics/route'))
})

afterAll(() => {
  if (previous === undefined) delete process.env.METRICS_SECRET
  else process.env.METRICS_SECRET = previous
})

it.each([
  'tacticus_cache_hit_rate',
  'tacticus_last_backup_timestamp',
  'tacticus_last_backup_status',
  'tacticus_duplicate_current_records'
])(
  'keeps the %s family but leaves unmeasured samples unavailable',
  async (name) => {
    const response = await GET(
      createMockGetRequest('/api/metrics', undefined, {
        authorization: `Bearer ${secret}`
      })
    )
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain(`# HELP ${name} `)
    expect(text).toContain(`# TYPE ${name} gauge`)
    const samples = text
      .split('\n')
      .filter(
        (line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `)
      )
    expect(samples).toEqual([])
  }
)

it('keeps the endpoint disabled when no metrics secret is configured', async () => {
  vi.resetModules()
  delete process.env.METRICS_SECRET
  const { GET: disabled } = await import('@/app/api/metrics/route')
  const response = await disabled(createMockGetRequest('/api/metrics'))
  expect(response.status).toBe(404)
  expect(await response.json()).toMatchObject({
    error: { code: 'METRICS_DISABLED' }
  })
})
