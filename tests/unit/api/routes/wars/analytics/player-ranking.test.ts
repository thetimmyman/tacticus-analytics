import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

// The flag gates the route (404) before any auth or DB work; the guild comes from the session, and
// serviceDb runs only after the membership check.

let mockRequireMembership: ReturnType<typeof vi.fn>
let mockServiceDb: ReturnType<typeof vi.fn>
let flagEnabled: boolean

type MockRow = Record<string, string | number | boolean | null | object>
type MockResult =
  { data: MockRow[]; error: null } | { data: null; error: { message: string } }

type TableData = Record<string, MockResult>

/** `.range()` slices like PostgREST, so the page-until-short loop really runs. */
function buildSupabaseMock(
  tables: TableData,
  calls: Record<string, unknown[][]>
) {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null }
      const chain: Record<string, unknown> = {}
      let rangeArgs: [number, number] | null = null
      const record =
        (method: string) =>
        (...args: (string | number)[]) => {
          calls[table] = calls[table] ?? []
          calls[table]!.push([method, ...args])
          if (method === 'range') {
            rangeArgs = [args[0] as number, args[1] as number]
          }
          return chain
        }
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range']) {
        chain[m] = record(m)
      }
      chain.then = (resolve: (v: MockResult) => void) => {
        const sliced =
          result.data && rangeArgs
            ? {
                ...result,
                data: result.data.slice(rangeArgs[0], rangeArgs[1] + 1)
              }
            : result
        return Promise.resolve(sliced).then(resolve)
      }
      return chain
    }
  }
}

const postRanking = async (body?: object | null) => {
  const routeModule =
    await import('@/app/api/wars/analytics/player-ranking/route')
  return routeModule.POST(
    new NextRequest('http://localhost/api/wars/analytics/player-ranking', {
      method: 'POST',
      body: JSON.stringify(
        body === undefined ? { formulaVersion: 'war-ranking-v1' } : body
      )
    })
  )
}

