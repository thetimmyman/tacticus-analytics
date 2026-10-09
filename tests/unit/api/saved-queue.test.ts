import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PostgrestClient } from '@supabase/postgrest-js'
import { Errors } from '@/app/lib/errors/AppError'

const fixture = vi.hoisted(() => ({
  user: { id: '11111111-1111-4111-8111-111111111111' } as { id: string } | null,
  role: 'member',
  active: true,
  current: true,
  guild: 'TEST',
  cluster: null as string | null,
  timezone: 'UTC',
  seasons: ['101', '102'],
  extraMember: false,
  membershipReads: 0,
  finalRole: null as string | null,
  finalActive: null as boolean | null,
  failureTable: null as string | null,
  failureSelect: null as string | null,
  stallTable: null as string | null,
  networkFailure: false,
  authError: false,
  authAppError: false,
  banned: false,
  authPending: null as Promise<unknown> | null,
  dbPending: null as Promise<void> | null,
  dbRejected: false,
  authCalls: 0,
  malformedSeasons: false,
  realHp: false,
  truncate: false,
  missingCount: false,
  targetRows: [] as Record<string, unknown>[],
  extraBattles: [] as Record<string, unknown>[],
  featureAccess: true,
  playerId: 'synthetic-player',
  displayName: 'Synthetic member',
  malformedSnapshot: false,
  customHistory: null as Record<string, unknown>[] | null,
  threeStages: false,
  requests: [] as {
    table: string
    method: string
    signal?: AbortSignal | null
    authority: 'signed' | 'ban-service'
  }[]
}))

vi.mock('@/app/lib/db', () => ({
  db: async () => {
    if (fixture.dbRejected)
      throw Errors.external('Synthetic private database diagnostic', 503, {
        cause: 'Synthetic private cause'
      })
    if (fixture.dbPending) await fixture.dbPending
    return client
  },
  serviceDb: () => banClient
}))
vi.unmock('@/app/lib/auth/user-bans')
// Synthetic HP data at the existing data seam. All planner/snapshot/reducer
// modules execute unchanged; the worked example has a 10,000-HP main boss.
vi.mock('@/app/lib/data/boss-hp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/data/boss-hp')>()
  return {
    ...actual,
    getAllBossHp: async () =>
      fixture.threeStages
        ? {
            legendary: { L1: 1000, L2: 3000, L3: 2000 },
            mythic: {},
            byBossName: {},
            primes: {}
          }
        : fixture.realHp
          ? actual.getAllBossHp('TEST')
          : {
              legendary: { L1: 10_000 },
              mythic: {},
              byBossName: { Riptide_L1: 10_000 },
              primes: {}
            }
  }
})

