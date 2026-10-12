import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PostgrestClient } from '@supabase/postgrest-js'

const state = vi.hoisted(() => ({
  role: 'member',
  current: true,
  active: true,
  guild: 'TEST',
  user: { id: '11111111-1111-4111-8111-111111111111' } as { id: string } | null,
  membershipReads: 0,
  finalRole: null as string | null,
  finalGuild: null as string | null,
  failure: null as string | null,
  stalled: null as string | null,
  authPending: null as Promise<unknown> | null,
  authCalls: 0,
  transport: null as string | null,
  overrides: {} as Record<string, unknown>,
  banned: false,
  stage: 'public' as string | null,
  rpcReply: undefined as unknown,
  readbackFailure: false,
  swapOnRead: false,
  readReply: undefined as unknown,
  stallCommittedResponse: false,
  assignments: [] as Record<string, unknown>[],
  bosses: [] as Record<string, unknown>[],
  requests: [] as {
    table: string
    method: string
    url: URL
    body: unknown
    signal?: AbortSignal | null
    privileged: boolean
  }[]
}))

vi.mock('@/app/lib/db', () => ({
  db: async () => client,
  serviceDb: () => banClient
}))
vi.unmock('@/app/lib/auth/user-bans')

const AS_OF = '2026-06-02T08:00:00.000Z'
type Row = Record<string, unknown>
const isRow = (x: unknown): x is Row =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

function rows(table: string, privileged: boolean): unknown {
  if (!privileged && Object.hasOwn(state.overrides, table))
    return state.overrides[table]
  if (table === 'user_bans')
    return state.banned
      ? [
          {
            id: 'synthetic-ban',
            ban_group_id: 'synthetic-group',
            auth_user_id: state.user?.id,
            subject_type: 'user_id',
            subject_value: state.user?.id,
            lifted_at: null,
            expires_at: null
          }
        ]
      : []
  if (table === 'current_user_player_mapping')
    return [
      {
        user_id: state.user?.id,
        player_id: 'SYNQUEUE1',
        guild_code:
          ++state.membershipReads > 1
            ? (state.finalGuild ?? state.guild)
            : state.guild,
        role:
          state.membershipReads > 1
            ? (state.finalRole ?? state.role)
            : state.role,
        is_current: state.current,
        is_active: state.active
      }
    ]
  if (table === 'rpc/get_distinct_seasons_for_guild')
    return ['101', '102', '9999']
  if (table === 'feature_releases')
    return state.stage === null
      ? []
      : [{ feature_key: 'boss_assignments', release_stage: state.stage }]
  if (table === 'upcoming_season_assignments') return state.assignments
  if (table === 'upcoming_season_bosses') return state.bosses
  if (table === 'player_mapping')
    return [
      {
        player_id: 'SYNQUEUE1',
        display_name: 'Synthetic member',
        guild_code: 'TEST',
        is_current: true,
        is_active: true,
        primary_boss: 'Old global preference'
      }
    ]
  if (table === 'EOT_GR_data')
    return [
      {
        Guild: 'TEST',
        Season: '101',
        userId: 'SYNQUEUE1',
        displayName: 'Synthetic member',
        damageType: 'Battle',
        startedOn: '2026-06-01T09:00:00.000Z'
      }
    ]
  throw new Error('Unexpected synthetic relation')
}

