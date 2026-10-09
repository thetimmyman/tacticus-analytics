import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PostgrestClient } from '@supabase/postgrest-js'

const fixture = vi.hoisted(() => ({
  user: { id: '11111111-1111-4111-8111-111111111111' } as { id: string } | null,
  role: 'officer',
  active: true,
  current: true,
  guild: 'SYN-PERF',
  finalRole: null as string | null,
  finalGuild: null as string | null,
  finalActive: null as boolean | null,
  membershipReads: 0,
  feature: true,
  finalFeature: null as boolean | null,
  featureReads: 0,
  banned: false,
  finalBan: false,
  banReads: 0,
  seasons: ['101', '102'] as unknown,
  timezone: 'UTC',
  history: [] as Record<string, unknown>[],
  roster: [] as Record<string, unknown>[],
  finalRoster: null as Record<string, unknown>[] | null,
  rosterReads: 0,
  targets: [] as Record<string, unknown>[],
  fail: null as string | null,
  transport: false,
  stall: null as string | null,
  missingCount: false,
  truncate: false,
  excessCount: false,
  authError: false,
  dbPending: null as Promise<void> | null,
  authPending: null as Promise<unknown> | null,
  authCalls: 0,
  legacy: false,
  legacyAuthCalls: 0,
  legacyGuildChecks: [] as string[],
  requests: [] as {
    table: string
    method: string
    url: URL
    headers: Headers
    signal?: AbortSignal | null
    privileged: boolean
  }[]
}))
vi.mock('@/app/lib/db', () => ({
  db: async () => {
    if (fixture.dbPending) await fixture.dbPending
    return client
  },
  serviceDb: () => banClient
}))
vi.mock('@/app/lib/auth', () => ({
  AuthError: class extends Error {},
  requireRoleForApi: () => {
    fixture.legacyAuthCalls++
    if (!fixture.legacy)
      throw new Error('Legacy authority must not run for saved view')
    return {
      user: fixture.user,
      profile: { guild_code: fixture.guild, role: fixture.role }
    }
  }
}))
vi.mock('@/app/lib/auth/guild-permissions', () => ({
  requireGuildOfficerOrClusterLeader: async (
    _client: unknown,
    _user: string,
    guild: string
  ) => {
    fixture.legacyGuildChecks.push(guild)
  }
}))
vi.unmock('@/app/lib/auth/user-bans')

