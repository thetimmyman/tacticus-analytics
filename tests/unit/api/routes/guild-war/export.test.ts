import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

let mockRequireRole: ReturnType<typeof vi.fn>
let mockDb: ReturnType<typeof vi.fn>

describe('GET /api/guild-war/export', () => {
  let GET: (request: NextRequest) => Promise<Response>

  function makeChain(result: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve(result).then(resolve)
    }
    return chain
  }

  const matchRow = {
    war_id: 'war-1',
    opponent_guild_name: 'Enemy Guild',
    opponent_guild_code: null,
    war_status: 'completed',
    war_result: 'win',
    guild_score: 100,
    opponent_score: 80,
    war_start_date: '2026-09-01',
    war_end_date: '2026-09-02',
    war_season: 12,
    battlefield_level: 3
  }

  const zoneRow = {
    id: 'zone-1',
    war_id: 'war-1',
    zone_number: 1,
    zone_type: 'attack',
    zone_status: 'completed',
    zone_name: null,
    assigned_players: null
  }

  const attemptRow = {
    zone_id: 'zone-1',
    event_id: 'e1e1e1e1-0000-4000-8000-000000000001',
    player_id: 'p1',
    player_name: 'Player1',
    attempt_number: 1,
    attempt_status: 'completed',
    attempt_result: 'win',
    damage_dealt: 1000,
    score_earned: 50,
    attacker_units_json: null,
    attempt_start_time: null,
    attempt_end_time: null
  }

  let tableResults: Record<string, { data: unknown; error: unknown }>

  beforeEach(async () => {
    vi.resetModules()

    mockRequireRole = vi.fn().mockResolvedValue({
      profile: { role: 'officer', guild_code: 'TEST' }
    })

    tableResults = {
      guild_war_matches: { data: [matchRow], error: null },
      guild_war_zones: { data: [zoneRow], error: null },
      guild_war_participation: { data: [], error: null },
      guild_war_player_attempts: { data: [attemptRow], error: null }
    }

    const mockSupabase = {
      from: vi.fn((table: string) => makeChain(tableResults[table]))
    }
    mockDb = vi.fn().mockResolvedValue(mockSupabase)

    vi.doMock('@/app/lib/auth', () => ({
      AuthError,
      requireRoleForApi: mockRequireRole
    }))

    vi.doMock('@/app/lib/db', () => ({
      db: mockDb
    }))

    const { withErrorHandlerMock } =
      await import('@/tests/helpers/mock-error-handler')
    vi.doMock('@/app/lib/middleware/errorHandler', () => withErrorHandlerMock)

    vi.doMock('@/app/lib/errors/AppError', () => ({
      Errors: {
        fromResponse: (status: number, body: unknown) => {
          const err = new Error(JSON.stringify(body)) as any
          err.status = status
          err.body = body
          return err
        }
      },
      rethrowIfAppError: (error: unknown) => {
        if ((error as any)?.status) throw error
      }
    }))

    const mod = await import('@/app/api/guild-war/export/route')
    GET = mod.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeRequest(qs = '') {
    return new NextRequest(`http://localhost/api/guild-war/export${qs}`)
  }

  it('returns 401 when not authenticated', async () => {
    mockRequireRole.mockRejectedValue(
      Object.assign(
        new AuthError('Authentication required', 'UNAUTHENTICATED'),
        { status: 401 }
      )
    )
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('emits event_id for every exported attempt', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.wars).toHaveLength(1)
    const attempts = body.wars[0].zones[0].attempts
    expect(attempts).toHaveLength(1)
    expect(attempts[0].event_id).toBe('e1e1e1e1-0000-4000-8000-000000000001')
  })

  it('omits event_id (as undefined, not null) when the stored row has none', async () => {
    tableResults.guild_war_player_attempts = {
      data: [{ ...attemptRow, event_id: null }],
      error: null
    }
    const res = await GET(makeRequest())
    const body = await res.json()
    const attempt = body.wars[0].zones[0].attempts[0]
    expect('event_id' in attempt ? attempt.event_id : undefined).toBeUndefined()
  })
})
