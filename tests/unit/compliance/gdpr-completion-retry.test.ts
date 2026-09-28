import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Covered by erase-user-data-departed.test.ts.
vi.mock('@/app/lib/compliance/anonymize-subject-battle-rows', () => ({
  anonymizeSubjectBattleRows: vi.fn(async () => 0)
}))

/** Completion retries once; failure events carry an unredacted descriptor (class, code, field names). */

const USER_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST_ID = '33333333-3333-4333-8333-333333333333'

const mocks = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

type UpdateCall = { table: string; payload: Record<string, unknown> }

function transportError(): Error & { code: string } {
  const error = new Error('socket hang up') as Error & { code: string }
  error.code = 'ECONNRESET'
  return error
}

function postgrestError() {
  return {
    message: 'permission denied for table gdpr_deletion_requests',
    details: 'Failing row contains (…)',
    hint: null,
    code: '42501',
    status: 403
  }
}

type Row = {
  request_id: string
  user_id: string
  request_type: 'complete' | 'partial'
  requested_at: string
  scheduled_for: string
  status: string
  data_categories: string[]
  completed_at: string | null
  created_at: string
}

function scheduledRow(): Row {
  return {
    request_id: REQUEST_ID,
    user_id: USER_ID,
    request_type: 'complete',
    requested_at: '2026-09-01T00:00:00.000Z',
    scheduled_for: '2026-09-02T00:00:00.000Z',
    status: 'scheduled',
    data_categories: ['all'],
    completed_at: null,
    created_at: '2026-09-01T00:00:00.000Z'
  }
}

function createHarness(
  options: {
    failCompletions?: number
    failureMode?: 'throw' | 'return'
    rows?: Row[]
  } = {}
) {
  const failCompletions = options.failCompletions ?? 0
  const failureMode = options.failureMode ?? 'throw'
  const rows = options.rows ?? []
  const updates: UpdateCall[] = []
  let completionAttempts = 0
  let filedRequestId = ''

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
        }),
        in: vi.fn(() => {
          updates.push({ table, payload })
          return result
        })
      }
    })

  const from = vi.fn((table: string) => {
    if (table === 'gdpr_deletion_requests') {
      return {
        insert: vi.fn((row: Record<string, unknown>) => {
          filedRequestId = row.request_id as string
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: row, error: null }))
            }))
          }
        }),
        select: vi.fn(() => {
          const filters: ((r: Row) => boolean)[] = []
          const chain = {
            eq: vi.fn((column: keyof Row, value: unknown) => {
              filters.push((r) => r[column] === value)
              return chain
            }),
            lte: vi.fn((column: keyof Row, value: string) => {
              filters.push((r) => String(r[column]) <= value)
              return chain
            }),
            returns: vi.fn(async () => ({
              data: rows.filter((r) => filters.every((f) => f(r))),
              error: null
            }))
          }
          return chain
        }),
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn(async (_column: string, requestId: string) => {
            completionAttempts += 1
            if (completionAttempts <= failCompletions) {
              if (failureMode === 'throw') throw transportError()
              return { error: postgrestError() }
            }
            updates.push({ table, payload: { ...payload, requestId } })
            return { error: null }
          })
        }))
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
        getUserById: vi.fn(async (userId: string) => ({
          data: { user: { id: userId } },
          error: null
        })),
        deleteUser: vi.fn(async () => ({ error: null }))
      }
    }
  }

  return {
    client,
    completionAttempts: () => completionAttempts,
    completions: () =>
      updates.filter((u) => u.table === 'gdpr_deletion_requests'),
    filedRequestId: () => filedRequestId
  }
}

function loggedEvent(
  spy: typeof mocks.logger.error,
  event: string
): Record<string, unknown> | undefined {
  const call = spy.mock.calls.find(
    (args) => (args[0] as Record<string, unknown> | undefined)?.event === event
  )
  return call?.[0] as Record<string, unknown> | undefined
}

