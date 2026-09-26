import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/compliance/anonymize-subject-battle-rows', () => ({
  anonymizeSubjectBattleRows: vi.fn(async () => 0)
}))

// A successful deletion must close its own Article 17 record; only db is mocked.

const USER_ID = '11111111-1111-4111-8111-111111111111'

type UpdateCall = { table: string; payload: Record<string, unknown> }

function createServiceClientHarness(
  options: { authDeleteFails?: boolean } = {}
) {
  const updates: UpdateCall[] = []
  const inserted: Record<string, unknown>[] = []
  let requestId = ''

  const genericUpdate = (table: string) =>
    vi.fn((payload: Record<string, unknown>) => {
      const settle = { error: null }
      const result = {
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
        then: (resolve: (value: { error: null }) => void) => resolve(settle)
      }
      return {
        eq: vi.fn(() => {
          updates.push({ table, payload })
          return result
        }),
        or: vi.fn(() => {
          updates.push({ table, payload })
          return result
        })
      }
    })

  const from = vi.fn((table: string) => {
    if (table === 'gdpr_deletion_requests') {
      return {
        insert: vi.fn((row: Record<string, unknown>) => {
          inserted.push(row)
          requestId = row.request_id as string
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: row, error: null }))
            }))
          }
        }),
        update: genericUpdate(table)
      }
    }
    if (table === 'gdpr_processing_log') {
      return { insert: vi.fn(async () => ({ error: null })) }
    }
    return {
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({ data: [], error: null }))
      })),
      update: genericUpdate(table),
      delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
    }
  })

  const client = {
    from,
    rpc: vi.fn(async () => ({
      data: {
        success: true,
        cleared_mapping_count: 1,
        deleted_mapping_count: 0,
        subject_authority_blocked: true,
        revoked_attestations: 1,
        purged_loki_credential_count: 0,
        purged_loki_guild_codes: [],
        binding_restorable: false
      },
      error: null
    })),
    auth: {
      admin: {
        deleteUser: vi.fn(async () => ({
          error: options.authDeleteFails
            ? { message: 'auth deletion failed' }
            : null
        }))
      }
    }
  }

  return {
    client,
    updates,
    inserted,
    completionUpdates: () =>
      updates.filter((u) => u.table === 'gdpr_deletion_requests'),
    requestId: () => requestId
  }
}

describe('POST /api/account/delete closes its Article 17 record (PS-190)', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let harness: ReturnType<typeof createServiceClientHarness>

  async function loadRoute(options: { authDeleteFails?: boolean } = {}) {
    vi.resetModules()
    harness = createServiceClientHarness(options)

    vi.doMock('@/app/lib/db', () => ({
      db: vi.fn().mockResolvedValue({
        auth: {
          getUser: vi
            .fn()
            .mockResolvedValue({ data: { user: { id: USER_ID } } })
        }
      }),
      serviceDb: vi.fn().mockReturnValue(harness.client)
    }))
    vi.doMock('@/app/lib/auth/user-bans', () => ({
      findActiveBanForAuthUser: vi.fn().mockResolvedValue(null)
    }))
    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: vi.fn().mockResolvedValue(null)
    }))
    vi.doMock('@/app/lib/logging', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/app/lib/logging')>()),
      createComponentLogger: () => ({
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      })
    }))

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')

    POST = (await import('@/app/api/account/delete/route')).POST
  }

  const request = () =>
    new NextRequest('http://localhost/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_ID, confirmationPhrase: 'DELETE' })
    })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('marks the deletion request completed with a timestamp after a successful erasure', async () => {
    await loadRoute()

    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(harness.client.auth.admin.deleteUser).toHaveBeenCalledWith(USER_ID)

    const completions = harness.completionUpdates()
    expect(completions).toHaveLength(1)
    expect(completions[0].payload.status).toBe('completed')
    expect(typeof completions[0].payload.completed_at).toBe('string')
    expect(
      Number.isFinite(Date.parse(completions[0].payload.completed_at as string))
    ).toBe(true)
    expect(harness.requestId()).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('does NOT close the record when the Auth deletion fails', async () => {
    await loadRoute({ authDeleteFails: true })

    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(harness.completionUpdates()).toEqual([])
  })
})