describe('POST /api/wars/analytics/player-ranking', () => {
  let queryCalls: Record<string, unknown[][]>

  beforeEach(() => {
    vi.resetModules()
    flagEnabled = true
    queryCalls = {}
    mockRequireMembership = vi.fn()
    mockServiceDb = vi.fn()

    vi.doMock('@/app/lib/auth', () => ({
      AuthError,
      requireActiveMembershipForApi: mockRequireMembership
    }))
    vi.doMock('@/app/lib/db', () => ({
      serviceDb: mockServiceDb
    }))
    vi.doMock('@/app/lib/utils/feature-flags', () => ({
      isFeatureEnabled: vi.fn(() => flagEnabled)
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('C6: returns 404 with the flag OFF — before auth and before any DB work', async () => {
    flagEnabled = false
    const response = await postRanking()
    expect(response.status).toBe(404)
    expect(mockRequireMembership).not.toHaveBeenCalled()
    expect(mockServiceDb).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    mockRequireMembership.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )
    const response = await postRanking()
    expect(response.status).toBe(401)
  })

  it('C5 ordering: serviceDb is never reached when membership is rejected', async () => {
    mockRequireMembership.mockRejectedValue(
      new AuthError('Current guild membership required', 'ONBOARDING_REQUIRED')
    )
    const response = await postRanking()
    expect(response.status).toBe(403)
    expect(mockServiceDb).not.toHaveBeenCalled()
  })

  it('returns 400 when the user has no guild code', async () => {
    mockRequireMembership.mockResolvedValue({ profile: { guild_code: null } })
    const response = await postRanking()
    expect(response.status).toBe(400)
    expect(mockServiceDb).not.toHaveBeenCalled()
  })

  it('a JSON `null` body gets defaults — never a 500', async () => {
    mockRequireMembership.mockResolvedValue({ profile: { guild_code: 'AAAA' } })
    mockServiceDb.mockReturnValue(buildSupabaseMock({}, queryCalls))
    const response = await postRanking(null)
    expect(response.status).toBe(200)
  })

  it('paginates the battle fetch until a short page — a ceiling-sized set is not silently truncated', async () => {
    mockRequireMembership.mockResolvedValue({ profile: { guild_code: 'AAAA' } })
    const rows = Array.from({ length: 1005 }, (_, i) => ({
      war_id: 'w1',
      zone_id: 'z1',
      player_id: 'P1',
      player_name: 'Alpha',
      is_guild_member: true,
      defender_player_id: 'enemy-1',
      score_earned: 0,
      attempt_result: null, // excluded rows still count into `battles`
      attempt_end_time: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`
    }))
    mockServiceDb.mockReturnValue(
      buildSupabaseMock(
        {
          guild_war_matches: { data: [{ war_id: 'w1' }], error: null },
          guild_war_battles: { data: rows, error: null },
          guild_war_zone_events: { data: [], error: null }
        },
        queryCalls
      )
    )

    const response = await postRanking()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.players[0].battles).toBe(1005)
    const rangeCalls = (queryCalls['guild_war_battles'] ?? []).filter(
      (c) => c[0] === 'range'
    )
    expect(rangeCalls).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999]
    ])
  })

  it('rejects an unknown formulaVersion', async () => {
    mockRequireMembership.mockResolvedValue({ profile: { guild_code: 'AAAA' } })
    mockServiceDb.mockReturnValue(buildSupabaseMock({}, queryCalls))
    const response = await postRanking({ formulaVersion: 'homebrew-v9' })
    expect(response.status).toBe(400)
  })

  it('C5: derives the guild from the SESSION — a guild field in the body is ignored', async () => {
    mockRequireMembership.mockResolvedValue({ profile: { guild_code: 'AAAA' } })
    mockServiceDb.mockReturnValue(
      buildSupabaseMock(
        {
          guild_war_matches: { data: [{ war_id: 'w1' }], error: null },
          guild_war_battles: { data: [], error: null },
          guild_war_zone_events: { data: [], error: null }
        },
        queryCalls
      )
    )

    const response = await postRanking({
      formulaVersion: 'war-ranking-v1',
      guildCode: 'EVIL',
      guild_code: 'EVIL'
    })
    expect(response.status).toBe(200)

    for (const table of [
      'guild_war_matches',
      'guild_war_battles',
      'guild_war_zone_events'
    ]) {
      const eqCalls = (queryCalls[table] ?? []).filter(
        (c) => c[0] === 'eq' && c[1] === 'guild_code'
      )
      expect(eqCalls, `${table} guild_code filter`).toEqual([
        ['eq', 'guild_code', 'AAAA']
      ])
    }
  })

  it('scores battles and reports exclusions with visible reasons', async () => {
    mockRequireMembership.mockResolvedValue({ profile: { guild_code: 'AAAA' } })
    const win = {
      war_id: 'w1',
      zone_id: 'z1',
      player_id: 'P1',
      player_name: 'Alpha',
      is_guild_member: true,
      defender_player_id: 'enemy-1',
      score_earned: 1600,
      attempt_result: 'win',
      attempt_end_time: '2026-01-01T00:00:00Z',
      buffs: [
        { scope: 'Global', abilityId: 'EnvDefenderHealthBuff2' },
        { scope: 'Global', abilityId: 'EnvDefenderHealthBuff2' }
      ],
      attacker_units_json: Array.from({ length: 5 }, () => ({
        unitId: 'a',
        remainingHPAfter: 100
      })),
      defender_units_json: Array.from({ length: 5 }, () => ({
        unitId: 'd',
        remainingHPBefore: 500,
        remainingHPAfter: 0
      })),
      attacker_units_lost: 0
    }
    mockServiceDb.mockReturnValue(
      buildSupabaseMock(
        {
          guild_war_matches: { data: [{ war_id: 'w1' }], error: null },
          guild_war_battles: {
            data: [win, { ...win, attempt_result: null, score_earned: 0 }],
            error: null
          },
          guild_war_zone_events: {
            data: [
              { war_id: 'w1', zone_id: 'z1', event_type: 'zoneDestroyed' }
            ],
            error: null
          }
        },
        queryCalls
      )
    )

    const response = await postRanking()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.formulaVersion).toBe('war-ranking-v1')
    expect(body.players).toHaveLength(1)
    expect(body.players[0].totalMultiplier).toBe(3.0)
    expect(body.players[0].excluded).toBe(1)
    expect(body.excludedBattles['no-result']).toBe(1)
    expect(body.zoneEventPopulation).toBe(1)
    expect(body.excludedWars).toEqual([])
  })

  it('C7: a war failing the zone-events cross-check is excluded with a visible reason', async () => {
    mockRequireMembership.mockResolvedValue({ profile: { guild_code: 'AAAA' } })
    mockServiceDb.mockReturnValue(
      buildSupabaseMock(
        {
          guild_war_matches: { data: [{ war_id: 'w1' }], error: null },
          guild_war_battles: { data: [], error: null },
          guild_war_zone_events: {
            data: [
              { war_id: 'w1', zone_id: 'z9', event_type: 'zoneDestroyed' }
            ],
            error: null
          }
        },
        queryCalls
      )
    )

    const response = await postRanking()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.excludedWars).toHaveLength(1)
    expect(body.excludedWars[0].warId).toBe('w1')
    expect(body.excludedWars[0].reason).toContain('zone-events-mismatch')
    expect(body.wars).toEqual([])
  })
})
