import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// season_number must be in both payload and onConflict, or a per-season write collapses onto the '' row.

vi.mock('@/app/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
  return { ...actual, requireActiveMembershipForApi: vi.fn() }
})

vi.mock('@/app/lib/db', () => ({ db: vi.fn(), serviceDb: vi.fn() }))

vi.mock('@/app/lib/auth/guild-permissions', () => ({
  requireGuildMember: vi.fn().mockResolvedValue(undefined),
  requireGuildOfficerOrClusterLeader: vi.fn().mockResolvedValue(undefined)
}))

import {
  DELETE,
  GET,
  PUT
} from '@/app/api/boss-assignments/target-tokens/route'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { db } from '@/app/lib/db'

const upsertMock = vi.fn()
const deleteMock = vi.fn()
let targetSelectData: Array<Record<string, unknown>> = []
let deleteEqCalls: Array<[string, unknown]> = []

function buildSupabaseMock() {
  return {
    from: (table: string) => {
      if (table === 'boss_mapping') {
        const builder: Record<string, unknown> = {}
        builder.select = () => builder
        builder.eq = () => builder
        builder.limit = () =>
          Promise.resolve({
            data: [{ boss_type: 'HiveTyrantKronos' }],
            error: null
          })
        return builder
      }
      if (table === 'boss_target_tokens') {
        const builder: Record<string, unknown> = {}
        builder.select = () => builder
        builder.eq = () => builder
        builder.in = () => builder
        builder.order = () => builder
        builder.then = (resolve: (v: unknown) => unknown) =>
          resolve({ data: targetSelectData, error: null })
        builder.delete = () => {
          deleteMock()
          const deleteBuilder: Record<string, unknown> = {}
          deleteBuilder.eq = (column: string, value: string) => {
            deleteEqCalls.push([column, value])
            return deleteBuilder
          }
          deleteBuilder.then = (resolve: (v: unknown) => unknown) =>
            resolve({ error: null })
          return deleteBuilder
        }
        builder.upsert = (
          payload: Record<string, unknown>,
          options: { onConflict?: string }
        ) => {
          upsertMock(payload, options)
          return {
            select: () => ({
              single: () => Promise.resolve({ data: payload, error: null })
            })
          }
        }
        return builder
      }
      throw new Error(`unexpected table ${table}`)
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  targetSelectData = []
  deleteEqCalls = []
  // app-admin so requireTargetTokenWriter short-circuits without a guild lookup.
  vi.mocked(requireActiveMembershipForApi).mockResolvedValue({
    user: { id: 'user-1' },
    profile: { guild_code: 'ABCD', is_app_admin: true }
  } as never)
  vi.mocked(db).mockResolvedValue(buildSupabaseMock() as never)
})

function getRequest(qs: string) {
  return new NextRequest(
    `http://localhost/api/boss-assignments/target-tokens?${qs}`,
    { method: 'GET' }
  )
}

function putRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost/api/boss-assignments/target-tokens',
    { method: 'PUT', body: JSON.stringify(body) }
  )
}

function deleteRequest(qs: string) {
  return new NextRequest(
    `http://localhost/api/boss-assignments/target-tokens?${qs}`,
    { method: 'DELETE' }
  )
}

const SEASON_INCLUSIVE_ON_CONFLICT =
  'guild_code,boss_name,rarity,set,encounter_id,season_number'

const baseBody = {
  boss_name: 'HiveTyrantKronos',
  rarity: 'Legendary',
  set: 3,
  encounter_id: 0,
  target_tokens: 5
}

describe('PUT /api/boss-assignments/target-tokens — WI-2716 per-season write', () => {
  it('stamps the payload with the requested season_number and uses a season-inclusive onConflict', async () => {
    const res = await PUT(putRequest({ ...baseBody, season_number: '102' }))

    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const [payload, options] = upsertMock.mock.calls[0]
    expect(payload).toMatchObject({
      guild_code: 'ABCD',
      boss_name: 'HiveTyrantKronos',
      encounter_id: 0,
      season_number: '102'
    })
    expect(options).toEqual({ onConflict: SEASON_INCLUSIVE_ON_CONFLICT })
  })

  it('coerces a numeric season_number to its string form', async () => {
    await PUT(putRequest({ ...baseBody, season_number: 105 }))
    const [payload] = upsertMock.mock.calls[0]
    expect(payload.season_number).toBe('105')
  })

  it("defaults a missing season_number to the legacy '' sentinel but keeps the season-inclusive onConflict", async () => {
    const res = await PUT(putRequest({ ...baseBody }))

    expect(res.status).toBe(200)
    const [payload, options] = upsertMock.mock.calls[0]
    // Absent season = cross-season legacy write; never an arbitrary season.
    expect(payload.season_number).toBe('')
    expect(options).toEqual({ onConflict: SEASON_INCLUSIVE_ON_CONFLICT })
  })

  it('rejects a non-numeric season_number with 400 and never writes', async () => {
    const res = await PUT(putRequest({ ...baseBody, season_number: 'abc' }))

    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('rejects a season_number with more than 6 digits (input-hygiene bound)', async () => {
    const res = await PUT(putRequest({ ...baseBody, season_number: '1234567' }))

    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/boss-assignments/target-tokens — WI-2716 gate-2d deterministic per-season read', () => {
  it("resolves a legacy '' + season pair for one 5-tuple to a single deterministic season row", async () => {
    targetSelectData = [
      {
        boss_name: 'HiveTyrantKronos',
        rarity: 'Legendary',
        set: 3,
        encounter_id: 0,
        target_tokens: 7,
        season_number: '' // legacy cross-season
      },
      {
        boss_name: 'HiveTyrantKronos',
        rarity: 'Legendary',
        set: 3,
        encounter_id: 0,
        target_tokens: 9,
        season_number: '102' // season-specific — must WIN
      }
    ]

    const res = await GET(getRequest('guild_code=ABCD&season=102'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.rows).toHaveLength(1)
    expect(body.rows[0].season_number).toBe('102')
    expect(body.rows[0].target_tokens).toBe(9)
  })

  it('without a season param, returns the rows unresolved (unchanged legacy behaviour for non-season-aware callers)', async () => {
    targetSelectData = [
      {
        boss_name: 'HiveTyrantKronos',
        rarity: 'Legendary',
        set: 3,
        encounter_id: 0,
        target_tokens: 7,
        season_number: ''
      }
    ]
    const res = await GET(getRequest('guild_code=ABCD'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
  })
})

describe('DELETE /api/boss-assignments/target-tokens — WI-2716 per-season reset', () => {
  const baseQuery =
    'boss_name=HiveTyrantKronos&rarity=Legendary&set=3&encounter_id=0'

  it('scopes the reset to season_number when season is supplied', async () => {
    const res = await DELETE(deleteRequest(`${baseQuery}&season=102`))

    expect(res.status).toBe(200)
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(deleteEqCalls).toEqual([
      ['guild_code', 'ABCD'],
      ['boss_name', 'HiveTyrantKronos'],
      ['rarity', 'Legendary'],
      ['set', 3],
      ['encounter_id', 0],
      ['season_number', '102']
    ])
  })

  it('preserves legacy broad delete behavior when season is absent', async () => {
    const res = await DELETE(deleteRequest(baseQuery))

    expect(res.status).toBe(200)
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(deleteEqCalls).not.toContainEqual(['season_number', ''])
  })

  it('rejects malformed season before issuing a delete', async () => {
    const res = await DELETE(deleteRequest(`${baseQuery}&season=102abc`))

    expect(res.status).toBe(400)
    expect(deleteMock).not.toHaveBeenCalled()
  })
})
