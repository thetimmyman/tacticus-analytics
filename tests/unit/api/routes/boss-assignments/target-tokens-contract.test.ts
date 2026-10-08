import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth', () => ({ requireActiveMembershipForApi: vi.fn() }))
vi.mock('@/app/lib/db', () => ({ db: vi.fn() }))

import {
  DELETE,
  GET,
  PUT
} from '@/app/api/boss-assignments/target-tokens/route'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { db } from '@/app/lib/db'

type Row = Record<string, unknown>
let targets: Row[]
let membership: Row[]
let deleteNoop: boolean
const identity = { id: '00000000-0000-4000-8000-000000000001' }
const target = {
  guild_code: 'SYN-TARGETS',
  boss_name: 'Magnus',
  rarity: 'Mythic',
  set: 1,
  encounter_id: 1,
  season_number: '103',
  target_tokens: 4,
  notes: 'Keep the first note',
  skip: false,
  source: 'officer_manual'
}

// Database adapter at the external seam; policy enforcement is proved separately
// against the selected canonical SQL, not reimplemented in this fixture.
function database() {
  return {
    from(table: string) {
      let filters: Array<(row: Row) => boolean> = []
      let payload: Row | undefined
      let deleting = false
      const rows = () =>
        (table === 'boss_target_tokens'
          ? targets
          : table === 'boss_mapping'
            ? [{ boss_type: 'Magnus', encounter_index: 1 }]
            : membership
        ).filter((row) => filters.every((filter) => filter(row)))
      const result = () => {
        if (deleting) {
          if (!deleteNoop)
            targets = targets.filter((row) => !rows().includes(row))
          return { data: [], error: null }
        }
        if (payload) {
          const index = targets.findIndex((row) =>
            [
              'guild_code',
              'boss_name',
              'rarity',
              'set',
              'encounter_id',
              'season_number'
            ].every((key) => row[key] === payload![key])
          )
          const saved = { ...(index < 0 ? {} : targets[index]), ...payload }
          if (index < 0) targets.push(saved)
          else targets[index] = saved
          return { data: saved, error: null }
        }
        return { data: rows(), error: null }
      }
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push((row) => row[key] === value)
          return query
        },
        in: (key: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[key]))
          return query
        },
        order: () => query,
        limit: () => query,
        upsert: (value: Row) => {
          payload = value
          return query
        },
        delete: () => {
          deleting = true
          return query
        },
        single: async () => result(),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve)
      }
      return query
    }
  }
}

beforeEach(() => {
  targets = [{ ...target }]
  deleteNoop = false
  membership = [
    {
      user_id: identity.id,
      guild_code: 'SYN-TARGETS',
      role: 'officer',
      is_current: true
    }
  ]
  vi.mocked(requireActiveMembershipForApi).mockResolvedValue({
    user: identity,
    profile: { guild_code: 'SYN-TARGETS', is_app_admin: false }
  } as never)
  vi.mocked(db).mockResolvedValue(database() as never)
})

const read = async () => {
  const response = await GET(
    new NextRequest(
      'http://localhost/api/boss-assignments/target-tokens?season=103'
    )
  )
  return { status: response.status, body: await response.json() }
}
const put = (body: unknown) =>
  PUT(
    new NextRequest('http://localhost/api/boss-assignments/target-tokens', {
      method: 'PUT',
      body: JSON.stringify(body)
    })
  )
const remove = (extra = '', set = '1', encounter = '1') =>
  DELETE(
    new NextRequest(
      `http://localhost/api/boss-assignments/target-tokens?boss_name=Magnus&rarity=Mythic&set=${set}&encounter_id=${encounter}${extra}`,
      { method: 'DELETE' }
    )
  )

describe('target-token request contract', () => {
  it('refuses a partially numeric set and preserves the readable saved target', async () => {
    const response = await put({ ...target, set: '1junk', target_tokens: 99 })
    expect(response.status).toBe(400)
    expect((await read()).body.rows).toEqual([target])
  })

  it.each([
    { set: 1.5 },
    { set: [1] },
    { encounter_id: 1.5 },
    { encounter_id: null },
    { target_tokens: '4junk' },
    { target_tokens: [] },
    { season_number: ['103'] },
    { skip: 'true' },
    { notes: { text: 'silently cleared' } }
  ])(
    'refuses malformed target values without changing saved state: %j',
    async (patch) => {
      const response = await put({ ...target, ...patch })
      expect(response.status).toBe(400)
      expect((await read()).body.rows).toEqual([target])
    }
  )

  it('refuses a boss encounter absent from the canonical boss mapping', async () => {
    const response = await put({ ...target, encounter_id: 2 })
    expect(response.status).toBe(400)
    expect((await read()).body.rows).toEqual([target])
  })

  it('refuses stale and foreign memberships using the current mapping', async () => {
    membership[0]!.is_current = false
    expect((await put({ ...target, target_tokens: 99 })).status).toBe(403)
    membership[0]!.is_current = true
    membership[0]!.guild_code = 'SYN-FOREIGN'
    expect((await put({ ...target, target_tokens: 99 })).status).toBe(403)
    membership[0]!.guild_code = 'SYN-TARGETS'
    expect((await read()).body.rows).toEqual([target])
  })

  it('round-trips officer values, notes and skip through the request interface', async () => {
    const response = await put({
      ...target,
      target_tokens: 7.5,
      notes: 'Use the saved team',
      skip: true
    })
    expect(response.status).toBe(200)
    expect((await read()).body.rows).toEqual([
      {
        ...target,
        target_tokens: 7.5,
        notes: 'Use the saved team',
        skip: true,
        updated_by: identity.id
      }
    ])
  })

  it('deletes an explicitly selected legacy fallback without deleting season overrides', async () => {
    targets.push({ ...target, season_number: '', target_tokens: 9 })
    expect((await remove('&season=')).status).toBe(200)
    expect((await read()).body.rows).toEqual([target])
  })

  it.each([
    ['1junk', '1'],
    ['6', '1'],
    ['1', '1junk'],
    ['1', '1.5']
  ])(
    'refuses malformed delete identity %s/%s and preserves target',
    async (set, encounter) => {
      expect((await remove('&season=103', set, encounter)).status).toBe(400)
      expect((await read()).body.rows).toEqual([target])
    }
  )

  it('reports refusal for an app-admin member even when database DELETE filters all rows', async () => {
    membership[0]!.role = 'member'
    deleteNoop = true
    vi.mocked(requireActiveMembershipForApi).mockResolvedValue({
      user: identity,
      profile: { guild_code: 'SYN-TARGETS', is_app_admin: true }
    } as never)
    expect((await remove('&season=103')).status).toBe(403)
    expect((await read()).body.rows).toEqual([target])
  })
})
