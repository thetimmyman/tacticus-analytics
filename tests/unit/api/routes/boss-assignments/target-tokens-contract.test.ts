import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth', () => ({ requireActiveMembershipForApi: vi.fn() }))
vi.mock('@/app/lib/db', () => ({ db: vi.fn() }))

import {
  DELETE,
  GET,
  PATCH,
  PUT
} from '@/app/api/boss-assignments/target-tokens/route'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { db } from '@/app/lib/db'

type Row = Record<string, unknown>
let targets: Row[]
let membership: Row[]
let deleteNoop: boolean
let updateError: { code: string; message: string } | null
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
      let updating = false
      const rows = () =>
        (table === 'boss_target_tokens'
          ? targets
          : table === 'boss_mapping'
            ? [{ boss_type: 'Magnus', encounter_index: 1 }]
            : membership
        ).filter((row) => filters.every((filter) => filter(row)))
      const result = () => {
        if (updating) {
          if (updateError) return { data: null, error: updateError }
          const selected = rows()
          for (const row of selected) Object.assign(row, payload)
          return { data: selected[0] ?? null, error: null }
        }
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
        update: (value: Row) => {
          payload = value
          updating = true
          return query
        },
        delete: () => {
          deleting = true
          return query
        },
        single: async () => result(),
        maybeSingle: async () =>
          updating ? result() : { data: rows()[0] ?? null, error: null },
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
  updateError = null
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

const read = async (season = '103') => {
  const response = await GET(
    new NextRequest(
      `http://localhost/api/boss-assignments/target-tokens?season=${season}`
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
const patch = (body: unknown) =>
  PATCH(
    new NextRequest('http://localhost/api/boss-assignments/target-tokens', {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
  )
const noteBody = {
  boss_name: 'Magnus',
  rarity: 'Mythic',
  set: 1,
  encounter_id: 1,
  season_number: '103',
  notes: 'Saved target annotation'
}
const remove = (extra = '', set = '1', encounter = '1') =>
  DELETE(
    new NextRequest(
      `http://localhost/api/boss-assignments/target-tokens?boss_name=Magnus&rarity=Mythic&set=${set}&encounter_id=${encounter}${extra}`,
      { method: 'DELETE' }
    )
  )

describe('target-token request contract', () => {
  it('edits a seeded target note without converting its value or provenance to a manual override', async () => {
    targets = [
      {
        ...target,
        source: 'historical_seed',
        seeded_from_seasons: '101,102',
        skip: true
      }
    ]
    const response = await patch({
      boss_name: 'Magnus',
      rarity: 'Mythic',
      set: 1,
      encounter_id: 1,
      season_number: '103',
      notes: 'Keep refreshing from saved history'
    })
    expect(response.status).toBe(200)
    expect((await read()).body.rows).toEqual([
      {
        ...target,
        source: 'historical_seed',
        seeded_from_seasons: '101,102',
        skip: true,
        notes: 'Keep refreshing from saved history',
        updated_by: identity.id
      }
    ])
  })

  it('clears a none-available sentinel note while retaining the sentinel and skip semantics', async () => {
    targets = [
      {
        ...target,
        source: 'historical_seed',
        seeded_from_seasons: 'None available',
        target_tokens: 1,
        skip: true
      }
    ]
    expect((await patch({ ...noteBody, notes: '' })).status).toBe(200)
    expect((await read()).body.rows).toEqual([
      {
        ...target,
        source: 'historical_seed',
        seeded_from_seasons: 'None available',
        target_tokens: 1,
        skip: true,
        notes: null,
        updated_by: identity.id
      }
    ])
  })

  it('annotates the exact legacy fallback without changing a selected-season override', async () => {
    targets.push({
      ...target,
      season_number: '',
      source: 'historical_seed',
      target_tokens: 9,
      seeded_from_seasons: '101,102'
    })
    expect((await patch({ ...noteBody, season_number: '' })).status).toBe(200)
    expect((await read()).body.rows).toEqual([target])
    expect((await read('102')).body.rows).toEqual([
      {
        ...target,
        season_number: '',
        source: 'historical_seed',
        target_tokens: 9,
        seeded_from_seasons: '101,102',
        notes: 'Saved target annotation',
        updated_by: identity.id
      }
    ])
  })

  it('does not create a target when the exact stored identity is absent', async () => {
    expect((await patch({ ...noteBody, season_number: '104' })).status).toBe(
      404
    )
    expect((await read()).body.rows).toEqual([target])
    expect((await read('104')).body.rows).toEqual([])
  })

  it('refuses an omitted encounter instead of annotating the main target by default', async () => {
    targets.push({ ...target, encounter_id: 0, notes: 'Main target note' })
    expect((await patch({ ...noteBody, encounter_id: undefined })).status).toBe(
      400
    )
    expect((await read()).body.rows).toEqual([
      target,
      { ...target, encounter_id: 0, notes: 'Main target note' }
    ])
  })

  it.each([
    { source: 'officer_manual' },
    { seeded_from_seasons: 'forged' },
    { target_tokens: 99 },
    { skip: true },
    { guild_code: 'SYN-FOREIGN' },
    { updated_by: '00000000-0000-4000-8000-000000000002' },
    { season_number: undefined },
    { season_number: null },
    { season_number: '103junk' },
    { notes: undefined },
    { notes: { text: 'malformed' } },
    { set: '1junk' },
    { encounter_id: 3 }
  ])(
    'refuses malformed or value/provenance-bearing note changes: %j',
    async (input) => {
      expect((await patch({ ...noteBody, ...input })).status).toBe(400)
      expect((await read()).body.rows).toEqual([target])
    }
  )

  it.each([
    { role: 'member' },
    { is_current: false },
    { guild_code: 'SYN-FOREIGN' }
  ])(
    'refuses note changes outside current officer authority: %j',
    async (input) => {
      membership = [{ ...membership[0], ...input }]
      expect((await patch(noteBody)).status).toBe(403)
      membership = [
        {
          user_id: identity.id,
          guild_code: 'SYN-TARGETS',
          role: 'officer',
          is_current: true
        }
      ]
      expect((await read()).body.rows).toEqual([target])
    }
  )

  it('refuses an app-admin member note change before a filtered update can look successful', async () => {
    membership[0]!.role = 'member'
    vi.mocked(requireActiveMembershipForApi).mockResolvedValue({
      user: identity,
      profile: { guild_code: 'SYN-TARGETS', is_app_admin: true }
    } as never)
    expect((await patch(noteBody)).status).toBe(403)
    expect((await read()).body.rows).toEqual([target])
  })

  it.each([
    [{ code: '42501', message: 'row-level security refusal' }, 403],
    [{ code: '08006', message: 'connection failed' }, 500]
  ] as const)(
    'reports a refused or failed note update without changing the target',
    async (error, status) => {
      updateError = error
      expect((await patch(noteBody)).status).toBe(status)
      expect((await read()).body.rows).toEqual([target])
    }
  )

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