const adapter: typeof fetch = async (input, init) => {
  const url = new URL(String(input))
  const table = url.pathname.replace('/rest/v1/', '')
  const method = init?.method ?? 'GET'
  const privileged =
    new Headers(init?.headers).get('X-Synthetic-Authority') === 'ban'
  if (privileged && !['user_bans', 'player_mapping'].includes(table))
    throw new Error('Privileged assignment reads forbidden')
  state.requests.push({
    table,
    method,
    url,
    body: init?.body ? JSON.parse(String(init.body)) : null,
    signal: init?.signal,
    privileged
  })
  if (table === state.transport && !privileged)
    throw new TypeError('Synthetic private transport failure')
  if (table === state.stalled)
    return new Promise((_, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true }
      )
    })
  if (table === state.failure)
    return new Response(
      JSON.stringify({
        code: '42501',
        message: 'Synthetic private read failure'
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    )
  if (table === 'rpc/desktop_get_saved_assignments') {
    const params: unknown = JSON.parse(String(init?.body))
    if (!isRow(params)) throw new Error('Malformed synthetic saved read')
    const snapshot = {
      assignments: state.assignments.filter(
        (row) => row.season_number === params.p_season_number
      ),
      bosses: state.bosses.filter(
        (row) => row.season_number === params.p_season_number
      )
    }
    if (state.swapOnRead) swapIntent()
    return new Response(
      JSON.stringify(
        state.readReply === undefined ? snapshot : state.readReply
      ),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }
  if (table.startsWith('rpc/desktop_') && state.rpcReply !== undefined)
    return new Response(JSON.stringify(state.rpcReply), {
      headers: { 'Content-Type': 'application/json' }
    })
  if (table === 'rpc/desktop_replace_saved_assignments') {
    const body: unknown = JSON.parse(String(init?.body))
    if (
      !isRow(body) ||
      !Array.isArray(body.p_assignments) ||
      !Array.isArray(body.p_bosses)
    )
      throw new Error('Malformed synthetic RPC')
    state.assignments = state.assignments.filter(
      (r) => r.season_number !== body.p_season_number
    )
    for (const row of body.p_assignments) {
      if (!isRow(row)) throw new Error('Malformed synthetic assignment')
      const total = isRow(row.token_allocations)
        ? Object.values(row.token_allocations).reduce<number>(
            (sum, n) => sum + Number(n),
            0
          )
        : 0
      state.assignments.push({
        ...row,
        guild_code: 'TEST',
        season_number: body.p_season_number,
        display_name: 'Synthetic member',
        primary_boss: null,
        secondary_boss: null,
        uses_flexible_tokens: true,
        total_tokens_allocated: total,
        assigned_at: AS_OF,
        updated_at: AS_OF
      })
    }
    state.bosses = state.bosses.filter(
      (r) => r.season_number !== body.p_season_number
    )
    for (const row of body.p_bosses) {
      if (!isRow(row)) throw new Error('Malformed synthetic boss')
      state.bosses.push({
        ...row,
        guild_code: 'TEST',
        season_number: body.p_season_number,
        selected_at: AS_OF
      })
    }
    if (state.readbackFailure)
      state.failure = 'rpc/desktop_get_saved_assignments'
    if (state.stallCommittedResponse)
      return new Promise((_, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        )
      })
    const saved = state.assignments.filter(
      (r) => r.season_number === body.p_season_number
    )
    return new Response(
      JSON.stringify({
        assignedCount: saved.filter((r) => Number(r.total_tokens_allocated) > 0)
          .length,
        totalPlayers: saved.length,
        totalTokens: saved.reduce(
          (sum, row) => sum + Number(row.total_tokens_allocated),
          0
        )
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }
  if (table === 'rpc/desktop_clear_saved_assignments') {
    const body: unknown = JSON.parse(String(init?.body))
    if (!isRow(body)) throw new Error('Malformed synthetic clear')
    const assignmentsDeleted = state.assignments.filter(
      (r) => r.season_number === body.p_season_number
    ).length
    const bossesDeleted = state.bosses.filter(
      (r) => r.season_number === body.p_season_number
    ).length
    state.assignments = state.assignments.filter(
      (r) => r.season_number !== body.p_season_number
    )
    state.bosses = state.bosses.filter(
      (r) => r.season_number !== body.p_season_number
    )
    return new Response(JSON.stringify({ assignmentsDeleted, bossesDeleted }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
  let data = rows(table, privileged)
  if (table === 'upcoming_season_assignments' && state.swapOnRead) swapIntent()
  if (Array.isArray(data) && !table.startsWith('rpc/')) {
    if (!data.every(isRow)) throw new Error('Malformed synthetic rows')
    let filtered = data
    for (const [key, value] of url.searchParams) {
      if (value.startsWith('eq.'))
        filtered = filtered.filter((row) => String(row[key]) === value.slice(3))
      if (value.startsWith('gte.'))
        filtered = filtered.filter((row) => String(row[key]) >= value.slice(4))
      if (value.startsWith('lte.'))
        filtered = filtered.filter((row) => String(row[key]) <= value.slice(4))
    }
    data =
      new Headers(init?.headers).get('Accept') ===
      'application/vnd.pgrst.object+json'
        ? (filtered[0] ?? null)
        : filtered
  }
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  })
}
const pg = new PostgrestClient('http://127.0.0.1:3001/rest/v1', {
  fetch: adapter
})
const client = {
  from: pg.from.bind(pg),
  rpc: pg.rpc.bind(pg),
  auth: {
    getUser: async () => {
      state.authCalls++
      if (state.authPending) return state.authPending
      return { data: { user: state.user }, error: null }
    }
  }
}
const banPg = new PostgrestClient('http://127.0.0.1:3001/rest/v1', {
  fetch: adapter,
  headers: { 'X-Synthetic-Authority': 'ban' }
})
const banClient = { from: banPg.from.bind(banPg) }

function request(
  method = 'GET',
  body?: unknown,
  query = 'season_number=101',
  signal?: AbortSignal
) {
  return new NextRequest(
    `http://localhost/api/guild-raid/saved-assignments?${query}`,
    {
      method,
      signal,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' }
          })
    }
  )
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
  Object.assign(state, {
    role: 'member',
    current: true,
    active: true,
    guild: 'TEST',
    user: { id: '11111111-1111-4111-8111-111111111111' },
    membershipReads: 0,
    finalRole: null,
    finalGuild: null,
    failure: null,
    stalled: null,
    authPending: null,
    authCalls: 0,
    transport: null,
    overrides: {},
    banned: false,
    stage: 'public',
    rpcReply: undefined,
    readbackFailure: false,
    swapOnRead: false,
    readReply: undefined,
    stallCommittedResponse: false,
    assignments: [],
    bosses: [],
    requests: []
  })
})

function replacement() {
  return {
    asOf: AS_OF,
    bosses: [
      {
        level: 'L1',
        boss_name: 'Riptide',
        sub_bosses: { sub1: '', sub2: '', sub1_skip: false, sub2_skip: false }
      }
    ],
    assignments: [{ player_id: 'SYNQUEUE1', token_allocations: { L1: 1 } }]
  }
}

describe('saved assignment admission', () => {
  it.each([
    '',
    'season_number=0',
    'season_number=01',
    'season_number=101&season_number=102',
    'season_number=101&guild=OTHER',
    'season_number=101&mode=current'
  ])(
    'rejects unsupported or ambiguous query %s before signed reads',
    async (query) => {
      const { GET } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      expect((await GET(request('GET', undefined, query))).status).toBe(400)
      expect(state.authCalls).toBe(0)
    }
  )
  it.each(['9999', '103'])(
    'refuses unavailable captured/imported season %s without intent or live reads',
    async (season) => {
      const { GET } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      expect(
        (await GET(request('GET', undefined, `season_number=${season}`))).status
      ).toBe(422)
      expect(state.requests.some((r) => r.table.startsWith('upcoming_'))).toBe(
        false
      )
    }
  )
  it.each([null, 'coming_soon', 'alpha', 'beta'])(
    'denies unadmitted local capability %s',
    async (stage) => {
      state.stage = stage
      const { GET } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      expect((await GET(request())).status).toBe(403)
      expect(state.requests.some((r) => r.table.startsWith('upcoming_'))).toBe(
        false
      )
    }
  )
  it.each(['member', 'admin', 'Officer', 'Leader'])(
    'does not let role %s replace or clear',
    async (role) => {
      state.role = role
      const { PUT, DELETE } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      expect((await PUT(request('PUT', replacement()))).status).toBe(403)
      expect((await DELETE(request('DELETE'))).status).toBe(403)
      expect(
        state.requests.some((r) => r.table.startsWith('rpc/desktop_'))
      ).toBe(false)
    }
  )
  it.each(['officer', 'leader'])(
    'uses fresh role downgrade to refuse %s mutation before RPC',
    async (role) => {
      state.role = role
      state.finalRole = 'member'
      const { PUT } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      expect((await PUT(request('PUT', replacement()))).status).toBe(403)
      expect(
        state.requests.some((r) => r.table.startsWith('rpc/desktop_'))
      ).toBe(false)
    }
  )
  it('refuses a caller transferred to another guild near read serialization', async () => {
    state.finalGuild = 'OTHER'
    const { GET } = await import('@/app/api/guild-raid/saved-assignments/route')
    expect((await GET(request())).status).toBe(403)
  })
  it.each(['current', 'active'] as const)(
    'refuses missing fresh %s membership',
    async (key) => {
      state[key] = false
      const { GET } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      expect((await GET(request())).status).toBe(403)
    }
  )
  it('preserves real canonical session and immutable-subject ban refusal', async () => {
    state.banned = true
    const { GET } = await import('@/app/api/guild-raid/saved-assignments/route')
    expect((await GET(request())).status).toBe(403)
    expect(state.requests.filter((r) => !r.privileged)).toHaveLength(0)
    state.banned = false
    state.user = null
    expect((await GET(request())).status).toBe(401)
  })
  it('does not provide hosted methods or a not-yet-admitted solver POST', async () => {
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'hosted')
    const route = await import('@/app/api/guild-raid/saved-assignments/route')
    for (const method of ['GET', 'PUT', 'DELETE'] as const)
      expect(
        (
          await route[method](
            request(method, method === 'PUT' ? replacement() : undefined)
          )
        ).status
      ).toBe(405)
    expect('POST' in route).toBe(false)
    expect(state.authCalls).toBe(0)
  })
  it('rejects a malformed persisted row instead of returning opaque private fields', async () => {
    state.assignments = [
      {
        guild_code: 'TEST',
        season_number: '101',
        player_id: 'SYNQUEUE1',
        token_allocations: { L1: 'private-canary' }
      }
    ]
    const { GET } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private-canary')
  })
  it('rejects malformed RPC metadata without returning private diagnostics or optimistic success', async () => {
    state.role = 'officer'
    state.rpcReply = { totalPlayers: 'private-canary' }
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await PUT(request('PUT', replacement()))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private-canary')
  })
  it('maps a real signed mutation ACL refusal to static forbidden without raw diagnostics', async () => {
    state.role = 'officer'
    state.failure = 'rpc/desktop_replace_saved_assignments'
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await PUT(request('PUT', replacement()))
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('private read failure')
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('signed saved assignment intent', () => {
  it('a member reads authoritative empty saved state without resurrecting global preferences', async () => {
    const { GET } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      source: 'saved-local',
      season: '101',
      assignments: [],
      bosses: [],
      canReplace: false,
      canClear: false
    })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(
      state.requests.some((r) => r.table === 'player_mapping' && !r.privileged)
    ).toBe(false)
    expect(
      state.requests
        .filter((r) => !r.privileged)
        .every(
          (r) =>
            r.method === 'GET' ||
            r.table === 'rpc/get_distinct_seasons_for_guild' ||
            r.table === 'rpc/desktop_get_saved_assignments'
        )
    ).toBe(true)
  })
  it('a lowercase officer replaces complete selected-season intent through signed RPC and reads back actual saved state', async () => {
    state.role = 'officer'
    state.assignments = [
      { guild_code: 'TEST', season_number: '101', player_id: 'SYNQUEUE2' },
      { guild_code: 'TEST', season_number: '102', player_id: 'SYNOTHER' }
    ]
    state.bosses = [
      { guild_code: 'TEST', season_number: '101', level: 'L2' },
      { guild_code: 'TEST', season_number: '102', level: 'L1' }
    ]
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await PUT(
      request('PUT', {
        asOf: AS_OF,
        bosses: [
          {
            level: 'L1',
            boss_name: 'Riptide',
            sub_bosses: {
              sub1: '',
              sub2: '',
              sub1_skip: false,
              sub2_skip: false
            }
          }
        ],
        assignments: [{ player_id: 'SYNQUEUE1', token_allocations: { L1: 1 } }]
      })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      source: 'saved-local',
      season: '101',
      summary: { assignedCount: 1, totalPlayers: 1, totalTokens: 1 },
      assignments: [{ player_id: 'SYNQUEUE1', total_tokens_allocated: 1 }],
      bosses: [{ level: 'L1', boss_name: 'Riptide' }]
    })
    const writes = state.requests.filter(
      (r) => r.table === 'rpc/desktop_replace_saved_assignments'
    )
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      privileged: false,
      method: 'POST',
      body: {
        p_season_number: '101',
        p_assignments: [
          { player_id: 'SYNQUEUE1', token_allocations: { L1: 1 } }
        ]
      }
    })
    expect(writes[0]!.body).not.toHaveProperty('p_guild_code')
    expect(state.assignments.some((r) => r.player_id === 'SYNOTHER')).toBe(true)
    expect(state.bosses.some((r) => r.season_number === '102')).toBe(true)
  })
  it('clear removes both selected-season intents and an empty reload cannot fall back to global preferences', async () => {
    state.role = 'leader'
    state.assignments = [
      { guild_code: 'TEST', season_number: '101', player_id: 'SYNQUEUE1' },
      { guild_code: 'TEST', season_number: '102', player_id: 'SYNOTHER' }
    ]
    state.bosses = [
      { guild_code: 'TEST', season_number: '101', level: 'L1' },
      { guild_code: 'TEST', season_number: '102', level: 'L1' }
    ]
    const { DELETE, GET } =
      await import('@/app/api/guild-raid/saved-assignments/route')
    const first = await DELETE(request('DELETE'))
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({
      assignments: [],
      bosses: [],
      deleted: { assignmentsDeleted: 1, bossesDeleted: 1 }
    })
    const second = await DELETE(request('DELETE'))
    expect(await second.json()).toMatchObject({
      deleted: { assignmentsDeleted: 0, bossesDeleted: 0 }
    })
    expect(await (await GET(request())).json()).toMatchObject({
      assignments: [],
      bosses: []
    })
    expect(state.assignments).toEqual([
      { guild_code: 'TEST', season_number: '102', player_id: 'SYNOTHER' }
    ])
    expect(state.bosses).toEqual([
      { guild_code: 'TEST', season_number: '102', level: 'L1' }
    ])
    expect(
      state.requests
        .filter((r) => r.table === 'rpc/desktop_clear_saved_assignments')
        .map((r) => r.body)
    ).toEqual([{ p_season_number: '101' }, { p_season_number: '101' }])
  })
})

