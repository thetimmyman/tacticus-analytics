import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let mockDb: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockGenerateRosterStrategy: ReturnType<typeof vi.fn>

type JsonObject = { [key: string]: JsonValue | undefined }

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject

const createProfileQuery = (profile: {
  guild_code: string
  role: string
  is_app_admin?: boolean
}) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: profile, error: null })
})

const makePayload = (memberOverrides: JsonObject = {}) => {
  const contribution = {
    playerId: 'p2',
    displayName: 'Player Two',
    tokensSpent: 2,
    appliedDamage: 2000,
    expectedDamage: 2200,
    wastedTokens: 0,
    bossesDefeated: 1
  }
  const targetMember = {
    playerId: 'p1',
    displayName: 'Player One',
    guildCode: 'G1',
    role: 'officer',
    ...memberOverrides
  }
  const incomingMember = {
    playerId: 'p2',
    displayName: 'Player Two',
    guildCode: 'G2',
    role: 'member',
    ...memberOverrides
  }

  return {
    clusterCode: 'cluster-a',
    targetGuildCode: 'G1',
    guilds: [
      {
        guildCode: 'G1',
        displayName: 'Guild One',
        clusterCode: 'cluster-a',
        timeZone: 'UTC'
      }
    ],
    members: [targetMember, incomingMember],
    seasons: [{ season: '42', configId: 'S42', label: 'Current selection' }],
    baseline: {
      guildCode: 'G1',
      aggregate: {},
      seasons: [],
      contributions: [contribution]
    },
    swap: {
      outgoing: targetMember,
      incoming: incomingMember,
      targetGuildBefore: {
        guildCode: 'G1',
        aggregate: {},
        seasons: [],
        contributions: [contribution]
      },
      targetGuildAfter: {
        guildCode: 'G1',
        aggregate: {},
        seasons: [],
        contributions: [contribution]
      },
      targetGuildDelta: {},
      partnerGuildBefore: {
        guildCode: 'G2',
        aggregate: {},
        seasons: [],
        contributions: [contribution]
      },
      partnerGuildAfter: {
        guildCode: 'G2',
        aggregate: {},
        seasons: [],
        contributions: [contribution]
      },
      partnerGuildDelta: {},
      combinedDelta: {}
    },
    optimizer: [],
    investments: [],
    warnings: []
  }
}

const makeRequest = (body: JsonValue) =>
  new NextRequest(
    'http://localhost/api/guild-raid/season-plan/roster-strategy',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  )