const AS_OF = '2026-06-02T08:00:00.000Z'
type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function rowsFor(table: string): unknown {
  if (table === 'user_bans')
    return fixture.banned
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
  if (table === 'rpc/check_feature_access')
    return {
      has_access: fixture.featureAccess,
      reason: fixture.featureAccess ? 'public' : 'denied',
      stage: 'public'
    }
  if (table === 'rpc/get_distinct_seasons_for_guild')
    return fixture.malformedSeasons ? { invalid: true } : fixture.seasons
  if (
    table === 'player_with_cluster' ||
    table === 'current_user_player_mapping'
  )
    return [
      {
        user_id: fixture.user?.id,
        player_id: fixture.playerId,
        guild_code: fixture.guild,
        role:
          table === 'current_user_player_mapping' &&
          ++fixture.membershipReads > 1
            ? (fixture.finalRole ?? fixture.role)
            : fixture.role,
        cluster_code: fixture.cluster,
        is_current: fixture.current,
        is_active:
          table === 'current_user_player_mapping' && fixture.membershipReads > 1
            ? (fixture.finalActive ?? fixture.active)
            : fixture.active
      }
    ]
  if (table === 'guild_config')
    return [
      {
        guild_code: 'TEST',
        guild_tag: 'TEST',
        display_name: 'Synthetic guild',
        enabled: true,
        cluster_code: fixture.cluster,
        cluster_id: null,
        onboarding_completed: true,
        timezone: fixture.timezone
      }
    ]
  if (table === 'player_mapping')
    return [
      {
        user_id: fixture.user?.id,
        discord_user_id: null,
        player_id: fixture.playerId,
        display_name: fixture.displayName,
        guild_code: 'TEST',
        is_current: true,
        is_active: true
      },
      ...(fixture.extraMember
        ? [
            {
              player_id: 'synthetic-other-player',
              display_name: fixture.displayName,
              guild_code: 'TEST',
              is_current: true,
              is_active: true
            }
          ]
        : [])
    ]
  if (table === 'raid_progression_config')
    return [
      {
        scope: 'TEST',
        is_active: true,
        first_pass_sequence: fixture.threeStages ? ['L1', 'L2', 'L3'] : ['L1'],
        loop_sequence: fixture.threeStages ? ['L1', 'L2', 'L3'] : ['L1'],
        loop_start_stage: 'L1',
        game_version: null
      }
    ]
  if (table === 'boss_target_tokens') return fixture.targetRows
  if (table === 'upcoming_season_bosses') return []
  if (table === 'EOT_GR_data' && fixture.customHistory)
    return fixture.customHistory
  if (table === 'EOT_GR_data')
    return [
      ...fixture.extraBattles,
      {
        Guild: 'TEST',
        Season: '101',
        userId: fixture.playerId,
        displayName: fixture.displayName,
        damageType: 'Battle',
        damageDealt: 100,
        Name: 'Riptide',
        encounterId: 0,
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: fixture.realHp ? 5_000_000 : 10_000,
        remainingHp: fixture.malformedSnapshot
          ? -1
          : fixture.realHp
            ? 4_999_900
            : 9_900,
        startedOn: '2026-06-01T09:00:00.000Z',
        completedOn: '2026-06-01T09:00:00.000Z',
        timestamp: '2026-06-01T09:00:00.000Z'
      },
      {
        Guild: 'TEST',
        Season: '101',
        userId: fixture.playerId,
        displayName: fixture.displayName,
        damageType: 'Bomb',
        damageDealt: 0,
        Name: 'Riptide',
        encounterId: 1,
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 0,
        remainingHp: 0,
        startedOn: '2026-06-01T08:00:00.000Z',
        completedOn: '2026-06-01T08:00:00.000Z',
        timestamp: '2026-06-01T08:00:00.000Z'
      },
      {
        Guild: 'TEST',
        Season: '101',
        userId: fixture.playerId,
        displayName: fixture.displayName,
        damageType: 'Bomb',
        damageDealt: 0,
        Name: 'Riptide',
        encounterId: 2,
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 0,
        remainingHp: 0,
        startedOn: '2026-06-01T08:00:00.000Z',
        completedOn: '2026-06-01T08:00:00.000Z',
        timestamp: '2026-06-01T08:00:00.000Z'
      }
    ]
  throw new Error('Unexpected synthetic relation')
}