describe('saved replacement payload and canonical budget', () => {
  it.each([
    ['caller metadata', (body: Row) => ({ ...body, assigned_by: 'forged' })],
    [
      'missing assignments',
      (body: Row) => {
        const next = { ...body }
        delete next.assignments
        return next
      }
    ],
    [
      'player metadata',
      (body: Row) => ({
        ...body,
        assignments: [
          {
            player_id: 'SYNQUEUE1',
            token_allocations: { L1: 1 },
            display_name: 'forged'
          }
        ]
      })
    ],
    [
      'duplicate player',
      (body: Row) => ({
        ...body,
        assignments: [
          ...replacement().assignments,
          ...replacement().assignments
        ]
      })
    ],
    [
      'too many players',
      (body: Row) => ({
        ...body,
        assignments: Array.from({ length: 31 }, (_, i) => ({
          player_id: `SYN${i}`,
          token_allocations: {}
        }))
      })
    ],
    [
      'fractional allocation',
      (body: Row) => ({
        ...body,
        assignments: [
          { player_id: 'SYNQUEUE1', token_allocations: { L1: 0.5 } }
        ]
      })
    ],
    [
      'negative allocation',
      (body: Row) => ({
        ...body,
        assignments: [{ player_id: 'SYNQUEUE1', token_allocations: { L1: -1 } }]
      })
    ],
    [
      'unsafe allocation',
      (body: Row) => ({
        ...body,
        assignments: [
          {
            player_id: 'SYNQUEUE1',
            token_allocations: { L1: Number.MAX_SAFE_INTEGER + 1 }
          }
        ]
      })
    ],
    [
      'unknown target',
      (body: Row) => ({
        ...body,
        assignments: [{ player_id: 'SYNQUEUE1', token_allocations: { L9: 1 } }]
      })
    ],
    [
      'unselected prime',
      (body: Row) => ({
        ...body,
        assignments: [
          { player_id: 'SYNQUEUE1', token_allocations: { L1_Sub1: 1 } }
        ]
      })
    ],
    [
      'foreign player',
      (body: Row) => ({
        ...body,
        assignments: [{ player_id: 'SYNFOREIGN', token_allocations: { L1: 1 } }]
      })
    ],
    [
      'duplicate boss',
      (body: Row) => ({
        ...body,
        bosses: [...replacement().bosses, ...replacement().bosses]
      })
    ],
    [
      'prime identity',
      (body: Row) => ({
        ...body,
        bosses: [
          {
            ...replacement().bosses[0],
            sub_bosses: {
              sub1: 'Uncaptured',
              sub2: '',
              sub1_skip: false,
              sub2_skip: false
            }
          }
        ]
      })
    ],
    [
      'impossible calendar date',
      (body: Row) => ({ ...body, asOf: '2026-02-30T08:00:00.000Z' })
    ],
    [
      'offset instead of UTC',
      (body: Row) => ({ ...body, asOf: '2026-06-02T08:00:00+00:00' })
    ]
  ] as const)('refuses %s without an RPC mutation', async (_name, change) => {
    state.role = 'officer'
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await PUT(request('PUT', change(replacement())))
    expect(response.status).toBe(400)
    expect(state.requests.some((r) => r.table.startsWith('rpc/desktop_'))).toBe(
      false
    )
  })
  it.each([
    '2026-06-02T10:00:00.000Z',
    '2026-06-02T11:00:00.000Z',
    '2020-01-01T00:00:00.000Z'
  ])(
    'refuses outside/end-exclusive instant %s before mutation',
    async (asOf) => {
      state.role = 'officer'
      const { PUT } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      expect(
        (await PUT(request('PUT', { ...replacement(), asOf }))).status
      ).toBe(422)
      expect(
        state.requests.some((r) => r.table.startsWith('rpc/desktop_'))
      ).toBe(false)
    }
  )
  it('refuses a boss from another captured season', async () => {
    state.role = 'officer'
    const body = replacement()
    body.bosses[0]!.boss_name = 'Rogal Dorn'
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    expect((await PUT(request('PUT', body))).status).toBe(422)
    expect(state.requests.some((r) => r.table.startsWith('rpc/desktop_'))).toBe(
      false
    )
  })
  it.each([
    [AS_OF, 3, 4],
    ['2026-06-01T10:00:00.000Z', 4, 5]
  ] as const)(
    'uses canonical saved spendable cap at %s without a live overlay',
    async (asOf, allowed, refused) => {
      state.role = 'officer'
      const { PUT } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      const body = replacement()
      body.asOf = asOf
      body.assignments[0]!.token_allocations.L1 = allowed
      const positive = await PUT(request('PUT', body))
      expect(positive.status).toBe(200)
      expect(await positive.json()).toMatchObject({
        summary: { totalTokens: allowed }
      })
      const before = state.requests.filter((r) =>
        r.table.startsWith('rpc/desktop_')
      ).length
      body.assignments[0]!.token_allocations.L1 = refused
      expect((await PUT(request('PUT', body))).status).toBe(422)
      expect(
        state.requests.filter((r) => r.table.startsWith('rpc/desktop_'))
      ).toHaveLength(before)
      expect(
        state.requests
          .filter((r) => !r.privileged)
          .every((r) => !r.table.includes('live'))
      ).toBe(true)
    }
  )
  it('rejects a streamed oversize body even without Content-Length', async () => {
    state.role = 'officer'
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await PUT(
      new NextRequest(
        'http://localhost/api/guild-raid/saved-assignments?season_number=101',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: new Uint8Array(128 * 1024 + 1).fill(32)
        }
      )
    )
    expect(response.status).toBe(413)
    expect(state.requests.some((r) => r.table.startsWith('rpc/desktop_'))).toBe(
      false
    )
  })
  it('requires JSON media type without decoding or trusting a different body format', async () => {
    state.role = 'officer'
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await PUT(
      new NextRequest(
        'http://localhost/api/guild-raid/saved-assignments?season_number=101',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(replacement())
        }
      )
    )
    expect(response.status).toBe(415)
    expect(state.requests.some((r) => r.table.startsWith('rpc/desktop_'))).toBe(
      false
    )
  })
  it('rejects duplicate JSON keys rather than silently selecting the last allocation', async () => {
    state.role = 'officer'
    const text = JSON.stringify(replacement()).replace(
      '"L1":1',
      '"L1":4,"L1":1'
    )
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    expect(
      (
        await PUT(
          new NextRequest(
            'http://localhost/api/guild-raid/saved-assignments?season_number=101',
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: text
            }
          )
        )
      ).status
    ).toBe(400)
    expect(state.requests.some((r) => r.table.startsWith('rpc/desktop_'))).toBe(
      false
    )
  })
  it('rejects invalid UTF-8 as malformed input, not a service failure', async () => {
    state.role = 'officer'
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await PUT(
      new NextRequest(
        'http://localhost/api/guild-raid/saved-assignments?season_number=101',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: new Uint8Array([0xc3, 0x28])
        }
      )
    )
    expect(response.status).toBe(400)
  })
})