describe('/api/guild-raid/season-plan/roster-strategy', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockDb = vi.fn()
    mockCheckFeatureAccess = vi.fn().mockResolvedValue({ has_access: true })
    mockGenerateRosterStrategy = vi.fn().mockResolvedValue(makePayload())
    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))
    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess
    }))
    vi.doMock(
      '@/app/lib/boss-assignments/season-planner/roster-strategy',
      () => ({ generateRosterStrategy: mockGenerateRosterStrategy })
    )
    vi.doMock('@sentry/nextjs', () => ({
      captureException: vi.fn(),
      setTag: vi.fn()
    }))
    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: () => ({
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }),
      generateRequestId: () => 'test-request-id',
      logError: vi.fn(),
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    }))

    mockDb.mockResolvedValue(mockSupabase)
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null
    })
    mockSupabase.from.mockReturnValue(
      createProfileQuery({ guild_code: 'G1', role: 'officer' })
    )

    const route =
      await import('@/app/api/guild-raid/season-plan/roster-strategy/route')
    POST = route.POST
  })

  it('rejects malformed JSON values before strategy generation', async () => {
    const response = await POST(makeRequest(null))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('Invalid request body')
    expect(mockGenerateRosterStrategy).not.toHaveBeenCalled()
  })

  it('rejects non-officers through the shared season-plan gate', async () => {
    mockSupabase.from.mockReturnValue(
      createProfileQuery({ guild_code: 'G1', role: 'member' })
    )

    const response = await POST(makeRequest({}))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('Insufficient permissions')
    expect(mockGenerateRosterStrategy).not.toHaveBeenCalled()
  })

  it('rejects platform app-admin members because roster strategy is guild-officer planning', async () => {
    mockSupabase.from.mockReturnValue(
      createProfileQuery({
        guild_code: 'G1',
        role: 'member',
        is_app_admin: true
      })
    )

    const response = await POST(makeRequest({}))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('Insufficient permissions')
    expect(mockGenerateRosterStrategy).not.toHaveBeenCalled()
  })

  it.each([
    ['numeric season', { season: 42 }, 'Invalid season number'],
    [
      'string boolean',
      { include_optimizer: 'false' },
      'Invalid include_optimizer'
    ],
    ['array limit', { optimizer_limit: ['5'] }, 'Invalid optimizer_limit'],
    [
      'numeric swap id',
      { swap: { outgoing_player_id: 123, incoming_player_id: 'p2' } },
      'Invalid swap'
    ]
  ])(
    'rejects wrong-type strategy fields: %s',
    async (_name, requestBody, error) => {
      const response = await POST(makeRequest(requestBody))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe(error)
      expect(mockGenerateRosterStrategy).not.toHaveBeenCalled()
    }
  )

  it('passes selected swap and normalized strategy options to the service', async () => {
    await POST(
      makeRequest({
        season: '42',
        snapshot_at: '2026-07-08T12:34:56Z',
        lookback_days: 0,
        sessions_per_day: '2',
        time_zone: 'America/New_York',
        config_id: 'S42',
        season_count: '3',
        include_optimizer: false,
        swap: {
          outgoing_player_id: 'p1',
          incoming_player_id: 'p2'
        }
      })
    )

    expect(mockGenerateRosterStrategy).toHaveBeenCalledWith(
      expect.objectContaining({
        targetGuildCode: 'G1',
        season: '42',
        snapshotAt: '2026-07-08T12:34:56.000Z',
        lookbackDays: 30,
        sessionsPerDay: 2,
        timeZone: 'America/New_York',
        configId: 'S42',
        seasonCount: 3,
        includeOptimizer: false,
        includeInvestments: true,
        swap: {
          outgoingPlayerId: 'p1',
          incomingPlayerId: 'p2'
        }
      })
    )
  })

  it('does not pass a candidate_limit cost contract to the service', async () => {
    await POST(
      makeRequest({
        candidate_limit: '1'
      })
    )

    const call = mockGenerateRosterStrategy.mock.calls.at(-1)?.[0]
    expect(call).not.toHaveProperty('candidateLimit')
  })

  it('strips sensitive member fields from route responses', async () => {
    mockGenerateRosterStrategy.mockResolvedValue(
      makePayload({
        mappingId: 123,
        apiKeyEncrypted: 'encrypted-key',
        tacticus_api_key_encrypted: 'encrypted-key',
        api_key_is_valid: true,
        lastSyncTokens: 3,
        last_sync_tokens: 3,
        next_token_seconds: 1200
      })
    )

    const response = await POST(makeRequest({}))
    const body = await response.json()

    expect(response.status).toBe(200)
    for (const member of body.members) {
      expect(member).toEqual({
        playerId: expect.any(String),
        displayName: expect.any(String),
        guildCode: expect.any(String),
        role: expect.any(String)
      })
      expect(member).not.toHaveProperty('apiKeyEncrypted')
      expect(member).not.toHaveProperty('tacticus_api_key_encrypted')
      expect(member).not.toHaveProperty('lastSyncTokens')
      expect(member).not.toHaveProperty('last_sync_tokens')
      expect(member).not.toHaveProperty('next_token_seconds')
      expect(member).not.toHaveProperty('mappingId')
    }

    expect(body.swap.outgoing).not.toHaveProperty('apiKeyEncrypted')
    expect(body.swap.incoming).not.toHaveProperty('last_sync_tokens')
  })

  it('redacts partner-guild member contributions from swap projections', async () => {
    const response = await POST(makeRequest({}))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.baseline.contributions).toHaveLength(1)
    expect(body.swap.targetGuildBefore.contributions).toHaveLength(1)
    expect(body.swap.targetGuildAfter.contributions).toHaveLength(1)
    expect(body.swap.partnerGuildBefore.contributions).toEqual([])
    expect(body.swap.partnerGuildAfter.contributions).toEqual([])
  })
})
