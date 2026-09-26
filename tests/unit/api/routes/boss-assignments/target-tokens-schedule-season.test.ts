import { describe, expect, it, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
  return { ...actual, requireAuthForApi: vi.fn() }
})

vi.mock('@/app/lib/db', () => ({ db: vi.fn() }))

import { GET } from '@/app/api/boss-assignments/target-tokens/schedule/route'
import { requireAuthForApi } from '@/app/lib/auth'
import { db } from '@/app/lib/db'

function request(qs = '') {
  return new NextRequest(
    `http://localhost/api/boss-assignments/target-tokens/schedule${qs ? `?${qs}` : ''}`,
    { method: 'GET' }
  )
}

function buildSupabaseMock() {
  return {
    from: (table: string) => {
      if (table !== 'boss_mapping') {
        throw new Error(`unexpected table ${table}`)
      }
      return {
        select: () =>
          Promise.resolve({
            data: [
              {
                boss_type: 'HiveTyrantKronos',
                encounter_index: 1,
                boss_name: 'Prime One'
              }
            ],
            error: null
          })
      }
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuthForApi).mockResolvedValue({
    user: { id: 'user-1' },
    profile: { guild_code: 'ABCD', is_app_admin: true }
  } as never)
  vi.mocked(db).mockResolvedValue(buildSupabaseMock() as never)
})

describe('GET /api/boss-assignments/target-tokens/schedule — selected season', () => {
  it('returns a selected rotation for a requested season', async () => {
    const res = await GET(request('season=102'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.selected).toMatchObject({ season_number: 102 })
    expect(body.selected.slots.length).toBeGreaterThan(0)
    expect(body.current.slots.length).toBeGreaterThan(0)
    expect(body.upcoming.slots.length).toBeGreaterThan(0)
    expect(body.all.slots.length).toBeGreaterThan(0)
  })

  it('rejects malformed season input before loading the schedule', async () => {
    const res = await GET(request('season=102abc'))

    expect(res.status).toBe(400)
    expect(db).not.toHaveBeenCalled()
  })
})