async function mockModules(client: unknown) {
  vi.doMock('@/app/lib/db', () => ({
    db: vi.fn().mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } })
      }
    }),
    serviceDb: vi.fn().mockReturnValue(client)
  }))
  vi.doMock('@/app/lib/auth/user-bans', () => ({
    findActiveBanForAuthUser: vi.fn().mockResolvedValue(null)
  }))
  vi.doMock('@/app/lib/middleware/rate-limit', () => ({
    apiSecurityMiddleware: vi.fn().mockResolvedValue(null)
  }))
  vi.doMock('@/app/lib/logging', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/app/lib/logging')>()),
    createComponentLogger: () => mocks.logger
  }))
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
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

describe('POST /api/account/delete survives one failed ledger close', () => {
  it('retries the completion write once and closes the record', async () => {
    vi.resetModules()
    const harness = createHarness({ failCompletions: 1, failureMode: 'throw' })
    await mockModules(harness.client)
    const { POST } = await import('@/app/api/account/delete/route')

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(harness.completionAttempts()).toBe(2)

    const completions = harness.completions()
    expect(completions).toHaveLength(1)
    expect(completions[0].payload.status).toBe('completed')
    expect(completions[0].payload.requestId).toBe(harness.filedRequestId())

    expect(
      loggedEvent(
        mocks.logger.error,
        'gdpr.account_delete.completion_write_failed'
      )
    ).toBeUndefined()
    expect(
      loggedEvent(mocks.logger.info, 'gdpr.account_delete.completed_inline')
    ).toBeDefined()

    const retry = loggedEvent(
      mocks.logger.warn,
      'gdpr.deletion.completion_write_retry'
    )
    expect(retry).toBeDefined()
    expect(retry?.failure).toMatchObject({
      errorClass: 'Error',
      code: 'ECONNRESET',
      status: null
    })
  })

  it('LOG SHAPE: a completion write that fails twice logs an unredacted descriptor', async () => {
    vi.resetModules()
    const harness = createHarness({ failCompletions: 2, failureMode: 'return' })
    await mockModules(harness.client)
    const { POST } = await import('@/app/api/account/delete/route')

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(harness.completions()).toEqual([])

    const failed = loggedEvent(
      mocks.logger.error,
      'gdpr.account_delete.completion_write_failed'
    )
    expect(failed).toBeDefined()
    expect(failed?.failure).toMatchObject({
      errorClass: 'Object',
      code: '42501',
      status: 403
    })
    // Field names only: `details` can quote user data.
    expect(failed?.failure).toHaveProperty('fields')
    expect((failed?.failure as { fields: string[] }).fields).toContain(
      'details'
    )
    expect(JSON.stringify(failed?.failure)).not.toContain('Failing row')
    expect(harness.completionAttempts()).toBe(2)
  })
})

describe('gdpr-cleanup executor survives one failed ledger close', () => {
  async function runExecutor(options: {
    failCompletions: number
    failureMode: 'throw' | 'return'
  }) {
    vi.resetModules()
    const harness = createHarness({ ...options, rows: [scheduledRow()] })
    await mockModules(harness.client)
    const { gdprManager } = await import('@/app/lib/compliance/gdpr-manager')
    await gdprManager.executeScheduledDeletions()
    return harness
  }

  it('retries once and completes the row instead of stranding it scheduled', async () => {
    const harness = await runExecutor({
      failCompletions: 1,
      failureMode: 'throw'
    })

    expect(harness.client.auth.admin.deleteUser).toHaveBeenCalledWith(USER_ID)
    expect(harness.completionAttempts()).toBe(2)
    const completions = harness.completions()
    expect(completions).toHaveLength(1)
    expect(completions[0].payload.status).toBe('completed')
    expect(completions[0].payload.requestId).toBe(REQUEST_ID)
    expect(
      loggedEvent(mocks.logger.error, 'gdpr.deletion.execution_failed')
    ).toBeUndefined()
  })

  it('LOG SHAPE: an execution failure carries the unredacted descriptor', async () => {
    const harness = await runExecutor({
      failCompletions: 2,
      failureMode: 'return'
    })

    const failed = loggedEvent(
      mocks.logger.error,
      'gdpr.deletion.execution_failed'
    )
    expect(failed).toBeDefined()
    expect(failed?.failure).toMatchObject({
      errorClass: 'Object',
      code: '42501',
      status: 403
    })
    expect(JSON.stringify(failed?.failure)).not.toContain('Failing row')
    expect(harness.completionAttempts()).toBe(2)
  })
})
