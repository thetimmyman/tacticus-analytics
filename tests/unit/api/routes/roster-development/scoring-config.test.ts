import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let mockDb: ReturnType<typeof vi.fn>
let mockServiceDb: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>

const createSupabase = (role: string) => ({
  auth: {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null
    })
  },
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { guild_code: 'TEST', role },
      error: null
    })
  })
})

const createServiceClient = () => ({
  rpc: vi.fn().mockResolvedValue({
    data: [{ rarity_set: 'M1' }, { rarity_set: 'L5' }],
    error: null
  }),
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        primary_source: 'playbook',
        strength_target_rarity_set: 'M1',
        tier_optimal_pct: 100,
        tier_strong_pct: 80,
        tier_suitable_pct: 60
      },
      error: null
    }),
    upsert: vi.fn().mockResolvedValue({ error: null })
  })
})

async function loadRoute(role: string) {
  vi.resetModules()

  mockDb = vi.fn().mockResolvedValue(createSupabase(role))
  mockServiceDb = vi.fn().mockReturnValue(createServiceClient())
  mockCheckFeatureAccess = vi.fn().mockResolvedValue({ has_access: true })

  vi.doMock('@/app/lib/db', () => ({
    db: mockDb,
    serviceDb: mockServiceDb
  }))

  vi.doMock('@/app/lib/services/feature-release-service', () => ({
    checkFeatureAccess: mockCheckFeatureAccess
  }))

  vi.doMock('@/app/lib/logging', () => ({
    logger: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    },
    createComponentLogger: vi.fn(() => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    })),
    generateRequestId: vi.fn(() => 'test-request-id'),
    logError: vi.fn()
  }))

  return import('@/app/api/roster-development/scoring-config/route')
}

describe('/api/roster-development/scoring-config', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['officer', 'leader', 'admin'])(
    'marks %s role as editable',
    async (role) => {
      const { GET } = await loadRoute(role)

      const response = await GET(
        new NextRequest(
          'http://localhost/api/roster-development/scoring-config'
        )
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.can_edit).toBe(true)
    }
  )

  it('marks member role as read-only', async () => {
    const { GET } = await loadRoute('member')

    const response = await GET(
      new NextRequest('http://localhost/api/roster-development/scoring-config')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.can_edit).toBe(false)
  })

  it('rejects member writes', async () => {
    const { PUT } = await loadRoute('member')

    const response = await PUT(
      new NextRequest(
        'http://localhost/api/roster-development/scoring-config',
        {
          method: 'PUT',
          body: JSON.stringify({
            primary_source: 'playbook',
            tier_optimal_pct: 100,
            tier_strong_pct: 80,
            tier_suitable_pct: 60
          })
        }
      )
    )

    expect(response.status).toBe(403)
  })
})