describe('saved assignment failure and interruption boundaries', () => {
  it.each([
    'current_user_player_mapping',
    'rpc/get_distinct_seasons_for_guild',
    'feature_releases',
    'rpc/desktop_get_saved_assignments'
  ])(
    'fails closed on signed %s ACL errors without retry or fallback',
    async (table) => {
      state.failure = table
      const { GET } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      const response = await GET(request())
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('Synthetic private')
      expect(
        state.requests.filter((r) => r.table === table && !r.privileged)
      ).toHaveLength(1)
      expect(
        state.requests.some(
          (r) => r.table === 'player_mapping' && !r.privileged
        )
      ).toBe(false)
    }
  )
  it.each(['player_mapping', 'EOT_GR_data'])(
    'refuses replacement when signed %s model read fails',
    async (table) => {
      state.role = 'officer'
      state.failure = table
      // The canonical trusted ban lookup also uses mapping. Model-only transport
      // injection below distinguishes the signed roster path from that lookup.
      if (table === 'player_mapping') state.failure = null
      state.transport = table
      const { PUT } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      const response = await PUT(request('PUT', replacement()))
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('Synthetic private')
      expect(
        state.requests.some((r) => r.table.startsWith('rpc/desktop_'))
      ).toBe(false)
    }
  )
  it('does not turn a saved table transport rejection into an empty authoritative state', async () => {
    state.transport = 'rpc/desktop_get_saved_assignments'
    const { GET } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('Synthetic private')
  })
  it('rejects clear bodies before RPC rather than ignoring caller data', async () => {
    state.role = 'officer'
    const { DELETE } =
      await import('@/app/api/guild-raid/saved-assignments/route')
    expect(
      (await DELETE(request('DELETE', { season_number: '102' }))).status
    ).toBe(400)
    expect(state.requests.some((r) => r.table.startsWith('rpc/desktop_'))).toBe(
      false
    )
  })
  it('does not start authentication for an already canceled request', async () => {
    const controller = new AbortController()
    controller.abort()
    const { GET } = await import('@/app/api/guild-raid/saved-assignments/route')
    expect(
      (
        await GET(
          request('GET', undefined, 'season_number=101', controller.signal)
        )
      ).status
    ).toBe(408)
    expect(state.authCalls).toBe(0)
    expect(state.requests).toHaveLength(0)
  })
  it('bounds non-abortable Auth and fences late completion before any ban or model read', async () => {
    vi.useFakeTimers()
    let resolveAuth!: (value: unknown) => void
    state.authPending = new Promise((resolve) => {
      resolveAuth = resolve
    })
    const { GET } = await import('@/app/api/guild-raid/saved-assignments/route')
    const pending = GET(request())
    await vi.advanceTimersByTimeAsync(7000)
    const response = await pending
    expect(response.status).toBe(503)
    expect(state.authCalls).toBe(1)
    expect(state.requests).toHaveLength(0)
    resolveAuth({ data: { user: state.user }, error: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(state.requests).toHaveLength(0)
  })
  it('cancels an in-flight signed read without retry or a later mutation', async () => {
    state.stalled = 'rpc/desktop_get_saved_assignments'
    const controller = new AbortController()
    const { GET } = await import('@/app/api/guild-raid/saved-assignments/route')
    const pending = GET(
      request('GET', undefined, 'season_number=101', controller.signal)
    )
    await vi.waitFor(() =>
      expect(state.requests.some((r) => r.table === state.stalled)).toBe(true)
    )
    controller.abort()
    expect((await pending).status).toBe(408)
    const stalled = state.requests.filter((r) => r.table === state.stalled)
    expect(stalled).toHaveLength(1)
    expect(stalled[0]!.signal?.aborted).toBe(true)
    expect(
      state.requests.some((r) =>
        [
          'rpc/desktop_replace_saved_assignments',
          'rpc/desktop_clear_saved_assignments'
        ].includes(r.table)
      )
    ).toBe(false)
  })
  it('includes streamed body wait in the single request deadline and cancels its reader', async () => {
    vi.useFakeTimers()
    state.role = 'officer'
    let canceled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true
      }
    })
    const req = new NextRequest(
      'http://localhost/api/guild-raid/saved-assignments?season_number=101',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        duplex: 'half'
      } as ConstructorParameters<typeof NextRequest>[1]
    )
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    const pending = PUT(req)
    await vi.advanceTimersByTimeAsync(7000)
    expect((await pending).status).toBe(503)
    await vi.advanceTimersByTimeAsync(0)
    expect(canceled).toBe(true)
    expect(state.requests.some((r) => r.table.startsWith('rpc/desktop_'))).toBe(
      false
    )
  })
  it('maps a failed body transport to a static service failure, with no private message', async () => {
    state.role = 'officer'
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError('Synthetic body private canary'))
      }
    })
    const req = new NextRequest(
      'http://localhost/api/guild-raid/saved-assignments?season_number=101',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        duplex: 'half'
      } as ConstructorParameters<typeof NextRequest>[1]
    )
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await PUT(req)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private canary')
    expect(state.requests.some((r) => r.table.startsWith('rpc/desktop_'))).toBe(
      false
    )
  })
})

