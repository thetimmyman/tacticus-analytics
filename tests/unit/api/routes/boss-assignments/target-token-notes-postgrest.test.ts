import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PostgrestClient } from '@supabase/postgrest-js'
import { PATCH } from '@/app/api/boss-assignments/target-tokens/route'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'

vi.mock('@/app/lib/auth', () => ({ requireActiveMembershipForApi: vi.fn() }))
vi.mock('@/app/lib/db', () => ({ db: vi.fn() }))

const userId = '00000000-0000-4000-8000-000000000001'
const stored = {
  guild_code: 'SYN-TARGETS',
  boss_name: 'Magnus',
  rarity: 'Mythic',
  set: 1,
  encounter_id: 1,
  season_number: '',
  target_tokens: 1,
  source: 'historical_seed',
  seeded_from_seasons: 'None available',
  skip: true,
  notes: 'Original annotation'
}
const request = () =>
  new NextRequest('http://localhost/api/boss-assignments/target-tokens', {
    method: 'PATCH',
    body: JSON.stringify({
      boss_name: 'Magnus',
      rarity: 'Mythic',
      set: 1,
      encounter_id: 1,
      season_number: '',
      notes: 'Revised annotation'
    })
  })

let zeroRows: boolean
let writes: Array<{ url: URL; headers: Headers; body: Record<string, unknown> }>

beforeEach(() => {
  zeroRows = false
  writes = []
  vi.mocked(requireActiveMembershipForApi).mockResolvedValue({
    user: { id: userId },
    profile: { guild_code: 'SYN-TARGETS', is_app_admin: false }
  } as never)
  // The same query builder used by Supabase.from(), without another auth client.
  const client = new PostgrestClient('http://localhost:6543/rest/v1', {
    headers: { Authorization: 'Bearer synthetic-caller-token' },
    fetch: async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith(`/${CURRENT_USER_PLAYER_MAPPING}`))
        return Response.json([
          {
            guild_code: 'SYN-TARGETS',
            role: 'officer',
            display_name: 'Synthetic Officer'
          }
        ])
      if (
        url.pathname.endsWith('/boss_target_tokens') &&
        init?.method === 'PATCH'
      ) {
        const body = JSON.parse(String(init.body))
        writes.push({ url, headers: new Headers(init.headers), body })
        return Response.json(zeroRows ? [] : [{ ...stored, ...body }])
      }
      throw new Error('Unexpected synthetic PostgREST request')
    }
  })
  vi.mocked(db).mockResolvedValue(client as never)
})

describe('target-note route through the real Supabase PostgREST builder', () => {
  it('returns the existing seeded legacy row via a scoped update/select/maybeSingle request', async () => {
    const response = await PATCH(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      row: { ...stored, notes: 'Revised annotation', updated_by: userId }
    })
    expect(writes).toHaveLength(1)
    expect(writes[0]!.body).toEqual({
      notes: 'Revised annotation',
      updated_by: userId
    })
    expect(Object.fromEntries(writes[0]!.url.searchParams)).toEqual({
      guild_code: 'eq.SYN-TARGETS',
      boss_name: 'eq.Magnus',
      rarity: 'eq.Mythic',
      set: 'eq.1',
      encounter_id: 'eq.1',
      season_number: 'eq.',
      select: '*'
    })
    expect(writes[0]!.headers.get('prefer')).toContain('return=representation')
    expect(writes[0]!.headers.get('authorization')).toBe(
      'Bearer synthetic-caller-token'
    )
  })

  it('turns the real client zero-row array response into a missing-target refusal', async () => {
    zeroRows = true
    const response = await PATCH(request())
    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('Target not found')
  })
})