const fetchAdapter: typeof fetch = async (input, init) => {
  const url = new URL(String(input))
  const table = url.pathname.replace('/rest/v1/', '')
  const method = init?.method ?? 'GET'
  const authority =
    new Headers(init?.headers).get('X-Synthetic-Authority') === 'ban-service'
      ? 'ban-service'
      : 'signed'
  if (
    authority === 'ban-service' &&
    !['user_bans', 'player_mapping'].includes(table)
  )
    throw new Error('Privileged forecast read forbidden')
  fixture.requests.push({ table, method, signal: init?.signal, authority })
  if (table === fixture.stallTable)
    return new Promise((_, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true }
      )
    })
  if (
    table === fixture.failureTable &&
    (!fixture.failureSelect ||
      url.searchParams.get('select')?.includes(fixture.failureSelect))
  ) {
    if (fixture.networkFailure)
      throw new Error('Synthetic private transport diagnostic')
    return new Response(
      JSON.stringify({
        code: '42501',
        message: 'Synthetic private ACL diagnostic'
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
  let data = rowsFor(table)
  let count: number | null = null
  if (Array.isArray(data) && !table.startsWith('rpc/')) {
    if (!data.every(isRow)) throw new Error('Malformed synthetic relation row')
    let rows = data.map((row) =>
      table === 'EOT_GR_data' ? { ...row, season_num: Number(row.Season) } : row
    )
    for (const [column, filter] of url.searchParams) {
      if (filter.startsWith('eq.')) {
        rows = rows.filter((row) => String(row[column]) === filter.slice(3))
      } else if (filter.startsWith('in.(')) {
        const allowed = filter
          .slice(4, -1)
          .split(',')
          .map((x) => x.replace(/^"|"$/g, ''))
        rows = rows.filter((row) => allowed.includes(String(row[column])))
      } else if (filter.startsWith('gte.')) {
        rows = rows.filter((row) => String(row[column]) >= filter.slice(4))
      } else if (filter.startsWith('lte.')) {
        rows = rows.filter((row) =>
          column === 'season_num'
            ? Number(row[column]) <= Number(filter.slice(4))
            : String(row[column]) <= filter.slice(4)
        )
      }
    }
    count = rows.length
    const limit = Number(url.searchParams.get('limit'))
    if (limit > 0) rows = rows.slice(0, limit)
    if (fixture.truncate && table === 'EOT_GR_data') rows = rows.slice(0, 0)
    if (
      new Headers(init?.headers).get('Accept') ===
      'application/vnd.pgrst.object+json'
    )
      data = rows[0] ?? null
    else data = rows
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

const postgrest = new PostgrestClient('http://127.0.0.1:3001/rest/v1', {
  fetch: fetchAdapter
})
const client = {
  from: postgrest.from.bind(postgrest),
  rpc: postgrest.rpc.bind(postgrest),
  auth: {
    getUser: async () => {
      fixture.authCalls++
      if (fixture.authPending) return fixture.authPending
      if (fixture.authAppError)
        throw Errors.external(
          'Synthetic private authentication diagnostic',
          503,
          { cause: 'Synthetic private cause' }
        )
      if (fixture.authError)
        throw new Error('Synthetic private authentication diagnostic')
      return { data: { user: fixture.user }, error: null }
    }
  }
}
const banPostgrest = new PostgrestClient('http://127.0.0.1:3001/rest/v1', {
  fetch: fetchAdapter,
  headers: { 'X-Synthetic-Authority': 'ban-service' }
})
const banClient = { from: banPostgrest.from.bind(banPostgrest) }

function request(
  body: string = JSON.stringify({ season_number: '101', asOf: AS_OF }),
  query = '',
  signal?: AbortSignal
) {
  return new NextRequest(
    `http://localhost/api/guild-raid/unified-assignments${query}`,
    {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      signal
    }
  )
}
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
  Object.assign(fixture, {
    user: { id: '11111111-1111-4111-8111-111111111111' },
    role: 'officer',
    active: true,
    current: true,
    guild: 'TEST',
    cluster: null,
    timezone: 'UTC',
    seasons: ['101', '102'],
    extraMember: false,
    membershipReads: 0,
    finalRole: null,
    finalActive: null,
    failureTable: null,
    failureSelect: null,
    stallTable: null,
    networkFailure: false,
    authError: false,
    authAppError: false,
    banned: false,
    authPending: null,
    dbPending: null,
    dbRejected: false,
    authCalls: 0,
    malformedSeasons: false,
    realHp: true,
    requests: [],
    truncate: false,
    missingCount: false,
    targetRows: [],
    extraBattles: [],
    featureAccess: true,
    malformedSnapshot: false,
    customHistory: null,
    threeStages: false
  })
})
beforeEach(() => {
  fixture.customHistory = null
  fixture.threeStages = false
  fixture.playerId = 'synthetic-player'
  fixture.displayName = 'Synthetic member'
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
describe('caller-bound saved current queue', () => {
  it.each(['target', 'snapshot'])(
    'refuses malformed %s model data instead of canonical fallback',
    async (kind) => {
      if (kind === 'target')
        fixture.targetRows = [
          {
            guild_code: 'TEST',
            season_number: '101',
            boss_name: 'Riptide',
            rarity: 'Legendary',
            set: 1,
            encounter_id: 0,
            source: 'officer_manual',
            seeded_from_seasons: null,
            skip: 'true',
            target_tokens: 2
          }
        ]
      else fixture.malformedSnapshot = true
      const { POST } =
        await import('@/app/api/guild-raid/unified-assignments/route')
      const response = await POST(request())
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('replacement')
    }
  )

  it('calculates an imported captured season at one explicit instant through canonical models', async () => {
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const response = await POST(request())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.source).toBe('saved-season')
    expect(data.asOf).toBe(AS_OF)
    expect(data.configId).toBe('guild_boss_season_config_2')
    expect(data.players).toMatchObject([
      {
        playerId: 'synthetic-player',
        currentTokens: 3,
        tokensUsedThisSeason: 1,
        spendableByEnd: 3,
        tokensPlanned: 3
      }
    ])
    expect(data.stages).toHaveLength(1)
    expect(data.stages[0]).toMatchObject({
      stageCode: 'L1',
      loopIndex: 0,
      projectedStartAt: AS_OF,
      projections: {
        main: {
          projectedDamage: 300,
          startingHp: 4999900,
          projectedRemainingHp: 4999600,
          tokensPlanned: 3
        }
      }
    })
    expect(data.replacement.assignments).toEqual([
      { player_id: 'synthetic-player', token_allocations: { L1: 3 } }
    ])
    expect(data.metrics.totalTokensPlanned).toBe(3)
    expect(data.feasibility.projectedPrefix).toEqual({
      fullyClearedStageCount: 0,
      firstUnclearedStage: { stageCode: 'L1', loopIndex: 0 }
    })
    expect(
      fixture.requests
        .filter((r) => r.authority === 'signed')
        .every(
          (r) =>
            r.method === 'GET' ||
            r.table === 'rpc/get_distinct_seasons_for_guild' ||
            r.table === 'rpc/check_feature_access'
        )
    ).toBe(true)
  })
})

describe('saved queue admission, completeness and cancellation', () => {
  it.each(['member', 'admin', 'Officer', 'Leader'])(
    'refuses calculation role %s without model reads',
    async (role) => {
      fixture.role = role
      const { POST } =
        await import('@/app/api/guild-raid/unified-assignments/route')
      expect((await POST(request())).status).toBe(403)
      expect(fixture.requests.some((r) => r.table === 'EOT_GR_data')).toBe(
        false
      )
    }
  )
  it.each(['officer', 'leader'])('admits exact lowercase %s', async (role) => {
    fixture.role = role
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    expect((await POST(request())).status).toBe(200)
  })
  it.each(['anonymous', 'inactive', 'stale', 'banned', 'no-feature'])(
    'refuses %s before model reads',
    async (kind) => {
      if (kind === 'anonymous') fixture.user = null
      if (kind === 'inactive') fixture.active = false
      if (kind === 'stale') fixture.current = false
      if (kind === 'banned') fixture.banned = true
      if (kind === 'no-feature') fixture.featureAccess = false
      const { POST } =
        await import('@/app/api/guild-raid/unified-assignments/route')
      expect((await POST(request())).status).toBe(
        kind === 'anonymous' ? 401 : 403
      )
      expect(fixture.requests.some((r) => r.table === 'EOT_GR_data')).toBe(
        false
      )
    }
  )
  it.each([
    [
      '{"season_number":"101","asOf":"' + AS_OF + '","guildCode":"FOREIGN"}',
      400
    ],
    [
      '{"season_number":"101","season_number":"102","asOf":"' + AS_OF + '"}',
      400
    ],
    ['{"season_number":"101","mode":"upcoming","asOf":"' + AS_OF + '"}', 400],
    ['{"season_number":101,"asOf":"' + AS_OF + '"}', 400],
    ['{"season_number":"9999","asOf":"' + AS_OF + '"}', 422],
    ['{"season_number":"103","asOf":"' + AS_OF + '"}', 422],
    ['{"season_number":"101","asOf":"2026-02-30T08:00:00Z"}', 400],
    ['{"season_number":"101","asOf":"2026-06-02T10:00:00Z"}', 422],
    ['{"season_number":"101","asOf":"2026-05-20T09:59:59Z"}', 422],
    ['{"season_number":"101","asOf":"2026-06-02T08:00:00+00:00"}', 400]
  ])('refuses invalid body %s', async (body, status) => {
    fixture.seasons = ['101', '102', '9999']
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    expect((await POST(request(body))).status).toBe(status)
    expect(fixture.requests.some((r) => r.table === 'EOT_GR_data')).toBe(false)
  })
  it.each(['?debug=1', '?season_number=101', '?guildCode=FOREIGN'])(
    'refuses query override %s',
    async (query) => {
      const { POST } =
        await import('@/app/api/guild-raid/unified-assignments/route')
      expect((await POST(request(undefined, query))).status).toBe(400)
      expect(fixture.authCalls).toBe(0)
    }
  )
  it('does not accept capped snapshot or history reads as a complete model', async () => {
    fixture.truncate = true
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('replacement')
  })
  it.each([
    'current_user_player_mapping',
    'guild_config',
    'EOT_GR_data',
    'raid_progression_config',
    'boss_target_tokens',
    'upcoming_season_bosses',
    'rpc/get_distinct_seasons_for_guild',
    'rpc/check_feature_access',
    'user_bans'
  ])('refuses %s read errors with no private diagnostic', async (table) => {
    fixture.failureTable = table
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const response = await POST(request())
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).not.toContain('Synthetic private')
    expect(text).not.toContain('replacement')
  })
  it('refuses a downgrade before serialization and does not cache prior caller data', async () => {
    fixture.finalRole = 'member'
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    expect((await POST(request())).status).toBe(403)
    fixture.membershipReads = 0
    fixture.finalRole = null
    expect((await POST(request())).status).toBe(200)
    fixture.active = false
    fixture.membershipReads = 0
    expect((await POST(request())).status).toBe(403)
  })
  it('returns only captured imported seasons and normalized read authority in page context', async () => {
    fixture.role = 'Officer'
    fixture.seasons = ['9999', '101', '102']
    const { getSavedQueuePageContext } =
      await import('@/app/lib/boss-assignments/saved-queue')
    const context = await getSavedQueuePageContext()
    expect(context).toMatchObject({
      source: 'saved-local',
      seasons: ['102', '101'],
      season: '102',
      canCalculate: false
    })
    expect(context.contextKey).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(context)).not.toContain('synthetic-player')
    expect(
      fixture.requests.some(
        (r) =>
          (r.table === 'player_mapping' && r.authority === 'signed') ||
          r.table === 'EOT_GR_data'
      )
    ).toBe(false)
    await expect(
      getSavedQueuePageContext({ selectedSeason: '9999' })
    ).rejects.toMatchObject({ statusCode: 422 })
  })
  it('keeps an empty imported captured list readable with no implicit global season', async () => {
    fixture.seasons = ['9999']
    fixture.role = 'member'
    const { getSavedQueuePageContext } =
      await import('@/app/lib/boss-assignments/saved-queue')
    expect(await getSavedQueuePageContext()).toMatchObject({
      seasons: [],
      season: null,
      canCalculate: false
    })
  })
  it('bounds a stalled authentication and prevents its late completion from starting reads', async () => {
    vi.useFakeTimers()
    let resolveAuth: (x: unknown) => void = () => {}
    fixture.authPending = new Promise((resolve) => {
      resolveAuth = resolve
    })
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const pending = POST(request())
    await vi.advanceTimersByTimeAsync(7001)
    expect((await pending).status).toBe(503)
    resolveAuth({ data: { user: fixture.user }, error: null })
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.requests).toEqual([])
  })
  it.each(['guild_config', 'EOT_GR_data', 'current_user_player_mapping'])(
    'aborts stalled %s SDK reads at one owned seven-second deadline',
    async (table) => {
      vi.useFakeTimers()
      fixture.stallTable = table
      const { POST } =
        await import('@/app/api/guild-raid/unified-assignments/route')
      const pending = POST(request())
      await vi.advanceTimersByTimeAsync(7001)
      expect((await pending).status).toBe(503)
      expect(fixture.requests.filter((r) => r.table === table)).toHaveLength(1)
      expect(
        fixture.requests.filter((r) => r.table === table)[0]?.signal?.aborted
      ).toBe(true)
    }
  )
  it('rejects an already canceled request without authentication or later reads', async () => {
    const controller = new AbortController()
    controller.abort()
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    expect((await POST(request(undefined, '', controller.signal))).status).toBe(
      408
    )
    expect(fixture.authCalls).toBe(0)
    expect(fixture.requests).toEqual([])
  })
  it('checks synchronous elapsed budget before returning even if the timer has not run', async () => {
    const clock = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => (fixture.membershipReads >= 2 ? 7001 : 0))
    try {
      const { POST } =
        await import('@/app/api/guild-raid/unified-assignments/route')
      expect((await POST(request())).status).toBe(503)
    } finally {
      clock.mockRestore()
    }
  })
})

