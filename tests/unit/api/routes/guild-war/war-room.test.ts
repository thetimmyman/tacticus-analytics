import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

interface QueryResult {
  data: unknown
  error: { code?: string; message?: string } | null
}

interface QueryChain {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  range: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  then: (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise<unknown>
}

let mockActiveMembership: ReturnType<typeof vi.fn>
let mockLeadership: ReturnType<typeof vi.fn>
let mockDb: ReturnType<typeof vi.fn>
let mockRpc: ReturnType<typeof vi.fn>
let mockApiSecurity: ReturnType<typeof vi.fn>
let queryChains: QueryChain[]

function makeQueryChain(result: QueryResult): QueryChain {
  const chain = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    range: vi.fn(),
    order: vi.fn(),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject)
  } as QueryChain

  chain.select.mockReturnValue(chain)
  chain.insert.mockReturnValue(chain)
  chain.update.mockReturnValue(chain)
  chain.delete.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.in.mockReturnValue(chain)
  chain.range.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  return chain
}

const teamRow = {
  id: '10000000-0000-4000-8000-000000000001',
  guild_code: 'TEST',
  name: 'Ork swarm',
  side: 'offense',
  priority: 2,
  notes: 'Hold the center',
  heroes: [{ unitId: 'alpha', role: 'core' }],
  created_at: '2026-09-25T00:00:00.000Z',
  updated_at: '2026-09-25T00:00:00.000Z'
}