describe('clear request streams', () => {
  function streamedClear(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
    headers?: HeadersInit
  ) {
    return new NextRequest(
      'http://localhost/api/guild-raid/saved-assignments?season_number=101',
      {
        method: 'DELETE',
        body,
        signal,
        headers,
        duplex: 'half'
      } as ConstructorParameters<typeof NextRequest>[1]
    )
  }
  function noMutation() {
    expect(
      state.requests.some((row) =>
        [
          'rpc/desktop_clear_saved_assignments',
          'rpc/desktop_replace_saved_assignments'
        ].includes(row.table)
      )
    ).toBe(false)
    expect(state.assignments).toEqual([
      { guild_code: 'TEST', season_number: '101', player_id: 'SYNQUEUE1' },
      { guild_code: 'TEST', season_number: '102', player_id: 'SYNOTHER' }
    ])
    expect(state.bosses).toEqual([
      { guild_code: 'TEST', season_number: '101', level: 'L1' },
      { guild_code: 'TEST', season_number: '102', level: 'L1' }
    ])
  }
  beforeEach(() => {
    state.role = 'officer'
    state.assignments = [
      { guild_code: 'TEST', season_number: '101', player_id: 'SYNQUEUE1' },
      { guild_code: 'TEST', season_number: '102', player_id: 'SYNOTHER' }
    ]
    state.bosses = [
      { guild_code: 'TEST', season_number: '101', level: 'L1' },
      { guild_code: 'TEST', season_number: '102', level: 'L1' }
    ]
  })
  it('accepts a non-null empty stream only after EOF and clears the selected season', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      }
    })
    const req = streamedClear(body)
    expect(req.body).not.toBeNull()
    const { DELETE } =
      await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await DELETE(req)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      assignments: [],
      bosses: [],
      deleted: { assignmentsDeleted: 1, bossesDeleted: 1 }
    })
    expect(body.locked).toBe(false)
    expect(state.assignments).toEqual([
      { guild_code: 'TEST', season_number: '102', player_id: 'SYNOTHER' }
    ])
    expect(state.bosses).toEqual([
      { guild_code: 'TEST', season_number: '102', level: 'L1' }
    ])
    expect(
      state.requests
        .filter((row) => row.table === 'rpc/desktop_clear_saved_assignments')
        .map((row) => row.body)
    ).toEqual([{ p_season_number: '101' }])
  })
  it('accepts zero-length chunks followed by EOF without mistaking a chunk for completion', async () => {
    let close!: () => void
    let pulled = false
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (!pulled) {
            pulled = true
            controller.enqueue(new Uint8Array())
            close = () => controller.close()
          }
        }
      },
      { highWaterMark: 0 }
    )
    const { DELETE } =
      await import('@/app/api/guild-raid/saved-assignments/route')
    const pending = DELETE(streamedClear(body))
    await vi.waitFor(() => expect(pulled).toBe(true))
    noMutation()
    close()
    expect((await pending).status).toBe(200)
    expect(body.locked).toBe(false)
  })
  it.each(['one byte', 'whitespace', 'JSON', 'after empty chunk'])(
    'rejects a nonempty %s stream before mutation even with Content-Length zero',
    async (kind) => {
      let canceled = false
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (kind === 'after empty chunk') controller.enqueue(new Uint8Array())
          controller.enqueue(
            new TextEncoder().encode(
              kind === 'JSON' ? '{}' : kind === 'whitespace' ? ' ' : 'x'
            )
          )
        },
        cancel() {
          canceled = true
        }
      })
      const { DELETE } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      const response = await DELETE(
        streamedClear(body, undefined, { 'Content-Length': '0' })
      )
      expect(response.status).toBe(400)
      expect(canceled).toBe(true)
      expect(body.locked).toBe(false)
      noMutation()
    }
  )
  it('refuses an endless sequence of empty chunks with bounded work and no write', async () => {
    let pulls = 0
    let canceled = false
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++
          controller.enqueue(new Uint8Array())
        },
        cancel() {
          canceled = true
        }
      },
      { highWaterMark: 0 }
    )
    const { DELETE } =
      await import('@/app/api/guild-raid/saved-assignments/route')
    expect((await DELETE(streamedClear(body))).status).toBe(400)
    expect(pulls).toBeGreaterThan(0)
    expect(pulls).toBeLessThan(10000)
    expect(canceled).toBe(true)
    expect(body.locked).toBe(false)
    noMutation()
  })
  it('keeps a stalled clear body within the whole request deadline and does not await cancellation', async () => {
    vi.useFakeTimers()
    let canceled = false
    const body = new ReadableStream<Uint8Array>(
      {
        cancel() {
          canceled = true
          return new Promise<void>(() => {})
        }
      },
      { highWaterMark: 0 }
    )
    const { DELETE } =
      await import('@/app/api/guild-raid/saved-assignments/route')
    const pending = DELETE(streamedClear(body))
    await vi.advanceTimersByTimeAsync(7000)
    expect((await pending).status).toBe(503)
    await vi.advanceTimersByTimeAsync(0)
    expect(canceled).toBe(true)
    expect(body.locked).toBe(false)
    noMutation()
  })
  it('cancels a pending clear read on caller abort and cannot write after late EOF', async () => {
    let end!: () => void
    let pulled = false
    let canceled = false
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true
          end = () => controller.close()
        },
        cancel() {
          canceled = true
        }
      },
      { highWaterMark: 0 }
    )
    const controller = new AbortController()
    const { DELETE } =
      await import('@/app/api/guild-raid/saved-assignments/route')
    const pending = DELETE(streamedClear(body, controller.signal))
    await vi.waitFor(() => expect(pulled).toBe(true))
    controller.abort()
    expect((await pending).status).toBe(408)
    expect(canceled).toBe(true)
    expect(body.locked).toBe(false)
    expect(end).toThrow(TypeError)
    await Promise.resolve()
    noMutation()
  })
  it('maps clear transport failure to a static safe response without a mutation', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError('Synthetic clear private canary'))
      }
    })
    const { DELETE } =
      await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await DELETE(streamedClear(body))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private canary')
    expect(body.locked).toBe(false)
    noMutation()
  })
  it.each(['anonymous', 'member', 'banned', 'inactive', 'feature denied'])(
    'does not read a streamed body before %s refusal',
    async (kind) => {
      if (kind === 'anonymous') state.user = null
      if (kind === 'member') state.role = 'member'
      if (kind === 'banned') state.banned = true
      if (kind === 'inactive') state.active = false
      if (kind === 'feature denied') state.stage = 'alpha'
      let pulls = 0
      const body = new ReadableStream<Uint8Array>(
        {
          pull() {
            pulls++
          }
        },
        { highWaterMark: 0 }
      )
      const { DELETE } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      const response = await DELETE(streamedClear(body))
      expect(response.status).toBe(kind === 'anonymous' ? 401 : 403)
      expect(pulls).toBe(0)
      expect(body.locked).toBe(false)
      noMutation()
    }
  )
  it('rechecks current writer role after EOF before any clear RPC', async () => {
    let end!: () => void
    let pulled = false
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true
          end = () => controller.close()
        }
      },
      { highWaterMark: 0 }
    )
    const { DELETE } =
      await import('@/app/api/guild-raid/saved-assignments/route')
    const pending = DELETE(streamedClear(body))
    await vi.waitFor(() => expect(pulled).toBe(true))
    state.finalRole = 'member'
    end()
    expect((await pending).status).toBe(403)
    noMutation()
  })
})