const AS_OF = '2026-06-02T08:00:00.000Z'
const A = 'SYN-PERF-A'
const B = 'SYN-PERF-B'
type Row = Record<string, unknown>
const row = (v: unknown): v is Row =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const attack = (
  id: string | null,
  name: string,
  damage: number,
  extra: Row = {}
) => ({
  Guild: 'SYN-PERF',
  Season: '101',
  userId: id,
  displayName: name,
  Name: 'Riptide',
  set: 0,
  encounterId: 0,
  rarity: 'Legendary',
  loopIndex: 0,
  damageType: 'Battle',
  damageDealt: damage,
  remainingHp: 5000000 - damage,
  maxHp: 5000000,
  startedOn: '2026-06-01T09:00:00.000Z',
  ...extra
})
const member = (id: string, name: string, extra: Row = {}) => ({
  player_id: id,
  display_name: name,
  guild_code: 'SYN-PERF',
  is_current: true,
  is_active: true,
  ...extra
})
const target = (tokens: number, extra: Row = {}) => ({
  guild_code: 'SYN-PERF',
  season_number: '101',
  boss_name: 'Riptide',
  rarity: 'Legendary',
  set: 1,
  encounter_id: 0,
  target_tokens: tokens,
  skip: false,
  ...extra
})
function dataFor(table: string): unknown {
  if (table === 'user_bans') {
    fixture.banReads++
    return fixture.banned || (fixture.finalBan && fixture.banReads > 2)
      ? [
          {
            id: 'synthetic-ban',
            ban_group_id: 'synthetic-group',
            auth_user_id: fixture.user?.id,
            subject_type: 'user_id',
            subject_value: fixture.user?.id,
            reason: null,
            banned_at: '2020-01-01T00:00:00.000Z',
            expires_at: null,
            lifted_at: null
          }
        ]
      : []
  }
  if (table === 'current_user_player_mapping') {
    const final = ++fixture.membershipReads > 1
    return [
      {
        player_id: A,
        guild_code: final
          ? (fixture.finalGuild ?? fixture.guild)
          : fixture.guild,
        role: final ? (fixture.finalRole ?? fixture.role) : fixture.role,
        user_id: fixture.user?.id,
        is_current: fixture.current,
        is_active: final
          ? (fixture.finalActive ?? fixture.active)
          : fixture.active
      }
    ]
  }
  if (table === 'rpc/check_feature_access')
    return {
      has_access:
        ++fixture.featureReads > 1
          ? (fixture.finalFeature ?? fixture.feature)
          : fixture.feature
    }
  if (table === 'rpc/get_distinct_seasons_for_guild') return fixture.seasons
  if (table === 'guild_config')
    return [{ guild_code: 'SYN-PERF', timezone: fixture.timezone }]
  if (table === 'player_mapping')
    return ++fixture.rosterReads > 1
      ? (fixture.finalRoster ?? fixture.roster)
      : fixture.roster
  if (table === 'EOT_GR_data') return fixture.history
  if (table === 'boss_target_tokens') return fixture.targets
  throw new Error('Unexpected synthetic relation')
}
async function fetchAdapter(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = new URL(String(input))
  const table = url.pathname.replace('/rest/v1/', '')
  const headers = new Headers(init?.headers)
  const privileged = headers.get('X-Synthetic-Authority') === 'ban-service'
  if (privileged && !['user_bans', 'player_mapping'].includes(table))
    throw new Error('Privileged model read forbidden')
  fixture.requests.push({
    table,
    method: init?.method ?? 'GET',
    url,
    headers,
    signal: init?.signal,
    privileged
  })
  if (table === fixture.stall)
    return new Promise((_, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true }
      )
    })
  if (table === fixture.fail && !privileged) {
    if (fixture.transport)
      throw new Error('Synthetic private transport diagnostic')
    return new Response(
      JSON.stringify({
        code: '42501',
        message: 'Synthetic private ACL diagnostic'
      }),
      { status: 403 }
    )
  }
  let data = dataFor(table)
  let count: number | null = null
  if (Array.isArray(data) && !table.startsWith('rpc/')) {
    if (!data.every(row)) throw new Error('Synthetic row shape invalid')
    let rows = [...data]
    for (const [column, filter] of url.searchParams) {
      if (filter.startsWith('eq.'))
        rows = rows.filter((r) => String(r[column]) === filter.slice(3))
      else if (filter.startsWith('in.('))
        rows = rows.filter((r) =>
          filter
            .slice(4, -1)
            .split(',')
            .map((x) => x.replace(/^"|"$/g, ''))
            .includes(String(r[column]))
        )
      else if (filter.startsWith('lte.'))
        rows = rows.filter((r) => String(r[column]) <= filter.slice(4))
      else if (filter.startsWith('gt.'))
        rows = rows.filter((r) => Number(r[column]) > Number(filter.slice(3)))
      else if (filter === 'not.is.null')
        rows = rows.filter((r) => r[column] !== null)
    }
    const order = url.searchParams.get('order')
    if (order === 'startedOn.desc')
      rows.sort((a, b) =>
        String(b.startedOn).localeCompare(String(a.startedOn))
      )
    count = rows.length
    const limit = Number(url.searchParams.get('limit'))
    if (limit) rows = rows.slice(0, limit)
    if (table === 'EOT_GR_data' && fixture.truncate) rows = rows.slice(0, 0)
    if (table === 'EOT_GR_data' && fixture.excessCount) count = 10001
    data =
      headers.get('Accept') === 'application/vnd.pgrst.object+json'
        ? (rows[0] ?? null)
        : rows
  }
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...(count === null || fixture.missingCount
        ? {}
        : { 'Content-Range': `0-${Math.max(0, count - 1)}/${count}` })
    }
  })
}
const sdk = new PostgrestClient('http://localhost:3001/rest/v1', {
  fetch: fetchAdapter
})
const client = {
  from: sdk.from.bind(sdk),
  rpc: sdk.rpc.bind(sdk),
  auth: {
    getUser: async () => {
      fixture.authCalls++
      if (fixture.authPending) return fixture.authPending
      if (fixture.authError)
        throw new Error('Synthetic private auth diagnostic')
      return { data: { user: fixture.user }, error: null }
    }
  }
}
const bans = new PostgrestClient('http://localhost:3001/rest/v1', {
  fetch: fetchAdapter,
  headers: { 'X-Synthetic-Authority': 'ban-service' }
})
const banClient = { from: bans.from.bind(bans) }
function request(query = `season=101&asOf=${AS_OF}`, signal?: AbortSignal) {
  return new NextRequest(
    `http://localhost/api/upcoming/token-performance?view=saved&${query}`,
    { signal }
  )
}
async function get(query?: string, signal?: AbortSignal) {
  const { GET } = await import('@/app/api/upcoming/token-performance/route')
  return GET(request(query, signal))
}
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
  Object.assign(fixture, {
    user: { id: '11111111-1111-4111-8111-111111111111' },
    role: 'officer',
    active: true,
    current: true,
    guild: 'SYN-PERF',
    finalRole: null,
    finalGuild: null,
    finalActive: null,
    membershipReads: 0,
    feature: true,
    finalFeature: null,
    featureReads: 0,
    banned: false,
    finalBan: false,
    banReads: 0,
    seasons: ['101', '102'],
    timezone: 'UTC',
    history: [
      attack(A, 'Synthetic Twin', 1000000),
      attack(B, 'Synthetic Twin', 2000000)
    ],
    roster: [member(A, 'Synthetic Twin'), member(B, 'Synthetic Twin')],
    finalRoster: null,
    rosterReads: 0,
    targets: [target(4)],
    fail: null,
    transport: false,
    stall: null,
    missingCount: false,
    truncate: false,
    excessCount: false,
    authError: false,
    dbPending: null,
    authPending: null,
    authCalls: 0,
    legacy: false,
    legacyAuthCalls: 0,
    legacyGuildChecks: [],
    requests: []
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('saved own-guild performance stable identity', () => {
  it('keeps distinct current player IDs with the same display name separate', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    const data = await response.json()
    const players = data.players.sort(
      (a: { weightedScore: number }, b: { weightedScore: number }) =>
        a.weightedScore - b.weightedScore
    )
    expect(
      players.map(
        (p: { name: string; tokensSpent: number; weightedScore: number }) => ({
          name: p.name,
          tokens: p.tokensSpent,
          score: p.weightedScore
        })
      )
    ).toEqual([
      { name: 'Synthetic Twin', tokens: 1, score: 0.8 },
      { name: 'Synthetic Twin', tokens: 1, score: 1.6 }
    ])
    expect(new Set(players.map((p: { rowKey: string }) => p.rowKey)).size).toBe(
      2
    )
    expect(data.summary).toMatchObject({ playerCount: 2, pctAtOrAbove: 50 })
    expect(data.summary.mean).toBeCloseTo(1.2)
    expect(data.summary.median).toBeCloseTo(1.2)
    expect(JSON.stringify(data)).not.toContain(A)
    expect(JSON.stringify(data)).not.toContain(B)
  })
  it('keeps a current player’s earlier attacks after a display-name change', async () => {
    fixture.history = [
      attack(A, 'Synthetic Current', 1000000),
      attack(A, 'Synthetic Previous', 2000000)
    ]
    fixture.roster = [member(A, 'Synthetic Current')]
    const response = await get()
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(
      data.players.map(
        (p: { name: string; tokensSpent: number; weightedScore: number }) => ({
          name: p.name,
          tokens: p.tokensSpent,
          score: p.weightedScore
        })
      )
    ).toEqual([{ name: 'Synthetic Current', tokens: 2, score: 1.2 }])
    expect(data.players[0].bosses[0]).toMatchObject({
      actualDamage: 3000000,
      expectedDamage: 2500000,
      expectedTokens: 4,
      tokensSpent: 2,
      tier: 'officer_target'
    })
  })
})

describe('saved performance scope and canonical calculation', () => {
  it('uses fresh current labels and retains inactive current players', async () => {
    fixture.roster[0] = member(A, 'Old saved name')
    fixture.finalRoster = [
      member(A, 'Current saved name', { is_active: false }),
      member(B, 'Synthetic Twin')
    ]
    const response = await get()
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.players.map((p: { name: string }) => p.name)).toContain(
      'Current saved name'
    )
    expect(data.players).toHaveLength(2)
    expect(
      fixture.requests
        .filter((r) => r.table === 'player_mapping' && !r.privileged)
        .every((r) => !r.url.searchParams.has('is_active'))
    ).toBe(true)
  })
  it('keeps the complete own-guild baseline but never outputs departed or missing-ID buckets', async () => {
    fixture.targets = []
    fixture.history.push(
      attack('SYN-DEPARTED', 'Synthetic departed', 3000000),
      attack(null, A, 2000000)
    )
    const response = await get()
    const data = await response.json()
    expect(response.status).toBe(200)
    // Own-guild mean is 2,000,000, ceil(5,000,000 / mean) = 3.
    expect(
      data.players
        .map((p: { tokensSpent: number; weightedScore: number }) => [
          p.tokensSpent,
          p.weightedScore
        ])
        .sort()
    ).toEqual([
      [1, 0.6],
      [1, 1.2]
    ])
    expect(data.players).toHaveLength(2)
    expect(JSON.stringify(data)).not.toContain('SYN-DEPARTED')
    expect(JSON.stringify(data)).not.toContain('baseline:')
  })
  it('never includes foreign, other-season, future, prime or non-battle data in the baseline', async () => {
    fixture.targets = []
    fixture.history.push(
      attack('SYN-FOREIGN', 'Synthetic foreign', 4000000, { Guild: 'FOREIGN' }),
      attack(A, 'Synthetic Twin', 4000000, { Season: '102' }),
      attack(A, 'Synthetic Twin', 4000000, {
        startedOn: '2026-06-02T09:00:00.000Z'
      }),
      attack(A, 'Synthetic Twin', 4000000, { encounterId: 1 }),
      attack(A, 'Synthetic Twin', 4000000, { damageType: 'Bomb' })
    )
    const response = await get()
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(
      data.players.map((p: { weightedScore: number }) => p.weightedScore).sort()
    ).toEqual([0.8, 1.6])
    const history = fixture.requests.find((r) => r.table === 'EOT_GR_data')!
    expect(history.url.searchParams.get('Guild')).toBe('eq.SYN-PERF')
    expect(history.url.searchParams.get('Season')).toBe('eq.101')
    expect(history.url.searchParams.get('encounterId')).toBe('eq.0')
    expect(history.url.searchParams.get('startedOn')).toBe(`lte.${AS_OF}`)
  })
  it('prefers selected-season targets over legacy targets regardless of order', async () => {
    fixture.targets = [target(2, { season_number: '' }), target(4)]
    const data = await (await get()).json()
    expect(
      data.players.every(
        (p: { bosses: { expectedTokens: number; tier: string }[] }) =>
          p.bosses[0]?.expectedTokens === 4 &&
          p.bosses[0]?.tier === 'officer_target'
      )
    ).toBe(true)
  })
  it('retains canonical non-skipped target semantics including legacy fallback', async () => {
    fixture.targets = [
      target(2, { season_number: '' }),
      target(4, { skip: true })
    ]
    const data = await (await get()).json()
    expect(
      data.players.map((p: { weightedScore: number }) => p.weightedScore).sort()
    ).toEqual([0.4, 0.8])
  })
  it('keeps per-loop details and weighted score rather than averaging boss scores', async () => {
    fixture.history = [
      attack(A, 'Synthetic Previous', 1000000),
      attack(A, 'Synthetic Current', 2000000, { loopIndex: 1 })
    ]
    fixture.roster = [member(A, 'Synthetic Current')]
    const data = await (await get()).json()
    expect(data.players[0].weightedScore).toBe(1.2)
    expect(data.players[0].bosses[0].perLoop).toEqual([
      { loopIndex: 0, score: 0.8, tokensSpent: 1, actualDamage: 1000000 },
      { loopIndex: 1, score: 1.6, tokensSpent: 1, actualDamage: 2000000 }
    ])
  })
  it('weights different boss scores by canonical token counts', async () => {
    fixture.history = [
      attack(A, 'Synthetic Twin', 1000000),
      attack(A, 'Synthetic Twin', 15000000, {
        rarity: 'Mythic',
        maxHp: 30000000,
        remainingHp: 15000000
      }),
      attack(A, 'Synthetic Twin', 15000000, {
        rarity: 'Mythic',
        maxHp: 30000000,
        remainingHp: 15000000,
        loopIndex: 1
      })
    ]
    fixture.roster = [member(A, 'Synthetic Twin')]
    fixture.targets.push(target(4, { rarity: 'Mythic' }))
    const response = await get()
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.players[0]).toMatchObject({
      tokensSpent: 3,
      bossCount: 2,
      scoredBossCount: 2
    })
    expect(data.players[0].weightedScore).toBeCloseTo(1.6)
    expect(
      data.players[0].bosses.map(
        (b: { score: number; tokensSpent: number }) => [b.score, b.tokensSpent]
      )
    ).toEqual([
      [0.8, 1],
      [2, 2]
    ])
  })
  it('retains attacks with unknown saved loop metadata without inventing a loop', async () => {
    fixture.history = [
      attack(A, 'Synthetic Twin', 1000000),
      attack(A, 'Synthetic Previous', 2000000, { loopIndex: null })
    ]
    fixture.roster = [member(A, 'Synthetic Current')]
    const data = await (await get()).json()
    expect(data.players[0]).toMatchObject({
      tokensSpent: 2,
      weightedScore: 1.2
    })
    expect(data.players[0].bosses[0].perLoop).toEqual([
      { loopIndex: 0, score: 0.8, tokensSpent: 1, actualDamage: 1000000 }
    ])
  })
  it('preserves the qualifying-sweep exception and excludes a small finishing sweep', async () => {
    fixture.history = [
      attack(A, 'Synthetic Twin', 1000000),
      attack(A, 'Synthetic Twin', 2000000, { remainingHp: 0, loopIndex: 1 }),
      attack(A, 'Synthetic Twin', 100, { remainingHp: 0, loopIndex: 2 })
    ]
    fixture.roster = [member(A, 'Synthetic Twin')]
    const data = await (await get()).json()
    expect(data.players[0]).toMatchObject({
      tokensSpent: 2,
      weightedScore: 1.2
    })
    expect(data.players[0].bosses[0].perLoop).toHaveLength(2)
  })
  it('preserves canonical unscored absence and a null summary separately from numeric zero', async () => {
    fixture.history = [
      attack(A, 'Synthetic Twin', 100, { Name: 'Synthetic unknown boss' })
    ]
    fixture.roster = [member(A, 'Synthetic Twin')]
    fixture.targets = []
    const data = await (await get()).json()
    expect(data.players).toEqual([])
    expect(data.summary).toEqual({
      playerCount: 0,
      mean: null,
      median: null,
      pctAtOrAbove: null
    })
  })
  it('returns a legitimate empty result when saved history is empty', async () => {
    fixture.history = []
    const response = await get()
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.players).toEqual([])
    expect(data.summary).toEqual({
      playerCount: 0,
      mean: null,
      median: null,
      pctAtOrAbove: null
    })
    expect(data).toMatchObject({
      source: 'saved-local',
      season: '101',
      configId: 'guild_boss_season_config_2',
      asOf: AS_OF,
      timeZone: 'UTC',
      cohort: 'own-guild',
      encounters: 'main',
      currentSavedRoster: true,
      targets: 'current-saved'
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('replaces labels equal to an ID with a safe generic label', async () => {
    fixture.roster[0] = member(A, `  ${A}  `)
    const data = await (await get()).json()
    expect(data.players.map((p: { name: string }) => p.name)).toContain(
      'Unnamed saved player'
    )
    expect(JSON.stringify(data)).not.toContain(A)
  })
  it('drops a player who leaves the current roster during calculation', async () => {
    fixture.finalRoster = [member(B, 'Current twin')]
    const data = await (await get()).json()
    expect(data.players).toHaveLength(1)
    expect(data.players[0]).toMatchObject({
      name: 'Current twin',
      weightedScore: 1.6
    })
  })
  it('admits exact ID and label bounds without exposing raw identity', async () => {
    const id = 'x'.repeat(256)
    const name = 'Synthetic '.padEnd(1024, 'a')
    fixture.history = [attack(id, 'Synthetic previous', 1000000)]
    fixture.roster = [member(id, name)]
    const response = await get()
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.players[0].name).toBe(name)
    expect(JSON.stringify(data)).not.toContain(id)
  })
  it('keeps opaque row identity stable across a current display-label change', async () => {
    const before = await (await get()).json()
    fixture.roster = [
      member(A, 'Renamed current player'),
      member(B, 'Synthetic Twin')
    ]
    const after = await (await get()).json()
    const old = before.players.find(
      (p: { weightedScore: number }) => p.weightedScore === 0.8
    )
    const fresh = after.players.find(
      (p: { weightedScore: number }) => p.weightedScore === 0.8
    )
    expect(fresh.rowKey).toBe(old.rowKey)
    expect(fresh.name).toBe('Renamed current player')
  })
  it('uses only signed no-retry read interfaces and canonical auth-only privileged ban reads', async () => {
    expect((await get()).status).toBe(200)
    expect(fixture.authCalls).toBe(1)
    for (const r of fixture.requests) {
      expect(r.signal).toBeInstanceOf(AbortSignal)
      if (r.privileged)
        expect(['user_bans', 'player_mapping']).toContain(r.table)
      else if (r.table.startsWith('rpc/'))
        expect([
          'rpc/get_distinct_seasons_for_guild',
          'rpc/check_feature_access'
        ]).toContain(r.table)
      else {
        expect(r.method).toBe('GET')
        expect(r.headers.get('Prefer')).toContain('count=exact')
      }
    }
  })
})

describe('saved performance admission and bounded failure', () => {
  it.each(['member', 'admin', 'Officer', 'Leader', 'OFFICER', 'leader '])(
    'refuses role %s before model reads',
    async (role) => {
      fixture.role = role
      expect((await get()).status).toBe(403)
      expect(fixture.requests.some((r) => r.table === 'EOT_GR_data')).toBe(
        false
      )
    }
  )
  it.each(['officer', 'leader'])('admits exact %s', async (role) => {
    fixture.role = role
    expect((await get()).status).toBe(200)
  })
  it.each(['anon', 'inactive', 'stale', 'banned', 'feature'])(
    'authenticates before invalid request for %s',
    async (kind) => {
      if (kind === 'anon') fixture.user = null
      if (kind === 'inactive') fixture.active = false
      if (kind === 'stale') fixture.current = false
      if (kind === 'banned') fixture.banned = true
      if (kind === 'feature') fixture.feature = false
      expect((await get('forged=private')).status).toBe(
        kind === 'anon' ? 401 : 403
      )
      expect(fixture.requests.some((r) => r.table === 'EOT_GR_data')).toBe(
        false
      )
    }
  )
  it.each(['role', 'guild', 'active', 'feature', 'ban'])(
    'refuses changed final %s authority without returning players',
    async (kind) => {
      if (kind === 'role') fixture.finalRole = 'member'
      if (kind === 'guild') fixture.finalGuild = 'FOREIGN'
      if (kind === 'active') fixture.finalActive = false
      if (kind === 'feature') fixture.finalFeature = false
      if (kind === 'ban') fixture.finalBan = true
      const response = await get()
      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain('Synthetic Twin')
    }
  )
  it.each([
    '',
    'season=101',
    `asOf=${AS_OF}`,
    `season=101&asOf=${AS_OF}&guild_code=FOREIGN`,
    `season=101&season=101&asOf=${AS_OF}`,
    `season=101&asOf=${AS_OF}&asOf=${AS_OF}`,
    `season=101&asOf=${AS_OF}&padding=${'x'.repeat(300)}`
  ])('refuses unknown/duplicate/missing/oversize query %s', async (query) => {
    expect((await get(query)).status).toBe(400)
    expect(fixture.requests.some((r) => r.table === 'EOT_GR_data')).toBe(false)
  })
  it.each([
    '2026-06-02T08:00:00+00:00',
    '2026-06-02T08:00:00',
    '2026-06-31T08:00:00Z',
    'invalid'
  ])('refuses malformed UTC %s', async (instant) => {
    expect(
      (await get(`season=101&asOf=${encodeURIComponent(instant)}`)).status
    ).toBe(400)
  })
  it.each(['100', '103', '9999', '0101'])(
    'refuses unsupported/unimported season %s',
    async (season) => {
      expect((await get(`season=${season}&asOf=${AS_OF}`)).status).toBe(422)
    }
  )
  it.each(['2026-01-01T00:00:00Z', '2026-06-02T10:00:00Z'])(
    'refuses outside-window asOf %s',
    async (instant) => {
      expect((await get(`season=101&asOf=${instant}`)).status).toBe(422)
    }
  )
  it.each([
    'current_user_player_mapping',
    'guild_config',
    'player_mapping',
    'EOT_GR_data',
    'boss_target_tokens',
    'rpc/get_distinct_seasons_for_guild',
    'rpc/check_feature_access'
  ])('refuses signed ACL errors for %s', async (table) => {
    fixture.fail = table
    const response = await get()
    expect(response.status).toBe(503)
    const body = await response.text()
    expect(body).not.toContain('Synthetic private')
    expect(body).not.toContain('42501')
    expect(
      fixture.requests.filter((r) => r.table === table && !r.privileged)
    ).toHaveLength(1)
  })
  it('refuses transport errors and never treats them as an empty score', async () => {
    fixture.fail = 'EOT_GR_data'
    fixture.transport = true
    const response = await get()
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('players')
    expect(
      fixture.requests.filter((r) => r.table === 'EOT_GR_data')
    ).toHaveLength(1)
  })
  it.each(['missingCount', 'truncate', 'excessCount'])(
    'refuses incomplete signed reads: %s',
    async (kind) => {
      fixture[kind as 'missingCount' | 'truncate' | 'excessCount'] = true
      expect((await get()).status).toBe(503)
    }
  )
  it.each(['timezone', 'roster', 'duplicate', 'history', 'target', 'seasons'])(
    'refuses malformed %s',
    async (kind) => {
      if (kind === 'timezone') fixture.timezone = 'Synthetic/not-a-zone'
      if (kind === 'roster')
        fixture.roster[0] = member('x'.repeat(257), 'Synthetic')
      if (kind === 'duplicate') fixture.roster.push(member(A, 'Duplicate'))
      if (kind === 'history') fixture.history[0]!.loopIndex = -1
      if (kind === 'target') fixture.targets[0]!.target_tokens = 0
      if (kind === 'seasons') fixture.seasons = { unknown: true }
      expect((await get()).status).toBe(503)
    }
  )
  it('refuses a current roster overflow', async () => {
    fixture.roster = Array.from({ length: 31 }, (_, i) =>
      member(`SYN-${i}`, `Synthetic ${i}`)
    )
    expect((await get()).status).toBe(503)
  })
  it('refuses private authentication exceptions with a static error', async () => {
    fixture.authError = true
    const response = await get()
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('Synthetic private')
  })
  it.each(['db', 'auth', 'history'])(
    'bounds whole-entry stalled %s work to 7000ms',
    async (phase) => {
      vi.useFakeTimers()
      if (phase === 'db') fixture.dbPending = new Promise(() => {})
      if (phase === 'auth') fixture.authPending = new Promise(() => {})
      if (phase === 'history') fixture.stall = 'EOT_GR_data'
      const { GET } = await import('@/app/api/upcoming/token-performance/route')
      const pending = GET(request())
      await vi.advanceTimersByTimeAsync(7001)
      expect((await pending).status).toBe(503)
      expect(
        fixture.requests
          .filter((r) => r.table === 'EOT_GR_data')
          .every((r) => r.signal?.aborted)
      ).toBe(true)
    }
  )
  it('does not start late ban or model reads after canceled authentication settles', async () => {
    let resolveAuth!: (v: unknown) => void
    fixture.authPending = new Promise((resolve) => {
      resolveAuth = resolve
    })
    const controller = new AbortController()
    const pending = get(undefined, controller.signal)
    await vi.waitFor(() => expect(fixture.authCalls).toBe(1))
    controller.abort()
    expect((await pending).status).toBe(408)
    resolveAuth({ data: { user: fixture.user }, error: null })
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.requests).toEqual([])
  })
  it('rejects an already canceled entry before acquiring the database', async () => {
    const controller = new AbortController()
    controller.abort()
    expect((await get(undefined, controller.signal)).status).toBe(408)
    expect(fixture.authCalls).toBe(0)
    expect(fixture.requests).toEqual([])
  })
  it('cancels an in-flight signed read without returning late scores', async () => {
    const controller = new AbortController()
    fixture.stall = 'EOT_GR_data'
    const pending = get(undefined, controller.signal)
    await vi.waitFor(() =>
      expect(fixture.requests.some((r) => r.table === 'EOT_GR_data')).toBe(true)
    )
    controller.abort()
    const response = await pending
    expect(response.status).toBe(408)
    expect(await response.text()).not.toContain('players')
  })
})

