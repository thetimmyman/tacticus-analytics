import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'
import { WAR_IMPORT_LIMITS } from '@/app/lib/war/import-schema'

let mockGetAuthUser: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('POST /api/guild-war/import', () => {
  let POST: (request: NextRequest) => Promise<Response>

  let tableChains: Record<
    string,
    {
      upsert: ReturnType<typeof vi.fn>
    }
  >

  function makeTableChain(
    upsertResults: Array<{
      data: Record<string, unknown> | null
      error: { message: string } | null
    }> = []
  ) {
    let callIndex = 0
    const chain: any = {}
    chain.upsert = vi.fn().mockImplementation(() => {
      const result = upsertResults[callIndex] ?? {
        data: { id: 'gen-id' },
        error: null
      }
      callIndex++
      return {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockReturnValue(result)
        }),
        ...result
      }
    })
    return chain
  }

  const validWar = {
    war_id: 'war-1',
    opponent_guild_name: 'Enemy Guild',
    war_status: 'completed' as const,
    zones: [
      {
        zone_number: 1,
        zone_type: 'attack',
        zone_status: 'completed',
        attempts: [
          {
            player_id: 'p1',
            player_name: 'Player1',
            attempt_number: 1,
            attempt_status: 'completed'
          }
        ]
      }
    ],
    participation: [
      {
        user_id: 'u1',
        display_name: 'Player1'
      }
    ]
  }

  beforeEach(async () => {
    vi.resetModules()

    mockGetAuthUser = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
      profile: { role: 'leader', guild_code: 'TEST' }
    })

    tableChains = {
      guild_war_matches: makeTableChain([{ data: null, error: null }]),
      guild_war_zones: makeTableChain([
        { data: { id: 'zone-1' }, error: null }
      ]),
      guild_war_player_attempts: makeTableChain([{ data: null, error: null }]),
      guild_war_participation: makeTableChain([{ data: null, error: null }])
    }

    const mockSupabase = {
      from: vi
        .fn()
        .mockImplementation(
          (table: string) => tableChains[table] ?? makeTableChain()
        )
    }
    mockCreateServiceClient = vi.fn().mockReturnValue(mockSupabase)

    vi.doMock('@/app/lib/auth', () => ({
      AuthError,
      requireRoleForApi: mockGetAuthUser
    }))

    vi.doMock('@/app/lib/db', () => ({
      serviceDb: mockCreateServiceClient
    }))

    // Mocked before the route import: a vi.doMock in a nested beforeEach runs too late.
    vi.doMock('@/app/lib/data/guild-roster', () => ({
      guildRosterQuery: vi.fn().mockResolvedValue({ data: [] })
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
      }
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

    const mod = await import('@/app/api/guild-war/import/route')
    POST = mod.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  function makeRequest(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/guild-war/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  describe('authentication', () => {
    it('returns 401 when not authenticated', async () => {
      mockGetAuthUser.mockRejectedValue(
        Object.assign(
          new AuthError('Authentication required', 'UNAUTHENTICATED'),
          { status: 401 }
        )
      )
      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: { wars: [] } })
      )
      expect(res.status).toBe(401)
    })

    it('returns 403 when user role is member', async () => {
      mockGetAuthUser.mockRejectedValue(
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
      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: { wars: [validWar] } })
      )
      expect(res.status).toBe(403)
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
    })

    it('rejects inactive membership before parsing the body or creating a service client', async () => {
      mockGetAuthUser.mockRejectedValue(
        Object.assign(
          new AuthError(
            'Current guild membership required',
            'ONBOARDING_REQUIRED'
          ),
          { status: 403 }
        )
      )

      const res = await POST(
        new NextRequest('http://localhost/api/guild-war/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{not-json'
        })
      )

      expect(res.status).toBe(403)
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('returns 413 when content-length exceeds the import limit', async () => {
      const res = await POST(
        new NextRequest('http://localhost/api/guild-war/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(WAR_IMPORT_LIMITS.maxBytes + 1)
          },
          body: '{}'
        })
      )

      expect(res.status).toBe(413)
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
    })

    it('returns 413 when an unlabelled request body exceeds the import limit', async () => {
      const oversized = 'x'.repeat(WAR_IMPORT_LIMITS.maxBytes + 1)
      const res = await POST(
        new NextRequest('http://localhost/api/guild-war/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: oversized
        })
      )

      expect(res.status).toBe(413)
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
    })

    it('returns 400 when a war exceeds the nested zone limit', async () => {
      const res = await POST(
        makeRequest({
          guild_code: 'TEST',
          data: {
            wars: [
              {
                ...validWar,
                zones: Array.from({ length: 51 }, (_, index) => ({
                  zone_number: index + 1,
                  zone_type: 'attack',
                  zone_status: 'completed',
                  attempts: []
                }))
              }
            ]
          }
        })
      )

      expect(res.status).toBe(400)
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
    })

    it('returns 400 when guild_code is missing from body', async () => {
      const res = await POST(makeRequest({ data: { wars: [validWar] } }))
      expect(res.status).toBe(400)
    })

    it('returns 403 when guild_code does not match user profile guild', async () => {
      const res = await POST(
        makeRequest({ guild_code: 'OTHER', data: { wars: [validWar] } })
      )
      expect(res.status).toBe(403)
    })

    it('returns 400 when data fails Zod validation (empty wars)', async () => {
      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: { wars: [] } })
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 with details for specific Zod field errors', async () => {
      const res = await POST(
        makeRequest({
          guild_code: 'TEST',
          data: {
            wars: [
              { war_id: '', opponent_guild_name: '', war_status: 'invalid' }
            ]
          }
        })
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.details).toBeDefined()
      expect(body.details.length).toBeGreaterThan(0)
    })
  })

  describe('successful import', () => {
    it('upserts match, zones, attempts, participation and returns correct counts', async () => {
      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: { wars: [validWar] } })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.counts).toEqual({
        wars: 1,
        zones: 1,
        attempts: 1,
        participation: 1
      })
    })

    it('handles wars with empty zones and participation arrays', async () => {
      const emptyWar = {
        war_id: 'war-2',
        opponent_guild_name: 'Empty',
        war_status: 'completed' as const,
        zones: [],
        participation: []
      }
      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: { wars: [emptyWar] } })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.counts).toEqual({
        wars: 1,
        zones: 0,
        attempts: 0,
        participation: 0
      })
    })
  })

  describe('partial failures', () => {
    it('continues processing remaining wars when one match upsert fails', async () => {
      let matchCallIndex = 0
      tableChains.guild_war_matches.upsert = vi.fn().mockImplementation(() => {
        matchCallIndex++
        if (matchCallIndex === 1)
          return { data: null, error: { message: 'DB error' } }
        return { data: null, error: null }
      })

      const secondWar = {
        ...validWar,
        war_id: 'war-2',
        zones: [],
        participation: []
      }
      const res = await POST(
        makeRequest({
          guild_code: 'TEST',
          data: { wars: [validWar, secondWar] }
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.counts.wars).toBe(1) // only second war counted
      expect(body.success).toBe(false)
      expect(body.message).toContain('1 row(s) failed')
    })

    it('continues when zone upsert fails — skips zone attempts', async () => {
      tableChains.guild_war_zones = makeTableChain([
        { data: null, error: { message: 'zone error' } }
      ])

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: { wars: [validWar] } })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.counts.zones).toBe(0)
      expect(body.counts.attempts).toBe(0)
      expect(body.success).toBe(false)
    })

    it('continues when attempt upsert fails', async () => {
      tableChains.guild_war_player_attempts = makeTableChain([
        { data: null, error: { message: 'attempt error' } }
      ])

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: { wars: [validWar] } })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.counts.attempts).toBe(0)
      expect(body.counts.zones).toBe(1) // zone still counted
      expect(body.success).toBe(false)
    })

    it('continues when participation upsert fails', async () => {
      tableChains.guild_war_participation = makeTableChain([
        { data: null, error: { message: 'part error' } }
      ])

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: { wars: [validWar] } })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.counts.participation).toBe(0)
      expect(body.counts.wars).toBe(1) // war still counted
      expect(body.success).toBe(false)
    })

    // Not a 502, whose body Cloudflare replaces with its own HTML page.
    it('returns 422 with a success:false envelope when every row fails (upsert error field)', async () => {
      tableChains.guild_war_matches = makeTableChain([
        { data: null, error: { message: 'DB error' } }
      ])

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: { wars: [validWar] } })
      )
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('nothing was imported')
      expect(body.counts).toEqual({
        wars: 0,
        zones: 0,
        attempts: 0,
        participation: 0
      })
      expect(body.errors).toBe(1)
      expect(JSON.stringify(body)).not.toContain('DB error')
    })

    it('returns 422 with a success:false envelope when every row fails (thrown error)', async () => {
      tableChains.guild_war_matches.upsert = vi.fn().mockImplementation(() => {
        throw new Error('connection reset')
      })

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: { wars: [validWar] } })
      )
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).toContain('nothing was imported')
      expect(JSON.stringify(body)).not.toContain('connection reset')
    })

    it('mixed: one war persists and one fails — 200, success:false, counts reflect only the persisted war', async () => {
      let matchCallIndex = 0
      tableChains.guild_war_matches.upsert = vi.fn().mockImplementation(() => {
        matchCallIndex++
        if (matchCallIndex === 1)
          return { data: null, error: { message: 'DB error' } }
        return { data: null, error: null }
      })

      const secondWar = {
        ...validWar,
        war_id: 'war-2',
        zones: [],
        participation: []
      }
      const res = await POST(
        makeRequest({
          guild_code: 'TEST',
          data: { wars: [validWar, secondWar] }
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.counts.wars).toBe(1)
      expect(body.message).toContain('1 row(s) failed')
    })

    it('child failure after the parent persisted: a zone rejects, its attempts are skipped and not counted, and the war itself still counts', async () => {
      tableChains.guild_war_zones = makeTableChain([
        { data: null, error: { message: 'zone error' } }
      ])

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: { wars: [validWar] } })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.counts.wars).toBe(1)
      expect(body.counts.zones).toBe(0)
      expect(body.counts.attempts).toBe(0) // skipped dependent, not counted
    })
  })

  describe('raw LOKI roster-only import', () => {
    // Status-only uploads anchor members to the current match via findActiveWarId.
    function mockGuildConfig() {
      ;(tableChains as Record<string, unknown>).guild_config = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { display_name: 'Test Guild' } })
          })
        })
      }
    }

    function mockExistingMatches(
      rows: Array<{ war_id: string; war_status: string }>
    ) {
      const chain = makeTableChain([{ data: null, error: null }]) as any
      chain.select = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null })
          })
        })
      })
      tableChains.guild_war_matches = chain
    }

    const rosterOnlyPayload = {
      eventResults: [
        {
          eventResponseData: {
            guildWarStatus: {
              members: [
                { userId: 'u1', displayName: 'Player1', totalAttemptsLeft: 3 },
                { userId: 'u2', displayName: 'Player2', totalAttemptsLeft: 5 }
              ]
            }
          }
        }
      ]
    }

    beforeEach(() => {
      mockGuildConfig()
    })

    it('imports the roster against the guild’s active war and returns 200', async () => {
      mockExistingMatches([{ war_id: 'war-existing', war_status: 'active' }])

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: rosterOnlyPayload })
      )

      // A payload-shape guard would wrongly make this 400.
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.counts.participation).toBe(2)
      expect(tableChains.guild_war_participation.upsert).toHaveBeenCalledTimes(
        2
      )
      expect(body.missing.join(' ')).toContain('GET_GUILD_WAR_ACTIVITY_LOGS')
    })

    it('falls back to the most recent war when none is active', async () => {
      mockExistingMatches([
        { war_id: 'war-recent', war_status: 'completed' },
        { war_id: 'war-older', war_status: 'completed' }
      ])

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: rosterOnlyPayload })
      )

      expect(res.status).toBe(200)
      expect((await res.json()).counts.participation).toBe(2)
    })

    it('returns an actionable 400 — not a 502 — when the guild has no war to anchor to', async () => {
      mockExistingMatches([])

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: rosterOnlyPayload })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('nothing was written')
      expect(body.error).toContain('GET_GUILD_WAR_ACTIVITY_LOGS')
      expect(tableChains.guild_war_participation.upsert).not.toHaveBeenCalled()
    })

    it('reports a FAILED war lookup as a server error, not as bad operator input', async () => {
      // A findActiveWarId read error must not look like "no war" and blame the upload.
      const chain = makeTableChain([{ data: null, error: null }]) as any
      chain.select = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'canceling statement due to statement timeout' }
            })
          })
        })
      })
      tableChains.guild_war_matches = chain

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: rosterOnlyPayload })
      )

      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.message).not.toContain('GET_GUILD_WAR_ACTIVITY_LOGS')
      expect(JSON.stringify(body)).not.toContain('statement timeout')
    })

    it('does not persist a war from activity logs that contain no battle', async () => {
      // Only zone claim/leave logs: must not become a no-battle war or bypass the roster-only rejection.
      const preBattlePayload = {
        eventResults: [
          {
            eventResponseData: {
              activityLogs: [
                { type: 'playerClaimedZone', userId: 'u1' },
                { type: 'playerLeftZone', userId: 'u1' }
              ]
            }
          }
        ]
      }

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: preBattlePayload })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('no finished battles yet')
      expect(tableChains.guild_war_matches.upsert).not.toHaveBeenCalled()
    })

    it('reports row failures without claiming the rest were imported', async () => {
      // Failed upserts can skip dependents, so the message must not claim the rest persisted.
      mockExistingMatches([{ war_id: 'war-existing', war_status: 'active' }])
      tableChains.guild_war_participation = makeTableChain([
        { data: null, error: { message: 'part error' } },
        { data: null, error: null }
      ])

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: rosterOnlyPayload })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.message).not.toContain('the rest were imported')
      expect(body.message).toContain('skipped')
    })

    it('PS-478: keeps raw row-level database diagnostics out of the partial-200 body', async () => {
      mockExistingMatches([{ war_id: 'war-existing', war_status: 'active' }])
      tableChains.guild_war_participation = makeTableChain([
        {
          data: null,
          error: {
            message: 'duplicate key value violates unique constraint "gwp_pkey"'
          }
        },
        {
          data: null,
          error: {
            message:
              'insert or update on table "guild_war_participation" violates foreign key constraint "guild_war_participation_war_id_fkey"'
          }
        },
        { data: null, error: null }
      ])

      const res = await POST(
        makeRequest({
          guild_code: 'TEST',
          data: {
            eventResults: [
              {
                eventResponseData: {
                  guildWarStatus: {
                    members: [
                      {
                        userId: 'u1',
                        displayName: 'Player1',
                        totalAttemptsLeft: 3
                      },
                      {
                        userId: 'u2',
                        displayName: 'Player2',
                        totalAttemptsLeft: 5
                      },
                      {
                        userId: 'u3',
                        displayName: 'Player3',
                        totalAttemptsLeft: 1
                      }
                    ]
                  }
                }
              }
            ]
          }
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      const raw = JSON.stringify(body)
      // No constraint/relation name, driver phrasing, or bare SQLSTATE.
      expect(raw).not.toContain('gwp_pkey')
      expect(raw).not.toContain('guild_war_participation_war_id_fkey')
      expect(raw).not.toContain('constraint')
      expect(raw).not.toContain('violates')
      expect(raw).not.toMatch(/\b[0-9A-Z]{5}\b/)
      expect(body.counts.participation).toBe(1)
      expect(body.counts.errors).toEqual([
        'duplicate row',
        'referenced record missing'
      ])
    })

    it('keeps raw row-level database diagnostics out of the 422 body', async () => {
      mockExistingMatches([{ war_id: 'war-existing', war_status: 'active' }])
      tableChains.guild_war_participation = makeTableChain([
        {
          data: null,
          error: {
            message:
              'duplicate key value violates unique constraint "guild_war_participation_pkey"'
          }
        },
        {
          data: null,
          error: {
            message:
              'duplicate key value violates unique constraint "guild_war_participation_pkey"'
          }
        }
      ])

      const res = await POST(
        makeRequest({ guild_code: 'TEST', data: rosterOnlyPayload })
      )

      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.details).toBeUndefined()
      expect(JSON.stringify(body)).not.toContain('unique constraint')
      expect(body.message).toContain('nothing was imported')
      expect(body.errors).toBe(2)
    })
  })
})
