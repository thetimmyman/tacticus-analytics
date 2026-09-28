import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The route gate is wider than RLS, so an RLS denial must be a 403, not a 500. PostgREST builds
// `DO UPDATE SET` from payload keys, so an omitted `notes` key must stay out of the upsert.

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

import { DELETE, PUT } from '@/app/api/boss-assignments/target-tokens/route'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { db } from '@/app/lib/db'

const upsertMock = vi.fn()

let upsertError: Record<string, unknown> | null = null
let deleteError: Record<string, unknown> | null = null

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
        builder.delete = () => {
          const deleteBuilder: Record<string, unknown> = {}
          deleteBuilder.eq = () => deleteBuilder
          deleteBuilder.then = (resolve: (v: unknown) => unknown) =>
            resolve({ error: deleteError })
          return deleteBuilder
        }
        builder.upsert = (
          payload: Record<string, unknown>,
          options: { onConflict?: string }
        ) => {
          upsertMock(payload, options)
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: upsertError ? null : payload,
                  error: upsertError
                })
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
  upsertError = null
  deleteError = null
  // app-admin: exactly the caller the route lets through and RLS refuses.
  vi.mocked(requireActiveMembershipForApi).mockResolvedValue({
    user: { id: 'user-1' },
    profile: { guild_code: 'ABCD', is_app_admin: true }
  } as never)
  vi.mocked(db).mockResolvedValue(buildSupabaseMock() as never)
})

function putRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost/api/boss-assignments/target-tokens',
    {
      method: 'PUT',
      body: JSON.stringify(body)
    }
  )
}

function deleteRequest(qs: string) {
  return new NextRequest(
    `http://localhost/api/boss-assignments/target-tokens?${qs}`,
    { method: 'DELETE' }
  )
}

const baseBody = {
  boss_name: 'HiveTyrantKronos',
  rarity: 'Legendary',
  set: 3,
  encounter_id: 0,
  target_tokens: 5
}

const DELETE_QUERY =
  'boss_name=HiveTyrantKronos&rarity=Legendary&set=3&encounter_id=0'

const RLS_MESSAGE =
  'new row violates row-level security policy for table "boss_target_tokens"'

describe('target-tokens maps an RLS denial to 403, not 500', () => {
  it('PUT: SQLSTATE 42501 becomes a 403 naming the officer/leader requirement', async () => {
    upsertError = { code: '42501', message: RLS_MESSAGE }

    const res = await PUT(putRequest(baseBody))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.message).toContain('officer or leader')
    expect(body.error.message).toContain('ABCD')
    expect(body.error.message).not.toContain('Failed to save target')
    expect(body.error.metadata?.code).toBe('FORBIDDEN')
  })

  it('PUT: an RLS message without a code still maps to 403', async () => {
    // Some paths surface the policy violation without a SQLSTATE.
    upsertError = { message: RLS_MESSAGE }

    const res = await PUT(putRequest(baseBody))
    expect(res.status).toBe(403)
  })

  it('PUT: a genuine DB fault is still a 500 (403 mapping is not a blanket)', async () => {
    upsertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint'
    }

    const res = await PUT(putRequest(baseBody))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error.message).toBe('Failed to save target')
  })

  it('DELETE: SQLSTATE 42501 becomes a 403 naming the requirement', async () => {
    deleteError = { code: '42501', message: RLS_MESSAGE }

    const res = await DELETE(deleteRequest(DELETE_QUERY))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.message).toContain('officer or leader')
    expect(body.error.metadata?.code).toBe('FORBIDDEN')
  })

  it('DELETE: a genuine DB fault is still a 500', async () => {
    deleteError = { code: '08006', message: 'connection failure' }

    const res = await DELETE(deleteRequest(DELETE_QUERY))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error.message).toBe('Failed to delete target')
  })
})

describe('target-tokens PUT is notes-preserving', () => {
  it('omits the notes column entirely when the caller sends no notes key', async () => {
    const res = await PUT(putRequest(baseBody))

    expect(res.status).toBe(200)
    const [payload] = upsertMock.mock.calls[0]
    expect(Object.prototype.hasOwnProperty.call(payload, 'notes')).toBe(false)
    expect(payload).toMatchObject({
      guild_code: 'ABCD',
      boss_name: 'HiveTyrantKronos',
      target_tokens: 5,
      source: 'officer_manual'
    })
  })

  it('writes an explicitly-supplied note', async () => {
    await PUT(putRequest({ ...baseBody, notes: 'bring anti-armour' }))
    const [payload] = upsertMock.mock.calls[0]
    expect(payload.notes).toBe('bring anti-armour')
  })

  it('treats an explicit empty string as a clear (null), not as an omission', async () => {
    await PUT(putRequest({ ...baseBody, notes: '' }))
    const [payload] = upsertMock.mock.calls[0]
    expect(Object.prototype.hasOwnProperty.call(payload, 'notes')).toBe(true)
    expect(payload.notes).toBeNull()
  })

  it('treats an explicit null as a clear', async () => {
    await PUT(putRequest({ ...baseBody, notes: null }))
    const [payload] = upsertMock.mock.calls[0]
    expect(Object.prototype.hasOwnProperty.call(payload, 'notes')).toBe(true)
    expect(payload.notes).toBeNull()
  })

  it('still truncates a supplied note to 500 chars', async () => {
    await PUT(putRequest({ ...baseBody, notes: 'x'.repeat(600) }))
    const [payload] = upsertMock.mock.calls[0]
    expect(payload.notes).toHaveLength(500)
  })
})