describe('saved mutation outcome knowledge', () => {
  it('reports unknown outcome after successful RPC but failed readback and permits an authoritative fresh reload', async () => {
    state.role = 'officer'
    state.readbackFailure = true
    const { PUT, GET } =
      await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await PUT(request('PUT', replacement()))
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).toContain('reload the current saved season before retrying')
    expect(text).not.toMatch(/rollback|unchanged|Synthetic private/)
    expect(
      state.requests.filter(
        (r) => r.table === 'rpc/desktop_replace_saved_assignments'
      )
    ).toHaveLength(1)
    state.failure = null
    const reload = await GET(request())
    expect(reload.status).toBe(200)
    expect(await reload.json()).toMatchObject({
      assignments: [{ player_id: 'SYNQUEUE1', token_allocations: { L1: 1 } }]
    })
  })
  it('does not infer rollback or retry when a committed replacement response is lost past the deadline', async () => {
    vi.useFakeTimers()
    state.role = 'officer'
    state.stallCommittedResponse = true
    const { PUT, GET } =
      await import('@/app/api/guild-raid/saved-assignments/route')
    const pending = PUT(request('PUT', replacement()))
    await vi.advanceTimersByTimeAsync(7000)
    const response = await pending
    expect(response.status).toBe(503)
    expect(await response.text()).toContain(
      'reload the current saved season before retrying'
    )
    expect(
      state.requests.filter(
        (r) => r.table === 'rpc/desktop_replace_saved_assignments'
      )
    ).toHaveLength(1)
    const reload = await GET(request())
    expect(reload.status).toBe(200)
    expect(await reload.json()).toMatchObject({
      assignments: [{ player_id: 'SYNQUEUE1', token_allocations: { L1: 1 } }]
    })
  })
})

