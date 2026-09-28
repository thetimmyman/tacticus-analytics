import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

// The planner read ignores bossType, so every bossType is busted, enumerated from `boss_mapping`
// since appCache has no prefix scan.

let mockDb: ReturnType<typeof vi.fn>
let delMock: ReturnType<typeof vi.fn>

interface ProfileRow {
  role: string | null
  guild_code: string | null
  display_name: string | null
}

const BOSS_MAPPING_ROWS = [
  { boss_type: 'Magnus' },
  { boss_type: 'Magnus' },
  { boss_type: 'Mortarion' }
]

const buildSupabase = ({
  profile = {
    role: 'officer',
    guild_code: 'AAAA',
    display_name: 'Boss'
  } as ProfileRow | null,
  bossMappingRows = BOSS_MAPPING_ROWS as Array<Record<string, unknown>> | null,
  bossMappingError = null as unknown,
  updateError = null as unknown
} = {}) => ({
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } })
  },
  from: vi.fn().mockImplementation((table: string) => {
    if (table === 'player_mapping') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: profile, error: null })
      }
    }
    if (table === 'guild_config') {
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null })
      }
    }
    if (table === 'boss_mapping') {
      return {
        select: vi.fn().mockResolvedValue({
          data: bossMappingRows,
          error: bossMappingError
        })
      }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ id: 'row-1', sub_bosses: {}, boss_name: 'Magnus' }],
        error: null
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: updateError ? null : [{ id: 'row-1' }],
            error: updateError
          })
        })
      }),
      insert: vi.fn().mockResolvedValue({ error: null })
    }
  })
})

const loadRoutes = async () => {
  const skipPrime = await import('@/app/api/season-config/skip-prime/route')
  const killThreshold =
    await import('@/app/api/season-config/kill-threshold/route')
  const notesMode = await import('@/app/api/season-config/notes-mode/route')
  return {
    skipPrime: skipPrime.POST,
    killThreshold: killThreshold.POST,
    notesMode: notesMode.POST
  }
}

const makeRequest = (path: string, body: unknown) =>
  new NextRequest(`http://localhost/api/season-config/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

describe('season-config writes bust the aggregator read cache', () => {
  let routes: Awaited<ReturnType<typeof loadRoutes>>

  beforeEach(async () => {
    vi.resetModules()
    mockDb = vi.fn()
    delMock = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))
    vi.doMock('@tacticus/app-core/app-cache', () => ({
      appCache: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        del: delMock
      }
    }))
    mockDb.mockResolvedValue(buildSupabase())
    routes = await loadRoutes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const skipBody = {
    guild_code: 'AAAA',
    season_number: '5',
    level: 'L4',
    sub_index: 1,
    skip: true
  }
  const thresholdBody = {
    guild_code: 'AAAA',
    season_number: '5',
    level: 'L4',
    sub_index: 2,
    kill_threshold_pct: 40
  }
  const notesBody = {
    guild_code: 'AAAA',
    season_number: '5',
    level: 'L4',
    main_notes: 'focus the adds'
  }

  it('skip-prime busts one key per distinct bossType at (guild, raritySet, season)', async () => {
    const res = await routes.skipPrime(makeRequest('skip-prime', skipBody))
    expect(res.status).toBe(200)

    const keys = delMock.mock.calls.map((call) => call[0]).sort()
    expect(keys).toEqual([
      'season_config:AAAA:Magnus:L4:5',
      'season_config:AAAA:Mortarion:L4:5'
    ])
  })

  it('kill-threshold busts the same key set', async () => {
    const res = await routes.killThreshold(
      makeRequest('kill-threshold', thresholdBody)
    )
    expect(res.status).toBe(200)
    expect(delMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      'season_config:AAAA:Magnus:L4:5',
      'season_config:AAAA:Mortarion:L4:5'
    ])
  })

  it('notes-mode busts the same key set', async () => {
    const res = await routes.notesMode(makeRequest('notes-mode', notesBody))
    expect(res.status).toBe(200)
    expect(delMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      'season_config:AAAA:Magnus:L4:5',
      'season_config:AAAA:Mortarion:L4:5'
    ])
  })

  it("does not bust the ':none' season variant (the aggregator skips the planner read when season is absent)", async () => {
    await routes.skipPrime(makeRequest('skip-prime', skipBody))
    const keys = delMock.mock.calls.map((call) => call[0])
    expect(keys.some((key: string) => key.endsWith(':none'))).toBe(false)
  })

  it('scopes the bust to the written guild, raritySet and season', async () => {
    await routes.skipPrime(
      makeRequest('skip-prime', {
        ...skipBody,
        guild_code: 'BBBB',
        level: 'M2',
        season_number: '77'
      })
    )
    // Re-point the profile at BBBB so this asserts the KEY, not the gate.
    expect(delMock).not.toHaveBeenCalled()

    delMock.mockClear()
    mockDb.mockResolvedValue(
      buildSupabase({
        profile: { role: 'officer', guild_code: 'BBBB', display_name: 'Boss' }
      })
    )
    await routes.skipPrime(
      makeRequest('skip-prime', {
        ...skipBody,
        guild_code: 'BBBB',
        level: 'M2',
        season_number: '77'
      })
    )
    expect(delMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      'season_config:BBBB:Magnus:M2:77',
      'season_config:BBBB:Mortarion:M2:77'
    ])
  })

  it('never busts when the write itself failed', async () => {
    mockDb.mockResolvedValue(
      buildSupabase({ updateError: { message: 'boom' } })
    )
    const res = await routes.skipPrime(makeRequest('skip-prime', skipBody))
    expect(res.status).toBe(500)
    expect(delMock).not.toHaveBeenCalled()
  })

  it('fails OPEN: a bossType lookup failure never turns a committed write into a 500', async () => {
    mockDb.mockResolvedValue(
      buildSupabase({
        bossMappingRows: null,
        bossMappingError: {
          message: 'permission denied for table boss_mapping'
        }
      })
    )
    const res = await routes.skipPrime(makeRequest('skip-prime', skipBody))
    expect(res.status).toBe(200)
    expect(delMock).not.toHaveBeenCalled()
  })
})

describe('season-config cache key has ONE definition', () => {
  it('the aggregator read and the writers build the key from the same helper', async () => {
    vi.resetModules()
    const { seasonConfigCacheKey, SEASON_CONFIG_TTL_SECONDS } =
      await import('@/app/api/season-config/_cache')
    expect(seasonConfigCacheKey('AAAA', 'Magnus', 'L4', '5')).toBe(
      'season_config:AAAA:Magnus:L4:5'
    )
    expect(seasonConfigCacheKey('AAAA', 'Magnus', 'L4', '')).toBe(
      'season_config:AAAA:Magnus:L4:none'
    )
    expect(SEASON_CONFIG_TTL_SECONDS).toBe(60)
  })
})