describe('saved performance public local service and page context', () => {
  it('returns only captured imported season choices and an opaque scope fence', async () => {
    fixture.seasons = ['101', '9999', '102']
    const { getSavedTokenPerformancePageContext } =
      await import('@/app/lib/boss-assignments/saved-token-performance')
    const context = await getSavedTokenPerformancePageContext()
    expect(context).toMatchObject({
      source: 'saved-local',
      seasons: ['102', '101'],
      season: '102',
      canCalculate: true
    })
    expect(context.contextKey).toMatch(/^[a-f0-9]{64}$/)
    expect(fixture.requests.some((r) => r.table === 'EOT_GR_data')).toBe(false)
  })
  it('returns null season when no captured imported history exists', async () => {
    fixture.seasons = ['9999']
    const { getSavedTokenPerformancePageContext } =
      await import('@/app/lib/boss-assignments/saved-token-performance')
    expect(await getSavedTokenPerformancePageContext()).toMatchObject({
      seasons: [],
      season: null
    })
  })
  it('refuses an explicitly unsupported page season', async () => {
    const { getSavedTokenPerformancePageContext } =
      await import('@/app/lib/boss-assignments/saved-token-performance')
    await expect(
      getSavedTokenPerformancePageContext({ selectedSeason: '9999' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })
  it('admits a real empty stream and bounds endless empty chunks', async () => {
    const { readSavedTokenPerformance } =
      await import('@/app/lib/boss-assignments/saved-token-performance')
    const params = new URLSearchParams({
      view: 'saved',
      season: '101',
      asOf: AS_OF
    })
    expect(
      (
        await readSavedTokenPerformance({
          params,
          body: new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array())
              c.close()
            }
          })
        })
      ).players
    ).toHaveLength(2)
    let canceled = false
    await expect(
      readSavedTokenPerformance({
        params,
        body: new ReadableStream({
          pull(c) {
            c.enqueue(new Uint8Array())
          },
          cancel() {
            canceled = true
          }
        })
      })
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(canceled).toBe(true)
  })
  it('rejects any nonempty body before model reads', async () => {
    const { readSavedTokenPerformance } =
      await import('@/app/lib/boss-assignments/saved-token-performance')
    await expect(
      readSavedTokenPerformance({
        params: new URLSearchParams({
          view: 'saved',
          season: '101',
          asOf: AS_OF
        }),
        body: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('x'))
            c.close()
          }
        })
      })
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(fixture.requests.some((r) => r.table === 'EOT_GR_data')).toBe(false)
  })
  it('cancels a stalled body on the same whole-entry deadline', async () => {
    vi.useFakeTimers()
    let canceled = false
    const { readSavedTokenPerformance } =
      await import('@/app/lib/boss-assignments/saved-token-performance')
    const pending = readSavedTokenPerformance({
      params: new URLSearchParams({
        view: 'saved',
        season: '101',
        asOf: AS_OF
      }),
      body: new ReadableStream({
        cancel() {
          canceled = true
        }
      })
    })
    const assertion = expect(pending).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(7001)
    await assertion
    expect(canceled).toBe(true)
  })
})