describe('canonical calculation integration', () => {
  it('refuses the whole queue when canonical output reuses regeneration lost at cap', async () => {
    fixture.threeStages = true
    const base = {
      Guild: 'TEST',
      Season: '100',
      userId: 'synthetic-player',
      displayName: 'Synthetic member',
      damageType: 'Battle',
      damageDealt: 1000,
      Name: 'Riptide',
      encounterId: 0,
      rarity: 'Legendary',
      set: 0,
      loopIndex: 0,
      maxHp: 1000,
      remainingHp: 1000
    }
    const prior = Date.parse('2026-05-15T00:00:00.000Z')
    fixture.customHistory = [
      ...[0, 18 * 3600000, 36 * 3600000].map((offset) => ({
        ...base,
        startedOn: new Date(prior + offset).toISOString(),
        completedOn: new Date(prior + offset).toISOString(),
        timestamp: new Date(prior + offset).toISOString()
      })),
      ...[0, 500, 1000].map((offset) => ({
        ...base,
        set: 1,
        startedOn: new Date(prior + 36 * 3600000 + offset).toISOString(),
        completedOn: new Date(prior + 36 * 3600000 + offset).toISOString(),
        timestamp: new Date(prior + 36 * 3600000 + offset).toISOString()
      })),
      {
        ...base,
        Season: '101',
        startedOn: '2026-05-29T09:00:00.000Z',
        completedOn: '2026-05-29T09:00:00.000Z',
        timestamp: '2026-05-29T09:00:00.000Z'
      }
    ]
    fixture.targetRows = [1, 3, 2].map((target, i) => ({
      guild_code: 'TEST',
      season_number: '101',
      boss_name: 'Riptide',
      rarity: 'Legendary',
      set: i + 1,
      encounter_id: 0,
      source: 'officer_manual',
      seeded_from_seasons: null,
      skip: false,
      target_tokens: target
    }))
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const response = await POST(
      request(
        JSON.stringify({
          season_number: '101',
          asOf: '2026-05-30T10:00:00.000Z'
        })
      )
    )
    expect(response.status).toBe(422)
    const text = await response.text()
    expect(text).toContain('not token-feasible')
    expect(text).not.toContain('replacement')
  })
  it('keeps duplicate labels separate by stable player identity', async () => {
    fixture.extraMember = true
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const response = await POST(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.players).toHaveLength(2)
    expect(
      new Set(
        body.replacement.assignments.map(
          (p: { player_id: string }) => p.player_id
        )
      ).size
    ).toBe(2)
    expect(body.replacement.assignments[0].player_id).not.toBe(
      body.replacement.assignments[1].player_id
    )
  })
})

