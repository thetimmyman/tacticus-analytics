import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PostgrestClient } from '@supabase/postgrest-js'
import { mainCache } from '@tacticus/app-core/unified-cache'
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
  authCalls: 0,
  malformedSeasons: false,
  realHp: false,
  requests: [] as {
    table: string
    method: string
    signal?: AbortSignal | null
    authority: 'signed' | 'ban-service'
  }[]
}))

vi.mock('@/app/lib/db', () => ({
  db: async () => {
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
      fixture.realHp
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
const END = '2026-06-02T10:00:00.000Z'
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
  if (table === 'rpc/get_distinct_seasons_for_guild')
    return fixture.malformedSeasons ? { invalid: true } : fixture.seasons
  if (
    table === 'player_with_cluster' ||
    table === 'current_user_player_mapping'
  )
    return [
      {
        user_id: fixture.user?.id,
        player_id: 'synthetic-player',
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
        player_id: 'synthetic-player',
        display_name: 'Synthetic member',
        guild_code: 'TEST',
        is_current: true
      },
      ...(fixture.extraMember
        ? [
            {
              player_id: 'synthetic-other-player',
              display_name: 'Synthetic other member',
              guild_code: 'TEST',
              is_current: true
            }
          ]
        : [])
    ]
  if (table === 'raid_progression_config')
    return [
      {
        scope: 'TEST',
        is_active: true,
        first_pass_sequence: ['L1'],
        loop_sequence: ['L1'],
        loop_start_stage: 'L1',
        game_version: null
      }
    ]
  if (table === 'boss_target_tokens' || table === 'upcoming_season_bosses')
    return []
  if (table === 'EOT_GR_data')
    return [
      {
        Guild: 'TEST',
        Season: '101',
        userId: 'synthetic-player',
        displayName: 'Synthetic member',
        damageType: 'Battle',
        damageDealt: 100,
        Name: 'Riptide',
        encounterId: 0,
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: fixture.realHp ? 5_000_000 : 10_000,
        remainingHp: fixture.realHp ? 4_999_900 : 9_900,
        startedOn: '2026-06-01T09:00:00.000Z',
        completedOn: '2026-06-01T09:00:00.000Z',
        timestamp: '2026-06-01T09:00:00.000Z'
      },
      {
        Guild: 'TEST',
        Season: '101',
        userId: 'synthetic-player',
        displayName: 'Synthetic member',
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
        userId: 'synthetic-player',
        displayName: 'Synthetic member',
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
  if (Array.isArray(data) && !table.startsWith('rpc/')) {
    if (!data.every(isRow)) throw new Error('Malformed synthetic relation row')
    let rows = data
    for (const [column, filter] of url.searchParams) {
      if (filter.startsWith('eq.')) {
        rows = rows.filter((row) => String(row[column]) === filter.slice(3))
      } else if (filter.startsWith('in.(')) {
        const allowed = filter
          .slice(4, -1)
          .split(',')
          .map((x) => x.replace(/^"|"$/g, ''))
        rows = rows.filter((row) => allowed.includes(String(row[column])))
      } else if (filter.startsWith('lte.')) {
        rows = rows.filter((row) => String(row[column]) <= filter.slice(4))
      }
    }
    if (
      new Headers(init?.headers).get('Accept') ===
      'application/vnd.pgrst.object+json'
    )
      data = rows[0] ?? null
    else data = rows
  }
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
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
  query = `guildCode=TEST&season=101&asOf=${AS_OF}`,
  signal?: AbortSignal
) {
  return new NextRequest(
    `http://localhost/api/season-forecast/outlook?${query}`,
    { signal }
  )
}

beforeEach(() => {
  mainCache.clear()
  vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
  fixture.user = { id: '11111111-1111-4111-8111-111111111111' }
  fixture.role = 'member'
  fixture.active = true
  fixture.current = true
  fixture.guild = 'TEST'
  fixture.cluster = null
  fixture.timezone = 'UTC'
  fixture.seasons = ['101', '102']
  fixture.extraMember = false
  fixture.membershipReads = 0
  fixture.finalRole = null
  fixture.finalActive = null
  fixture.failureTable = null
  fixture.failureSelect = null
  fixture.stallTable = null
  fixture.networkFailure = false
  fixture.authError = false
  fixture.authAppError = false
  fixture.banned = false
  fixture.authPending = null
  fixture.dbPending = null
  fixture.authCalls = 0
  fixture.malformedSeasons = false
  fixture.realHp = false
  fixture.requests = []
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('caller-bound saved season outlook', () => {
  it('refuses an over-budget model after the final signed authority read even before timers run', async () => {
    const clock = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => (fixture.membershipReads >= 2 ? 7001 : 0))
    try {
      const { GET } = await import('@/app/api/season-forecast/outlook/route')
      const response = await GET(request())
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('projection')
      expect(fixture.membershipReads).toBe(2)
      expect(
        fixture.requests.filter(({ table }) => table === 'EOT_GR_data')
      ).toHaveLength(4)
    } finally {
      clock.mockRestore()
    }
  })
  it('does not trust an application-shaped authentication error message or metadata', async () => {
    fixture.authAppError = true
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('Synthetic private')
    expect(fixture.requests).toEqual([])
  })
  it('retains the checked-in five-million-HP calculation with the same token/damage literals', async () => {
    fixture.realHp = true
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.model.appliedDamage).toBe(300)
    expect(body.projection.projectedForwardSpend).toBe(3)
    expect(body.projection.finish.pctIntoFinalStage).toBeCloseTo(0.00008, 12)
    expect(body.projection.finish.bossesDefeatedForward).toBe(0)
    expect(body.projection.confidence).toBe('low')
  })
  it('sanitizes pre-model authentication failures without diagnostic cause metadata', async () => {
    fixture.authError = true
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    const response = await GET(request())
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).not.toContain('Synthetic private')
    expect(text).not.toContain('cause')
    expect(fixture.requests).toEqual([])
  })

  it('fails closed on guild admission ACL error rather than fallback or cached availability', async () => {
    fixture.failureTable = 'guild_config'
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(
      fixture.requests.filter(({ table }) => table === 'guild_config')
    ).toHaveLength(1)
    expect(fixture.requests.some(({ table }) => table === 'EOT_GR_data')).toBe(
      false
    )
  })
  it('scopes a role downgraded during calculation before serializing player rows', async () => {
    fixture.role = 'officer'
    fixture.finalRole = 'member'
    fixture.extraMember = true
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(
      (await response.json()).players.map(
        (row: { playerId: string }) => row.playerId
      )
    ).toEqual(['synthetic-player'])
    expect(fixture.membershipReads).toBe(2)
  })
  it('calculates an imported captured past season with unchanged generator and reducer', async () => {
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.saved).toEqual({
      status: 'ready',
      source: 'saved-season',
      season: '101',
      configId: 'guild_boss_season_config_2',
      asOf: AS_OF,
      timeZone: 'UTC'
    })
    expect(body.projection).toMatchObject({
      generatedAt: AS_OF,
      secondsRemaining: 7200,
      memberCount: 1,
      projectedForwardSpend: 3,
      projectedWaste: 0,
      confidence: 'low',
      finish: { stageCode: 'L1', loopIndex: 0, bossesDefeatedForward: 0 }
    })
    expect(body.projection.finish.pctIntoFinalStage).toBeCloseTo(0.04, 12)
    expect(body.model).toEqual({ appliedDamage: 300 })
    expect(
      body.players.map((row: { playerId: string }) => row.playerId)
    ).toEqual(['synthetic-player'])
    expect(Date.parse(END) - Date.parse(AS_OF)).toBe(7_200_000)
    expect(
      fixture.requests.every(
        ({ method, table }) =>
          method === 'GET' || table === 'rpc/get_distinct_seasons_for_guild'
      )
    ).toBe(true)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(
      fixture.requests.filter(({ table }) => table === 'boss_target_tokens')
    ).toHaveLength(1)
    expect(
      fixture.requests.filter(({ table }) => table === 'upcoming_season_bosses')
    ).toHaveLength(1)
    expect(
      fixture.requests.filter(({ table }) => table === 'EOT_GR_data')
    ).toHaveLength(4)
    expect(
      fixture.requests.filter(({ table }) => table === 'user_bans')
    ).toHaveLength(2)
    expect(fixture.authCalls).toBe(1)
    const guarded = fixture.requests.filter(
      ({ table }) => table !== 'player_with_cluster'
    )
    expect(
      guarded.filter(({ signal }) => signal).length
    ).toBeGreaterThanOrEqual(10)
  })

  it.each([
    'member',
    'admin',
    'MEMBER',
    'officer',
    'leader',
    'OFFICER',
    'LEADER'
  ])(
    'scopes actual generated player rows for current role %s',
    async (role) => {
      fixture.role = role
      fixture.extraMember = true
      const { GET } = await import('@/app/api/season-forecast/outlook/route')
      const response = await GET(request())
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.projection.memberCount).toBe(2)
      expect(
        body.players.map((row: { playerId: string }) => row.playerId)
      ).toEqual(
        ['officer', 'leader'].includes(role.toLowerCase())
          ? ['synthetic-player', 'synthetic-other-player']
          : ['synthetic-player']
      )
      expect(body).not.toHaveProperty('plan')
      expect(body).not.toHaveProperty('snapshot')
    }
  )

  it.each([
    'inactive',
    'stale',
    'foreign',
    'foreign-same-cluster',
    'anonymous'
  ])(
    'refuses %s authority without calculating or writing',
    async (condition) => {
      if (condition === 'inactive') fixture.active = false
      if (condition === 'stale') fixture.current = false
      if (condition.startsWith('foreign')) fixture.guild = 'FOREIGN'
      if (condition === 'foreign-same-cluster') {
        fixture.cluster = 'SYNTHETIC-CLUSTER'
        fixture.role = 'officer'
      }
      if (condition === 'anonymous') fixture.user = null
      const { GET } = await import('@/app/api/season-forecast/outlook/route')
      const response = await GET(request())
      expect(response.status).toBe(condition === 'anonymous' ? 401 : 403)
      expect(await response.json()).not.toHaveProperty('projection')
      expect(
        fixture.requests.some(({ table }) => table === 'EOT_GR_data')
      ).toBe(false)
      expect(fixture.requests.every(({ method }) => method === 'GET')).toBe(
        true
      )
    }
  )

  it('refuses membership revoked while the model was calculating', async () => {
    fixture.finalActive = false
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(await response.json()).not.toHaveProperty('projection')
    expect(fixture.membershipReads).toBe(2)
  })

  it('never reuses an officer detail or a read-error result for the next caller state', async () => {
    fixture.extraMember = true
    fixture.role = 'officer'
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    expect((await (await GET(request())).json()).players).toHaveLength(2)
    fixture.role = 'member'
    expect((await (await GET(request())).json()).players).toHaveLength(1)
    fixture.failureTable = 'upcoming_season_bosses'
    expect((await GET(request())).status).toBe(503)
    fixture.failureTable = null
    expect((await GET(request())).status).toBe(200)
    expect(
      fixture.requests.filter(({ table }) => table === 'boss_target_tokens')
    ).toHaveLength(4)
  })

  it.each([
    '',
    `guildCode=TEST&season=101`,
    `season=101&asOf=${AS_OF}`,
    `guildCode=TEST&asOf=${AS_OF}`,
    `guildCode=TEST&season=101x&asOf=${AS_OF}`,
    `guildCode=TEST&season=0101&asOf=${AS_OF}`,
    `guildCode=TEST&season=0&asOf=${AS_OF}`,
    `guildCode=TEST&season=-101&asOf=${AS_OF}`,
    `guildCode=TEST&season=1000000&asOf=${AS_OF}`,
    `guildCode=TEST&season=101&asOf=${AS_OF}&season=102`,
    `guildCode=TEST&season=101&asOf=${AS_OF}&guildCode=FOREIGN`,
    `guildCode=TEST&season=101&asOf=${AS_OF}&asOf=${AS_OF}`,
    `guildCode=TEST&season=101&asOf=${AS_OF}&source=live`,
    `guildCode=TEST&season=101&asOf=${AS_OF}&timeZone=Asia%2FTokyo`,
    `guildCode=TEST&season=101&asOf=2026-02-30T08:00:00.000Z`,
    `guildCode=TEST&season=101&asOf=2026-06-02`,
    `guildCode=TEST&season=101&asOf=2026-06-02T08:00:00`,
    `guildCode=TEST&season=101&asOf=2026-06-02T08:00:00.000%2B00:00`,
    `guildCode=%20TEST&season=101&asOf=${AS_OF}`,
    `guildCode=TEST%0A&season=101&asOf=${AS_OF}`
  ])('rejects malformed/duplicate/unknown local query %s', async (query) => {
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    const response = await GET(request(query))
    expect(response.status).toBe(400)
    expect(fixture.requests).toEqual([])
  })

  it.each([
    ['99', AS_OF],
    ['9999', AS_OF],
    ['101', '2026-05-20T09:59:59.999Z'],
    ['101', END],
    ['101', '2026-06-02T10:00:00.001Z']
  ])(
    'refuses unavailable or out-of-window season %s/asOf %s',
    async (season, asOf) => {
      if (season === '9999') fixture.seasons.push('9999')
      const { GET } = await import('@/app/api/season-forecast/outlook/route')
      const response = await GET(
        request(`guildCode=TEST&season=${season}&asOf=${asOf}`)
      )
      expect(response.status).toBe(422)
      expect(
        fixture.requests.some(({ table }) => table === 'EOT_GR_data')
      ).toBe(false)
    }
  )

  it('accepts whole-second UTC input and returns the canonical millisecond instant', async () => {
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    const response = await GET(
      request('guildCode=TEST&season=101&asOf=2026-06-02T08:00:00Z')
    )
    expect(response.status).toBe(200)
    expect((await response.json()).saved.asOf).toBe(AS_OF)
  })

  it('preserves a valid saved timezone instead of silently using browser UTC', async () => {
    fixture.timezone = 'Asia/Tokyo'
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect((await response.json()).saved.timeZone).toBe('Asia/Tokyo')
  })

  it.each(['Invalid/Timezone', '', 'x'.repeat(129)])(
    'refuses invalid guild timezone %s',
    async (timezone) => {
      fixture.timezone = timezone
      const { GET } = await import('@/app/api/season-forecast/outlook/route')
      const response = await GET(request())
      expect(response.status).toBe(422)
      expect(
        fixture.requests.some(({ table }) => table === 'EOT_GR_data')
      ).toBe(false)
    }
  )

  it.each([
    ['current_user_player_mapping', null],
    ['rpc/get_distinct_seasons_for_guild', null],
    ['guild_config', 'timezone'],
    ['boss_target_tokens', null],
    ['upcoming_season_bosses', null],
    ['raid_progression_config', null],
    ['EOT_GR_data', 'remainingHp'],
    ['EOT_GR_data', 'userId'],
    ['player_mapping', 'display_name'],
    ['user_bans', null]
  ])(
    'fails closed on actual SDK ACL errors from %s/%s',
    async (table, select) => {
      fixture.failureTable = table
      fixture.failureSelect = select
      const { GET } = await import('@/app/api/season-forecast/outlook/route')
      const response = await GET(request())
      expect(response.status).toBe(503)
      const body = await response.text()
      expect(body).not.toContain('Synthetic private')
      expect(body).not.toContain('42501')
      expect(body).not.toContain('projection')
    }
  )

  it('fails closed on transport rejection without SDK retries or diagnostic disclosure', async () => {
    fixture.failureTable = 'boss_target_tokens'
    fixture.networkFailure = true
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('Synthetic private')
    expect(
      fixture.requests.filter(({ table }) => table === 'boss_target_tokens')
    ).toHaveLength(1)
    expect(
      fixture.requests
        .filter(({ signal }) => signal)
        .every(({ signal }) => signal?.aborted)
    ).toBe(true)
  })

  it('aborts an in-flight signed read after the owned seven-second deadline', async () => {
    vi.useFakeTimers()
    fixture.stallTable = 'current_user_player_mapping'
    const { computeSavedSeasonOutlook } =
      await import('@/app/lib/season-forecast/saved-outlook')
    const promise = computeSavedSeasonOutlook({
      guildCode: 'TEST',
      season: '101',
      asOf: AS_OF,
      signal: new AbortController().signal
    })
    const outcome = expect(promise).rejects.toMatchObject({
      statusCode: 503,
      message: 'Saved outlook calculation timed out'
    })
    await vi.advanceTimersByTimeAsync(6999)
    expect(
      fixture.requests.filter(
        ({ table }) => table === 'current_user_player_mapping'
      )
    ).toHaveLength(1)
    expect(
      fixture.requests.every(({ signal }) => signal?.aborted === false)
    ).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    await outcome
    expect(
      fixture.requests.every(({ signal }) => signal?.aborted === true)
    ).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates request cancellation and clears its owned timer and listener', async () => {
    vi.useFakeTimers()
    fixture.stallTable = 'current_user_player_mapping'
    const abort = new AbortController()
    const remove = vi.spyOn(abort.signal, 'removeEventListener')
    const { computeSavedSeasonOutlook } =
      await import('@/app/lib/season-forecast/saved-outlook')
    const promise = computeSavedSeasonOutlook({
      guildCode: 'TEST',
      season: '101',
      asOf: AS_OF,
      signal: abort.signal
    })
    const outcome = expect(promise).rejects.toMatchObject({ statusCode: 408 })
    await vi.advanceTimersByTimeAsync(0)
    abort.abort()
    await outcome
    expect(fixture.requests[0].signal?.aborted).toBe(true)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start a read for an already canceled request', async () => {
    const abort = new AbortController()
    abort.abort()
    const { computeSavedSeasonOutlook } =
      await import('@/app/lib/season-forecast/saved-outlook')
    await expect(
      computeSavedSeasonOutlook({
        guildCode: 'TEST',
        season: '101',
        asOf: AS_OF,
        signal: abort.signal
      })
    ).rejects.toMatchObject({ statusCode: 408 })
    expect(fixture.requests).toEqual([])
    expect(fixture.authCalls).toBe(0)
  })

  it('preserves canonical banned-account refusal before membership or model reads', async () => {
    fixture.banned = true
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('Account suspended')
    expect(
      fixture.requests.some(({ authority }) => authority === 'signed')
    ).toBe(false)
  })

  it('rejects malformed imported-season RPC data before invoking the model', async () => {
    fixture.malformedSeasons = true
    const { GET } = await import('@/app/api/season-forecast/outlook/route')
    expect((await GET(request())).status).toBe(503)
    expect(fixture.requests.some(({ table }) => table === 'EOT_GR_data')).toBe(
      false
    )
  })

  it.each(['database', 'authentication'])(
    'bounds pre-model %s and prevents late completion from starting more queries',
    async (phase) => {
      vi.useFakeTimers()
      let release: (() => void) | undefined
      if (phase === 'database')
        fixture.dbPending = new Promise<void>((resolve) => {
          release = resolve
        })
      else
        fixture.authPending = new Promise((resolve) => {
          release = () => resolve({ data: { user: fixture.user }, error: null })
        })
      const { GET } = await import('@/app/api/season-forecast/outlook/route')
      const pending = GET(request())
      await vi.advanceTimersByTimeAsync(7000)
      const response = await pending
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('cause')
      release!()
      await vi.advanceTimersByTimeAsync(0)
      expect(fixture.requests).toEqual([])
      expect(fixture.authCalls).toBe(phase === 'database' ? 0 : 1)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it.each(['user_bans', 'guild_config'])(
    'bounds actual canonical %s admission reads with the same seven-second budget',
    async (table) => {
      vi.useFakeTimers()
      fixture.stallTable = table
      const { GET } = await import('@/app/api/season-forecast/outlook/route')
      const pending = GET(request())
      await vi.advanceTimersByTimeAsync(7000)
      const response = await pending
      expect(response.status).toBe(503)
      const count = fixture.requests.length
      expect(
        fixture.requests.filter((request) => request.table === table)
      ).toHaveLength(1)
      expect(fixture.requests.every(({ signal }) => signal?.aborted)).toBe(true)
      await vi.advanceTimersByTimeAsync(10000)
      expect(fixture.requests).toHaveLength(count)
      expect(
        fixture.requests.some(({ table }) => table === 'EOT_GR_data')
      ).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    }
  )
})