describe('bounded decoder and saved model controls', () => {
  it('refuses duplicate escaped keys that decode to the same target', async () => {
    state.role = 'officer'
    const body = JSON.stringify(replacement()).replace(
      '"L1":1',
      '"L1":4,"\\u004c1":1'
    )
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await PUT(
      new NextRequest(
        'http://localhost/api/guild-raid/saved-assignments?season_number=101',
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }
      )
    )
    expect(response.status).toBe(400)
    expect(state.requests.some((r) => r.table.startsWith('rpc/desktop_'))).toBe(
      false
    )
  })
  it('accepts explicit empty replacement with authoritative zero counts', async () => {
    state.role = 'officer'
    const { PUT } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await PUT(
      request('PUT', { asOf: AS_OF, bosses: [], assignments: [] })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      assignments: [],
      bosses: [],
      summary: { assignedCount: 0, totalPlayers: 0, totalTokens: 0 }
    })
  })
  it.each([
    [
      'roster overflow',
      'player_mapping',
      Array.from({ length: 31 }, (_, i) => ({
        player_id: `SYN${i}`,
        display_name: `Synthetic ${i}`,
        guild_code: 'TEST',
        is_current: true,
        is_active: true
      }))
    ],
    [
      'roster duplicate',
      'player_mapping',
      Array.from({ length: 2 }, () => ({
        player_id: 'SYNQUEUE1',
        display_name: 'Synthetic member',
        guild_code: 'TEST',
        is_current: true,
        is_active: true
      }))
    ],
    [
      'history malformed identity',
      'EOT_GR_data',
      [
        {
          Guild: 'TEST',
          Season: '101',
          userId: null,
          startedOn: '2026-06-01T09:00:00.000Z',
          damageType: 'Battle'
        }
      ]
    ],
    [
      'history overflow',
      'EOT_GR_data',
      Array.from({ length: 10001 }, () => ({
        Guild: 'TEST',
        Season: '101',
        userId: 'SYNQUEUE1',
        startedOn: '2026-06-01T09:00:00.000Z',
        damageType: 'Battle'
      }))
    ]
  ] as const)(
    'refuses %s rather than computing a partial or fabricated budget',
    async (_name, table, rows) => {
      state.role = 'officer'
      state.overrides[table] = rows
      const { PUT } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      expect((await PUT(request('PUT', replacement()))).status).toBe(503)
      expect(
        state.requests.some((r) => r.table.startsWith('rpc/desktop_'))
      ).toBe(false)
    }
  )
  it('returns only the admitted saved intent projection, including after a writer downgrade', async () => {
    state.role = 'officer'
    const { PUT, GET } =
      await import('@/app/api/guild-raid/saved-assignments/route')
    expect((await PUT(request('PUT', replacement()))).status).toBe(200)
    state.assignments[0]!.opaque_private = 'synthetic-private-canary'
    state.finalRole = 'member'
    const response = await GET(request())
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('synthetic-private-canary')
    expect(JSON.parse(text)).toMatchObject({
      canReplace: false,
      canClear: false,
      assignments: [{ player_id: 'SYNQUEUE1', token_allocations: { L1: 1 } }]
    })
  })
})

