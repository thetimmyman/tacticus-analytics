import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockDb: ReturnType<typeof vi.fn>
let mockServiceDb: ReturnType<typeof vi.fn>
let mockGuildConfigGetBasic: ReturnType<typeof vi.fn>

describe('GET /api/members/token-usage/battles', () => {
  let GET: (request: Request) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    mockDb = vi.fn()
    mockServiceDb = vi.fn()
    mockGuildConfigGetBasic = vi.fn()

    vi.doMock('@/app/lib/db', () => ({
      db: mockDb,
      serviceDb: mockServiceDb
    }))

    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        getBasic: mockGuildConfigGetBasic
      }
    }))

    const routeModule =
      await import('@/app/api/members/token-usage/battles/route')
    GET = routeModule.GET
  })

  it('returns battle rows using the canonical guild code server-side', async () => {
    const inputGuild = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF'
    const canonicalGuild = 'abcdefab-cdef-4abc-8def-abcdefabcdef'
    const profileQuery = createProfileQuery({
      guild_code: inputGuild,
      role: 'officer',
      cluster_code: 'EOT'
    })
    const battleRows = [
      {
        userId: 'player-1',
        displayName: 'Player One',
        Season: '100',
        damageType: 'Battle',
        rarity: 'Legendary',
        damageDealt: 123,
        Name: 'Boss',
        encounterId: 0,
        loopIndex: 1
      }
    ]
    const battleQuery = createBattleQuery({
      data: battleRows,
      error: null
    })

    mockDb.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null
        })
      },
      from: vi.fn().mockReturnValue(profileQuery)
    })
    const serviceSupabase = {
      from: vi.fn().mockReturnValue(battleQuery)
    }
    mockServiceDb.mockReturnValue(serviceSupabase)
    mockGuildConfigGetBasic.mockResolvedValue({
      guild_code: canonicalGuild,
      cluster_code: 'EOT'
    })

    const response = await GET(
      new Request(
        `http://localhost/api/members/token-usage/battles?guild=${inputGuild}&seasons=100,99&rarities=Legendary,Mythic`
      )
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(battleRows)
    expect(mockGuildConfigGetBasic).toHaveBeenCalledWith(
      serviceSupabase,
      inputGuild
    )
    expect(battleQuery.eq).toHaveBeenCalledWith('Guild', canonicalGuild)
    expect(battleQuery.in).toHaveBeenCalledWith('Season', ['100', '99'])
    expect(battleQuery.in).toHaveBeenCalledWith('rarity', [
      'Legendary',
      'Mythic'
    ])
  })

  it('fails closed when auth lookup errors', async () => {
    mockDb.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockRejectedValue(new Error('Unexpected auth failure'))
      },
      from: vi.fn()
    })

    const response = await GET(
      new Request(
        'http://localhost/api/members/token-usage/battles?guild=TEST&seasons=100'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error.message).toBe('Authentication check failed')
    expect(mockServiceDb).not.toHaveBeenCalled()
  })
})

function createProfileQuery(data: Record<string, unknown> | null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn().mockResolvedValue({ data, error: null })
  }
  return query
}

function createBattleQuery(
  result:
    | { data: Record<string, unknown>[]; error: null }
    | { data: null; error: { message: string } }
) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn().mockResolvedValue(result)
  }
  return query
}
