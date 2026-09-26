import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockDb: ReturnType<typeof vi.fn>
let mockRequireGuildMember: ReturnType<typeof vi.fn>
let mockGetLatestSeason: ReturnType<typeof vi.fn>

const emptySnapshot = {
  guild_config: null,
  herald_meta_role_mapping: [],
  herald_boss_config: []
}

const makeListClient = () => {
  const versions = [
    {
      id: 1,
      guild_code: 'GUILD1',
      season: null,
      is_default: true,
      created_at: '2026-05-29T10:00:00.000Z'
    },
    {
      id: 2,
      guild_code: 'GUILD1',
      season: 98,
      is_default: false,
      created_at: '2026-05-29T11:00:00.000Z'
    }
  ]
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  let orderCalls = 0
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.order = vi.fn(() => {
    orderCalls += 1
    return orderCalls >= 2
      ? Promise.resolve({ data: versions, error: null })
      : query
  })

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } }))
    },
    from: vi.fn(() => query),
    // Negative probe: the season comes from getLatestSeason, never this RPC.
    rpc: vi.fn(async () => ({ data: '99', error: null })),
    __query: query
  }
}

const makeDefaultUpdateClient = () => {
  const lookupQuery: Record<string, ReturnType<typeof vi.fn>> = {}
  lookupQuery.select = vi.fn(() => lookupQuery)
  lookupQuery.eq = vi.fn(() => lookupQuery)
  lookupQuery.maybeSingle = vi.fn(async () => ({
    data: { id: 7 },
    error: null
  }))

  const updateQuery: Record<string, ReturnType<typeof vi.fn>> = {}
  updateQuery.update = vi.fn(() => updateQuery)
  updateQuery.eq = vi.fn(() => updateQuery)
  updateQuery.select = vi.fn(() => updateQuery)
  updateQuery.single = vi.fn(async () => ({
    data: {
      id: 7,
      guild_code: 'GUILD1',
      season: null,
      is_default: true,
      created_at: '2026-05-29T12:00:00.000Z'
    },
    error: null
  }))

  let heraldVersionCalls = 0

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } }))
    },
    from: vi.fn((table: string) => {
      if (table !== 'herald_config_versions') return {}
      heraldVersionCalls += 1
      return heraldVersionCalls === 1 ? lookupQuery : updateQuery
    }),
    __lookupQuery: lookupQuery,
    __updateQuery: updateQuery
  }
}

describe('GET /api/herald/config-versions (WI-735)', () => {
  beforeEach(() => {
    vi.resetModules()
    mockRequireGuildMember = vi.fn(async () => ({
      role: 'officer',
      guild_code: 'GUILD1'
    }))
    vi.doMock('@/app/lib/auth/guild-permissions', () => ({
      requireGuildMember: mockRequireGuildMember,
      requireGuildOfficerOrClusterLeader: vi.fn()
    }))
    mockGetLatestSeason = vi.fn(async () => '99')
    vi.doMock('@/app/lib/data/get-latest-season', () => ({
      getLatestSeason: mockGetLatestSeason
    }))
  })

  it('lists saved config versions with the latest season', async () => {
    const client = makeListClient()
    mockDb = vi.fn(async () => client)
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))

    const mod = await import('@/app/api/herald/config-versions/route')
    const response = await mod.GET(
      new Request(
        'http://localhost/api/herald/config-versions?guild_code=GUILD1&list=1'
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.latest_season).toBe('99')
    expect(body.versions).toEqual([
      {
        id: 1,
        guild_code: 'GUILD1',
        season: null,
        is_default: true,
        created_at: '2026-05-29T10:00:00.000Z'
      },
      {
        id: 2,
        guild_code: 'GUILD1',
        season: 98,
        is_default: false,
        created_at: '2026-05-29T11:00:00.000Z'
      }
    ])
    expect(client.__query.eq).toHaveBeenCalledWith('guild_code', 'GUILD1')
    expect(mockGetLatestSeason).toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('still lists versions with latest_season null when the season is unresolvable', async () => {
    mockGetLatestSeason = vi.fn(async () => null)
    vi.doMock('@/app/lib/data/get-latest-season', () => ({
      getLatestSeason: mockGetLatestSeason
    }))
    const client = makeListClient()
    mockDb = vi.fn(async () => client)
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))

    const mod = await import('@/app/api/herald/config-versions/route')
    const response = await mod.GET(
      new Request(
        'http://localhost/api/herald/config-versions?guild_code=GUILD1&list=1'
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.latest_season).toBeNull()
    expect(body.versions).toHaveLength(2)
  })

  it('updates an existing default snapshot without partial-index upsert', async () => {
    const client = makeDefaultUpdateClient()
    mockDb = vi.fn(async () => client)
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))

    const mod = await import('@/app/api/herald/config-versions/route')
    const response = await mod.POST(
      new Request('http://localhost/api/herald/config-versions', {
        method: 'POST',
        body: JSON.stringify({
          guild_code: 'GUILD1',
          is_default: true,
          snapshot: emptySnapshot
        })
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.version).toMatchObject({ id: 7, is_default: true })
    expect(client.__lookupQuery.eq).toHaveBeenCalledWith('guild_code', 'GUILD1')
    expect(client.__lookupQuery.eq).toHaveBeenCalledWith('is_default', true)
    expect(client.__updateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        guild_code: 'GUILD1',
        season: null,
        is_default: true
      })
    )
    expect(client.__updateQuery.eq).toHaveBeenCalledWith('id', 7)
  })
})