function savedIntent(level: string, boss: string) {
  return {
    assignments: [
      {
        guild_code: 'TEST',
        season_number: '101',
        player_id: 'SYNQUEUE1',
        display_name: 'Synthetic member',
        primary_boss: null,
        secondary_boss: null,
        token_allocations: { [level]: 1 },
        uses_flexible_tokens: true,
        total_tokens_allocated: 1,
        assigned_at: AS_OF,
        updated_at: AS_OF
      }
    ],
    bosses: [
      {
        guild_code: 'TEST',
        season_number: '101',
        level,
        boss_name: boss,
        sub_bosses: {},
        selected_at: AS_OF
      }
    ]
  }
}
function swapIntent() {
  state.swapOnRead = false
  const next = savedIntent('L2', 'Rogal Dorn')
  state.assignments = next.assignments
  state.bosses = next.bosses
}
describe('coherent selected-season intent reads', () => {
  it('does not stitch assignment and boss rows from opposite sides of a concurrent commit', async () => {
    const prior = savedIntent('L1', 'Riptide')
    state.assignments = prior.assignments
    state.bosses = prior.bosses
    state.swapOnRead = true
    const { GET } = await import('@/app/api/guild-raid/saved-assignments/route')
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      assignments: [{ token_allocations: { L1: 1 } }],
      bosses: [{ level: 'L1', boss_name: 'Riptide' }]
    })
    const reload = await GET(request())
    expect(reload.status).toBe(200)
    expect(await reload.json()).toMatchObject({
      assignments: [{ token_allocations: { L2: 1 } }],
      bosses: [{ level: 'L2', boss_name: 'Rogal Dorn' }]
    })
    const reads = state.requests.filter(
      (r) => r.table === 'rpc/desktop_get_saved_assignments'
    )
    expect(reads).toHaveLength(2)
    expect(
      reads.every(
        (r) =>
          r.privileged === false &&
          JSON.stringify(r.body) === '{"p_season_number":"101"}'
      )
    ).toBe(true)
    expect(
      state.requests.some((r) => r.table.startsWith('upcoming_season_'))
    ).toBe(false)
  })
  it.each([
    { assignments: [], bosses: null },
    { assignments: [], bosses: [], opaque_private: 'synthetic-private-canary' },
    []
  ])(
    'refuses malformed joint snapshot instead of silently falling back to table reads',
    async (reply) => {
      state.readReply = reply
      const { GET } =
        await import('@/app/api/guild-raid/saved-assignments/route')
      const response = await GET(request())
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('synthetic-private-canary')
      expect(
        state.requests.some((r) => r.table.startsWith('upcoming_season_'))
      ).toBe(false)
    }
  )
})