describe('existing desktop performance caller compatibility', () => {
  it.each([
    'guild_code=SYN-PERF&season=101&compare_mode=guild&include_per_loop=true&include_historical_players=false&include_primes=true',
    'guild_code=SYN-PERF'
  ])(
    'keeps the established caller request and TokenPerformanceData shape: %s',
    async (query) => {
      fixture.legacy = true
      const { GET } = await import('@/app/api/upcoming/token-performance/route')
      const response = await GET(
        new NextRequest(
          `http://localhost/api/upcoming/token-performance?${query}`
        )
      )
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(Object.keys(data)).toEqual(['Synthetic Twin'])
      expect(data['Synthetic Twin'].Riptide_L1).toMatchObject({
        tokensSpent: 2,
        actualDamage: 3000000,
        score: 1.2
      })
      expect(data).not.toHaveProperty('source')
      expect(data).not.toHaveProperty('players')
      expect(fixture.legacyAuthCalls).toBe(1)
      expect(fixture.legacyGuildChecks).toEqual(['SYN-PERF'])
    }
  )
})

describe('explicit saved-view admission', () => {
  it.each(['view=wrong', 'view=', 'view=saved&view=saved'])(
    'rejects invalid or duplicate %s without falling back to legacy behavior',
    async (view) => {
      const { GET } = await import('@/app/api/upcoming/token-performance/route')
      const response = await GET(
        new NextRequest(
          `http://localhost/api/upcoming/token-performance?${view}&season=101&asOf=${AS_OF}`
        )
      )
      expect(response.status).toBe(400)
      expect(fixture.legacyAuthCalls).toBe(0)
      expect(fixture.requests.some((r) => r.table === 'EOT_GR_data')).toBe(
        false
      )
    }
  )
  it('authenticates an invalid saved-view request before validating it', async () => {
    fixture.user = null
    const { GET } = await import('@/app/api/upcoming/token-performance/route')
    const response = await GET(
      new NextRequest(
        'http://localhost/api/upcoming/token-performance?view=wrong'
      )
    )
    expect(response.status).toBe(401)
    expect(fixture.legacyAuthCalls).toBe(0)
  })
})