describe('/api/guild-war/war-room', () => {
  let GET: (request: NextRequest) => Promise<Response>
  let POST: (request: NextRequest) => Promise<Response>
  let PATCH: (request: NextRequest) => Promise<Response>
  let DELETE: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    queryChains = []

    mockActiveMembership = vi.fn().mockResolvedValue({
      user: { id: '20000000-0000-4000-8000-000000000002' },
      profile: { role: 'member', guild_code: 'TEST', player_id: 'PLAYER-1' }
    })
    mockLeadership = vi.fn().mockResolvedValue({
      user: { id: '20000000-0000-4000-8000-000000000001' },
      profile: { role: 'officer', guild_code: 'TEST' }
    })
    mockApiSecurity = vi.fn().mockResolvedValue(null)

    vi.doMock('@/app/lib/auth', () => ({
      AuthError,
      requireActiveMembershipForApi: mockActiveMembership,
      requireRoleForApi: mockLeadership
    }))
    vi.doMock('@/app/lib/middleware/api-security-middleware', () => ({
      apiSecurityMiddleware: mockApiSecurity
    }))
    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: () => ({
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      })
    }))

    mockRpc = vi.fn().mockResolvedValue({ data: [], error: null })
    mockDb = vi.fn(async () => ({
      from: vi.fn(() => {
        const chain = makeQueryChain({ data: [teamRow], error: null })
        queryChains.push(chain)
        return chain
      }),
      rpc: mockRpc
    }))
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))

    const { withErrorHandlerMock } =
      await import('@/tests/helpers/mock-error-handler')
    vi.doMock('@/app/lib/middleware/errorHandler', () => withErrorHandlerMock)

    const route = await import('@/app/api/guild-war/war-room/route')
    GET = route.GET
    POST = route.POST
    PATCH = route.PATCH
    DELETE = route.DELETE
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    body?: unknown,
    searchParams?: Record<string, string>
  ): NextRequest {
    const url = new URL('http://localhost/api/guild-war/war-room')
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      url.searchParams.set(key, value)
    }
    return new NextRequest(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body)
    })
  }

  function setQueryResult(result: QueryResult) {
    mockDb.mockResolvedValue({
      from: vi.fn(() => {
        const chain = makeQueryChain(result)
        queryChains.push(chain)
        return chain
      }),
      rpc: mockRpc
    })
  }

  it('requires authentication for member reads', async () => {
    mockActiveMembership.mockRejectedValue(
      Object.assign(
        new AuthError('Authentication required', 'UNAUTHENTICATED'),
        { status: 401 }
      )
    )

    const response = await GET(request('GET'))

    expect(response.status).toBe(401)
    expect(mockDb).not.toHaveBeenCalled()
  })

  it('applies the shared rate limit before resolving the member', async () => {
    mockApiSecurity.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    const response = await GET(request('GET'))

    expect(response.status).toBe(429)
    expect(mockActiveMembership).not.toHaveBeenCalled()
  })

  it('reads shared teams, readiness, and usage for the active guild', async () => {
    const response = await GET(request('GET'))
    const body = await response.json()
    // The guild-picker scan runs first; the teams read is the eq() chain.
    const chain = queryChains.find((c) => c.eq.mock.calls.length > 0)!

    expect(response.status).toBe(200)
    expect(body).toEqual({
      guildCode: 'TEST',
      ownGuildCode: 'TEST',
      isOwnGuild: true,
      guilds: [{ guildCode: 'TEST', label: 'TEST', teamCount: 1 }],
      minRankIndex: 9,
      teams: [teamRow],
      readiness: [],
      usage: [],
      myUsage: []
    })
    expect(chain.select).toHaveBeenCalledWith(
      'id, guild_code, name, side, priority, notes, heroes, created_at, updated_at'
    )
    expect(chain.eq).toHaveBeenCalledWith('guild_code', 'TEST')
    expect(chain.order).toHaveBeenCalledWith('side', { ascending: true })
    expect(chain.order).toHaveBeenCalledWith('priority', {
      ascending: true,
      nullsFirst: false
    })
    expect(mockRpc).toHaveBeenCalledWith('get_war_room_team_readiness', {
      p_guild_code: 'TEST',
      p_min_rank_index: 9
    })
    expect(mockRpc).toHaveBeenCalledWith('get_guild_war_hero_usage', {
      p_guild_code: 'TEST'
    })
  })

  it('reads another guild shared teams without readiness or usage', async () => {
    const response = await GET(request('GET', undefined, { guild: 'OTHER' }))
    const body = await response.json()
    const chain = queryChains.find((c) => c.eq.mock.calls.length > 0)!

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      guildCode: 'OTHER',
      ownGuildCode: 'TEST',
      isOwnGuild: false,
      teams: [teamRow],
      readiness: [],
      usage: [],
      myUsage: []
    })
    expect(chain.eq).toHaveBeenCalledWith('guild_code', 'OTHER')
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('requires a current guild membership to browse', async () => {
    mockActiveMembership.mockRejectedValue(
      Object.assign(
        new AuthError(
          'Current guild membership required',
          'ONBOARDING_REQUIRED'
        ),
        { status: 403 }
      )
    )

    const response = await GET(request('GET', undefined, { guild: 'OTHER' }))

    expect(response.status).toBe(403)
    expect(mockDb).not.toHaveBeenCalled()
  })

  it('lists only the own guild when no readable guild has teams', async () => {
    setQueryResult({ data: [], error: null })

    const response = await GET(request('GET'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      guildCode: 'TEST',
      isOwnGuild: true,
      guilds: [{ guildCode: 'TEST', label: 'TEST', teamCount: 0 }],
      teams: []
    })
  })

  it('pages the guild scan past a full page of team rows', async () => {
    const fullPage = Array.from({ length: 1000 }, () => ({
      guild_code: 'TEST'
    }))
    const pages = [fullPage, [{ guild_code: 'OTHER' }]]
    const rangeCalls: Array<[number, number]> = []
    mockDb.mockResolvedValue({
      from: vi.fn((table: string) => {
        const chain = makeQueryChain({ data: [teamRow], error: null })
        if (table === 'guild_war_meta_teams') {
          chain.range.mockImplementation((from: number, to: number) => {
            rangeCalls.push([from, to])
            return makeQueryChain({
              data: pages[rangeCalls.length - 1] ?? [],
              error: null
            })
          })
        }
        if (table === 'guild_config') {
          chain.in.mockReturnValue(makeQueryChain({ data: [], error: null }))
        }
        queryChains.push(chain)
        return chain
      }),
      rpc: mockRpc
    })

    const response = await GET(request('GET'))
    const body = await response.json()

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999]
    ])
    expect(body.guilds).toEqual([
      { guildCode: 'TEST', label: 'TEST', teamCount: 1000 },
      { guildCode: 'OTHER', label: 'OTHER', teamCount: 1 }
    ])
  })

  it('treats an explicit own-guild request as the own guild', async () => {
    const response = await GET(request('GET', undefined, { guild: 'TEST' }))
    const body = await response.json()

    expect(body.isOwnGuild).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('get_guild_war_hero_usage', {
      p_guild_code: 'TEST'
    })
  })

  it('rejects a malformed guild code', async () => {
    const response = await GET(
      request('GET', undefined, { guild: "TEST' OR 1=1" })
    )

    expect(response.status).toBe(400)
    expect(mockDb).not.toHaveBeenCalled()
  })

  it.each([
    ['POST', request('POST', { name: 'Blocked' })],
    [
      'PATCH',
      request('PATCH', {
        id: '10000000-0000-4000-8000-000000000001',
        name: 'Blocked'
      })
    ],
    [
      'DELETE',
      request('DELETE', undefined, {
        id: '10000000-0000-4000-8000-000000000001'
      })
    ]
  ])('requires leadership for %s', async (method, mutationRequest) => {
    mockLeadership.mockRejectedValue(
      Object.assign(
        new AuthError(
          'Insufficient permissions. Required: officer, Current: member',
          'INSUFFICIENT_ROLE',
          'officer',
          'member'
        ),
        { status: 403 }
      )
    )

    const handler =
      method === 'POST' ? POST : method === 'PATCH' ? PATCH : DELETE
    const response = await handler(mutationRequest)

    expect(response.status).toBe(403)
    expect(mockDb).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON', async () => {
    const malformed = new NextRequest(
      'http://localhost/api/guild-war/war-room',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{'
      }
    )

    const response = await POST(malformed)

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Invalid JSON body')
  })

  it.each([
    ['a non-object body', null, 'JSON object'],
    [
      'a blank name',
      { name: '   ', heroes: [{ unitId: 'alpha', role: 'core' }] },
      'Team name is required'
    ],
    [
      'an invalid side',
      { name: 'Alpha', side: 'sideways' },
      'Side must be offense or defense'
    ],
    [
      'an out-of-range priority',
      { name: 'Alpha', priority: 100 },
      'Priority must be an integer'
    ],
    ['an empty hero list', { name: 'Alpha', heroes: [] }, 'At least one hero'],
    ['an omitted hero list', { name: 'Alpha' }, 'At least one hero'],
    [
      'an unknown hero role',
      { name: 'Alpha', heroes: [{ unitId: 'alpha', role: 'boss' }] },
      'Hero role must be core, flex or mow'
    ],
    [
      'a duplicate hero',
      {
        name: 'Alpha',
        heroes: [
          { unitId: 'alpha', role: 'core' },
          { unitId: 'alpha', role: 'flex' }
        ]
      },
      'Duplicate hero alpha'
    ]
  ])('rejects %s', async (_label, body, message) => {
    const response = await POST(request('POST', body))

    expect(response.status).toBe(400)
    expect(await response.text()).toContain(message)
    expect(mockDb).not.toHaveBeenCalled()
  })

  it('creates a shared team in the leadership guild', async () => {
    setQueryResult({ data: teamRow, error: null })
    const body = {
      name: 'Ork swarm',
      side: 'offense',
      priority: 2,
      notes: 'Hold the center',
      heroes: [
        { unitId: 'alpha', role: 'core' },
        { unitId: 'beta', role: 'flex' }
      ]
    }
    const response = await POST(request('POST', body))
    const chain = queryChains[0]!

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ team: teamRow })
    expect(chain.select).toHaveBeenCalledWith(
      'id, guild_code, name, side, priority, notes, heroes, created_at, updated_at'
    )
    expect(chain.insert).toHaveBeenCalledWith({
      guild_code: 'TEST',
      name: 'Ork swarm',
      side: 'offense',
      priority: 2,
      notes: 'Hold the center',
      heroes: body.heroes,
      created_by: '20000000-0000-4000-8000-000000000001'
    })
  })

  it('stores only trimmed {unitId, role} for each hero', async () => {
    setQueryResult({ data: teamRow, error: null })
    const response = await POST(
      request('POST', {
        name: 'Ork swarm',
        side: 'offense',
        heroes: [
          { unitId: '  alpha ', role: 'core', payload: 'x'.repeat(1000) },
          { unitId: 'beta', role: 'mow', extra: { nested: true } }
        ]
      })
    )
    const chain = queryChains[0]!

    expect(response.status).toBe(201)
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        heroes: [
          { unitId: 'alpha', role: 'core' },
          { unitId: 'beta', role: 'mow' }
        ]
      })
    )
  })

  it('maps a duplicate team name to validation failure', async () => {
    setQueryResult({
      data: null,
      error: { code: '23505', message: 'duplicate key' }
    })

    const response = await POST(
      request('POST', {
        name: 'Ork swarm',
        heroes: [{ unitId: 'alpha', role: 'core' }]
      })
    )

    expect(response.status).toBe(400)
    expect(await response.text()).toContain(
      'team with that name already exists'
    )
  })

  it('updates only the selected team in the active guild', async () => {
    setQueryResult({ data: teamRow, error: null })
    const id = '10000000-0000-4000-8000-000000000001'
    const response = await PATCH(
      request('PATCH', {
        id,
        notes: 'Updated',
        heroes: [{ unitId: 'alpha', role: 'flex' }]
      })
    )
    const chain = queryChains[0]!

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ team: teamRow })
    expect(chain.select).toHaveBeenCalledWith(
      'id, guild_code, name, side, priority, notes, heroes, created_at, updated_at'
    )
    expect(chain.update).toHaveBeenCalledWith({
      notes: 'Updated',
      heroes: [{ unitId: 'alpha', role: 'flex' }]
    })
    expect(chain.eq).toHaveBeenNthCalledWith(1, 'id', id)
    expect(chain.eq).toHaveBeenNthCalledWith(2, 'guild_code', 'TEST')
  })

  it('allows an update to omit heroes', async () => {
    setQueryResult({ data: teamRow, error: null })
    const response = await PATCH(
      request('PATCH', {
        id: teamRow.id,
        notes: 'Updated without changing heroes'
      })
    )
    const chain = queryChains[0]!

    expect(response.status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith({
      notes: 'Updated without changing heroes'
    })
  })

  it('requires an id for updates', async () => {
    const response = await PATCH(request('PATCH', { notes: 'Updated' }))

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Team id is required')
  })

  it('returns not found when updating a stale team id', async () => {
    setQueryResult({
      data: null,
      error: { code: 'PGRST116', message: 'not found' }
    })

    const response = await PATCH(
      request('PATCH', {
        id: '10000000-0000-4000-8000-000000000001',
        notes: 'Updated'
      })
    )

    expect(response.status).toBe(404)
  })

  it('deletes only the selected team in the active guild', async () => {
    setQueryResult({ data: { id: teamRow.id }, error: null })
    const id = '10000000-0000-4000-8000-000000000001'
    const response = await DELETE(request('DELETE', undefined, { id }))
    const chain = queryChains[0]!

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenNthCalledWith(1, 'id', id)
    expect(chain.eq).toHaveBeenNthCalledWith(2, 'guild_code', 'TEST')
  })

  it('returns not found when deleting a stale team id', async () => {
    setQueryResult({ data: null, error: null })

    const response = await DELETE(
      request('DELETE', undefined, {
        id: '10000000-0000-4000-8000-000000000001'
      })
    )

    expect(response.status).toBe(404)
  })
})
