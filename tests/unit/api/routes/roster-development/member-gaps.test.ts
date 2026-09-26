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
      data: { guild_code: 'TEST', cluster_code: 'EOT', role },
      error: null
    })
  })
})

const createQuery = (table: string) => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn()
  }

  if (table === 'guild_roster_scoring_config') {
    query.maybeSingle.mockResolvedValue({
      data: {
        primary_source: 'playbook',
        strength_target_rarity_set: 'M1',
        tier_optimal_pct: 100,
        tier_strong_pct: 80,
        tier_suitable_pct: 60
      },
      error: null
    })
  }

  if (table === 'boss_playbook_team_requirements') {
    query.or.mockResolvedValue({ data: [], error: null })
  }

  if (table === 'player_mapping') {
    query.order.mockResolvedValue({ data: [], error: null })
  }

  return query
}

const createServiceClient = () => ({
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  from: vi.fn((table: string) => createQuery(table))
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

  vi.doMock('@tacticus/app-core/api-key-helper', () => ({
    getPlayerApiKey: vi.fn()
  }))

  vi.doMock('@/app/lib/api/tacticus-client', () => ({
    tacticusAPI: { getPlayer: vi.fn() }
  }))

  vi.doMock('@/app/lib/services/strength-precedence', () => ({
    fetchPlaybookRequirements: vi.fn(),
    scoreRosterAgainstPlaybook: vi.fn(),
    fetchGlobalThresholds: vi.fn().mockResolvedValue([])
  }))

  vi.doMock('@/app/lib/data/boss-performance', () => ({
    getBossPerformance: vi.fn().mockResolvedValue(null)
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

  return import('@/app/api/roster-development/member-gaps/route')
}

describe('/api/roster-development/member-gaps', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['officer', 'leader', 'admin'])(
    'allows %s role through the member-gaps gate',
    async (role) => {
      const { GET } = await loadRoute(role)

      const response = await GET(
        new NextRequest('http://localhost/api/roster-development/member-gaps')
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.guild_code).toBe('TEST')
      expect(body.members).toEqual([])
    }
  )

  it('rejects member role before service work', async () => {
    const { GET } = await loadRoute('member')

    const response = await GET(
      new NextRequest('http://localhost/api/roster-development/member-gaps')
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('Insufficient permissions')
    expect(mockServiceDb).not.toHaveBeenCalled()
  })
})