describe('saved intent and precision contract', () => {
  it.each([129, 256])(
    'preserves admitted %i-character stable identity',
    async (length) => {
      fixture.playerId = 'P'.repeat(length)
      const { POST } =
        await import('@/app/api/guild-raid/unified-assignments/route')
      const response = await POST(request())
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.players[0].playerId).toBe(fixture.playerId)
      expect(data.replacement.assignments[0].player_id).toBe(fixture.playerId)
    }
  )
  it('refuses a 257-character identity before returning saved intent', async () => {
    fixture.playerId = 'P'.repeat(257)
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('replacement')
  })
  it.each([201, 1024])(
    'preserves admitted %i-character presentation labels',
    async (length) => {
      fixture.displayName = 'N'.repeat(length)
      const { POST } =
        await import('@/app/api/guild-raid/unified-assignments/route')
      const response = await POST(request())
      expect(response.status).toBe(200)
      expect((await response.json()).players[0].displayName).toBe(
        fixture.displayName
      )
    }
  )
  it('refuses a sub-millisecond historical median before date serialization can round it', async () => {
    const base = {
      Guild: 'TEST',
      userId: 'synthetic-player',
      displayName: 'Synthetic member',
      damageType: 'Battle',
      damageDealt: 100,
      Name: 'Riptide',
      encounterId: 0,
      rarity: 'Legendary',
      set: 0,
      loopIndex: 0,
      maxHp: 5000000,
      remainingHp: 4999900
    }
    fixture.extraBattles = [
      ...['99', '100'].flatMap((Season, index) =>
        [0, 0, index + 1].map((offset) => ({
          ...base,
          Season,
          startedOn: new Date(
            Date.parse('2026-05-15T00:00:00.000Z') + offset
          ).toISOString(),
          completedOn: new Date(
            Date.parse('2026-05-15T00:00:00.000Z') + offset
          ).toISOString(),
          timestamp: new Date(
            Date.parse('2026-05-15T00:00:00.000Z') + offset
          ).toISOString()
        }))
      )
    ]
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const response = await POST(request())
    expect(response.status).toBe(422)
    expect(await response.text()).not.toContain('replacement')
  })
})

