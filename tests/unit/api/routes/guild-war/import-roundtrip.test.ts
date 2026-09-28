import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

/** Re-import after attempt_number drift must not change the row count; the fake honours `onConflict`. */

let mockGetAuthUser: ReturnType<typeof vi.fn>

describe('POST /api/guild-war/import — round trip', () => {
  let POST: (request: NextRequest) => Promise<Response>

  let attemptsStore: Map<string, Record<string, unknown>>
  let attemptsUpsertCalls: Array<Record<string, unknown>>
  let zoneIdsByNumber: Map<number, string>

  function buildSupabase() {
    return {
      from: (table: string) => {
        if (table === 'guild_war_matches') {
          return { upsert: vi.fn().mockReturnValue({ error: null }) }
        }
        if (table === 'guild_war_zones') {
          return {
            upsert: vi.fn((payload: Record<string, unknown>) => ({
              select: () => ({
                single: () => {
                  const zoneNumber = payload.zone_number as number
                  const id =
                    zoneIdsByNumber.get(zoneNumber) ?? `zone-${zoneNumber}`
                  zoneIdsByNumber.set(zoneNumber, id)
                  return { data: { id }, error: null }
                }
              })
            }))
          }
        }
        if (table === 'guild_war_player_attempts') {
          return {
            upsert: vi.fn(
              (
                payload: Record<string, unknown>,
                opts: { onConflict: string }
              ) => {
                attemptsUpsertCalls.push(payload)
                const keyFields = opts.onConflict.split(',')
                const key = keyFields.map((f) => payload[f]).join('|')
                attemptsStore.set(key, payload)
                return { error: null }
              }
            )
          }
        }
        if (table === 'guild_war_participation') {
          return { upsert: vi.fn().mockReturnValue({ error: null }) }
        }
        throw new Error(`unexpected table in round-trip mock: ${table}`)
      }
    }
  }

  function makeWar(attemptNumber: number, eventId?: string) {
    return {
      war_id: 'war-rt',
      opponent_guild_name: 'Enemy Guild',
      war_status: 'completed' as const,
      zones: [
        {
          zone_number: 1,
          zone_type: 'attack',
          zone_status: 'completed',
          attempts: [
            {
              ...(eventId ? { event_id: eventId } : {}),
              player_id: 'p1',
              player_name: 'Player1',
              attempt_number: attemptNumber,
              attempt_status: 'completed'
            }
          ]
        }
      ],
      participation: []
    }
  }

  beforeEach(async () => {
    vi.resetModules()
    attemptsStore = new Map()
    attemptsUpsertCalls = []
    zoneIdsByNumber = new Map()

    mockGetAuthUser = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
      profile: { role: 'leader', guild_code: 'TEST' }
    })

    vi.doMock('@/app/lib/auth', () => ({
      AuthError,
      requireRoleForApi: mockGetAuthUser
    }))

    vi.doMock('@/app/lib/db', () => ({
      serviceDb: vi.fn().mockReturnValue(buildSupabase())
    }))

    vi.doMock('@/app/lib/data/guild-roster', () => ({
      guildRosterQuery: vi.fn().mockResolvedValue({ data: [] })
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
  })

  function makeRequest(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/guild-war/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  it('RUN 1 (with event_id): re-import after attempt_number drift changes no row count', async () => {
    const firstRes = await POST(
      makeRequest({ guild_code: 'TEST', data: { wars: [makeWar(1)] } })
    )
    expect(firstRes.status).toBe(200)
    expect((await firstRes.json()).counts.attempts).toBe(1)
    expect(attemptsStore.size).toBe(1)

    const [storedRow] = Array.from(attemptsStore.values())
    const exportedEventId = storedRow.event_id as string
    expect(exportedEventId).toBeTruthy()

    const secondRes = await POST(
      makeRequest({
        guild_code: 'TEST',
        data: { wars: [makeWar(2, exportedEventId)] }
      })
    )
    expect(secondRes.status).toBe(200)
    const secondBody = await secondRes.json()

    expect(secondBody.counts.attempts).toBe(1) // upsert happened
    expect(attemptsStore.size).toBe(1) // ...onto the SAME row, not a new one
    const [updatedRow] = Array.from(attemptsStore.values())
    expect(updatedRow.event_id).toBe(exportedEventId)
    expect(updatedRow.attempt_number).toBe(2) // the drifted value did apply
  })

  it('RUN 2 (without event_id): still imports, and a same-shape re-import stays idempotent', async () => {
    const firstRes = await POST(
      makeRequest({ guild_code: 'TEST', data: { wars: [makeWar(1)] } })
    )
    expect(firstRes.status).toBe(200)
    expect((await firstRes.json()).counts.attempts).toBe(1)
    expect(attemptsStore.size).toBe(1)
    expect(attemptsUpsertCalls[0].event_id).toBeTruthy() // still derived

    const secondRes = await POST(
      makeRequest({ guild_code: 'TEST', data: { wars: [makeWar(1)] } })
    )
    expect(secondRes.status).toBe(200)
    expect((await secondRes.json()).counts.attempts).toBe(1)
    expect(attemptsStore.size).toBe(1)
  })
})