describe('saved replacement round trip', () => {
  it('sums repeated loop slots into valid bounded intent without representing a schedule', async () => {
    fixture.realHp = false
    fixture.customHistory = (rowsFor('EOT_GR_data') as Row[]).map((row) => ({
      ...row,
      startedOn: '2026-05-31T09:00:00.000Z',
      completedOn: '2026-05-31T09:00:00.000Z',
      timestamp: '2026-05-31T09:00:00.000Z',
      ...(row.encounterId === 0
        ? { damageDealt: 20000, remainingHp: 10000 }
        : {})
    }))
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const response = await POST(
      request(
        JSON.stringify({
          season_number: '101',
          asOf: '2026-06-01T08:00:00.000Z'
        })
      )
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(
      data.stages.map((stage: { loopIndex: number }) => stage.loopIndex)
    ).toEqual([0, 1, 2])
    // Canonical minimum is two per stage; the final slot uses the one-token remainder.
    expect(
      data.stages.map((stage: { assignments: { tokens: number }[] }) =>
        stage.assignments.map((a) => a.tokens)
      )
    ).toEqual([[2], [2], [1]])
    expect(data.replacement.assignments).toEqual([
      { player_id: 'synthetic-player', token_allocations: { L1: 5 } }
    ])
    expect(data.players[0]).toMatchObject({
      spendableByEnd: 5,
      tokensPlanned: 5
    })
    const { parseReplacement } =
      await import('@/app/lib/boss-assignments/saved-assignments-input')
    const { getSeasonConfigForSeasonNumber } =
      await import('@/app/lib/loki/season-configs')
    const captured = getSeasonConfigForSeasonNumber(101)!
    expect(
      parseReplacement(data.replacement, captured.bosses).assignments
    ).toEqual(data.replacement.assignments)
    expect(
      fixture.requests.every(
        (r) => r.method === 'GET' || r.table.startsWith('rpc/')
      )
    ).toBe(true)
  })
  it('refuses a response without a complete exact count', async () => {
    fixture.missingCount = true
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('replacement')
  })
  it('refuses snapshot truncation above its canonical 1000-row query cap', async () => {
    const row = (rowsFor('EOT_GR_data') as Row[])[0]!
    fixture.extraBattles = Array.from({ length: 1001 }, () => ({ ...row }))
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('replacement')
  })
  it('does not use unrelated future-season imports in an earlier selected calculation', async () => {
    fixture.extraBattles = [
      {
        ...(rowsFor('EOT_GR_data') as Row[])[0]!,
        Season: '102',
        damageDealt: 999999
      }
    ]
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(
      (await response.json()).stages[0].projections.main.projectedDamage
    ).toBe(300)
  })
})

describe('saved queue entry failure privacy', () => {
  it.each(['db', 'auth', 'auth-app'] as const)(
    'sanitizes %s failures before signed model reads',
    async (kind) => {
      fixture.dbRejected = kind === 'db'
      fixture.authError = kind === 'auth'
      fixture.authAppError = kind === 'auth-app'
      const { POST } =
        await import('@/app/api/guild-raid/unified-assignments/route')
      const response = await POST(request())
      expect(response.status).toBe(503)
      const text = await response.text()
      expect(text).not.toContain('Synthetic private')
      expect(text).not.toContain('cause')
      expect(text).not.toContain('replacement')
      expect(fixture.requests).toEqual([])
    }
  )
  it('does not retry an actual SDK network rejection or return a snapshot fallback', async () => {
    fixture.failureTable = 'EOT_GR_data'
    fixture.networkFailure = true
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('Synthetic private')
    expect(
      fixture.requests.filter((r) => r.table === 'EOT_GR_data')
    ).toHaveLength(1)
  })
  it('propagates caller cancellation to an actual in-flight SDK read without later model queries', async () => {
    fixture.stallTable = 'guild_config'
    const controller = new AbortController()
    const { POST } =
      await import('@/app/api/guild-raid/unified-assignments/route')
    const pending = POST(request(undefined, '', controller.signal))
    await vi.waitFor(() =>
      expect(fixture.requests.some((r) => r.table === 'guild_config')).toBe(
        true
      )
    )
    controller.abort()
    expect((await pending).status).toBe(408)
    expect(
      fixture.requests.find((r) => r.table === 'guild_config')!.signal!.aborted
    ).toBe(true)
    expect(fixture.requests.some((r) => r.table === 'EOT_GR_data')).toBe(false)
  })
})

it('refuses damage outside the canonical local import bound before modeling', async () => {
  fixture.extraBattles = [
    { ...(rowsFor('EOT_GR_data') as Row[])[0]!, damageDealt: 1000000000001 }
  ]
  const { POST } =
    await import('@/app/api/guild-raid/unified-assignments/route')
  const response = await POST(request())
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('replacement')
})
