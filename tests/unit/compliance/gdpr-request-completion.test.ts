import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A subject whose auth row is gone has its Article 17 record closed, not re-erased forever. */

const mocks = vi.hoisted(() => ({
  serviceDb: vi.fn(),
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

vi.mock('@/app/lib/db', () => ({ db: vi.fn(), serviceDb: mocks.serviceDb }))
vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => mocks.logger
}))

const ABSENT_USER = '11111111-1111-4111-8111-111111111111'
const PRESENT_USER = '22222222-2222-4222-8222-222222222222'

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

function row(overrides: Partial<Row> = {}): Row {
  return {
    request_id: '33333333-3333-4333-8333-333333333333',
    user_id: ABSENT_USER,
    request_type: 'complete',
    requested_at: '2026-09-01T00:00:00.000Z',
    scheduled_for: '2026-09-02T00:00:00.000Z',
    status: 'scheduled',
    data_categories: ['all'],
    completed_at: null,
    created_at: '2026-09-01T00:00:00.000Z',
    ...overrides
  }
}

function createClient(rows: Row[], presentUsers: string[]) {
  const updates: { requestId: string; payload: Record<string, unknown> }[] = []

  const from = vi.fn((table: string) => {
    if (table === 'gdpr_deletion_requests') {
      return {
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
            updates.push({ requestId, payload })
            return { error: null }
          })
        }))
      }
    }
    throw new Error(`Unexpected table ${table}`)
  })

  const client = {
    from,
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: {
      admin: {
        getUserById: vi.fn(async (userId: string) =>
          presentUsers.includes(userId)
            ? { data: { user: { id: userId } }, error: null }
            : {
                data: { user: null },
                error: {
                  message: 'User not found',
                  code: 'user_not_found',
                  status: 404
                }
              }
        ),
        deleteUser: vi.fn(async () => ({ error: null }))
      }
    }
  }

  return { client, updates }
}

async function runExecutor(rows: Row[], presentUsers: string[]) {
  vi.resetModules()
  const harness = createClient(rows, presentUsers)
  mocks.serviceDb.mockReturnValue(harness.client)
  const { gdprManager } = await import('@/app/lib/compliance/gdpr-manager')
  const audit = vi
    .spyOn(gdprManager, 'recordDataProcessing')
    .mockResolvedValue(undefined)
  await gdprManager.executeScheduledDeletions()
  return { ...harness, audit }
}

describe('gdpr executor closes records for already-absent subjects (PS-190)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks a due row for an absent subject completed with a timestamp, without throwing or skipping', async () => {
    const { updates, client, audit } = await runExecutor([row()], [])

    expect(updates).toHaveLength(1)
    expect(updates[0].requestId).toBe('33333333-3333-4333-8333-333333333333')
    expect(updates[0].payload.status).toBe('completed')
    expect(
      Number.isFinite(Date.parse(updates[0].payload.completed_at as string))
    ).toBe(true)

    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.auth.admin.deleteUser).not.toHaveBeenCalled()

    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'gdpr.deletion.subject_already_absent',
        requestId: '33333333-3333-4333-8333-333333333333'
      }),
      expect.stringContaining('subject already absent')
    )
    expect(mocks.logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'gdpr.deletion.execution_failed' }),
      expect.anything()
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ dataType: 'deletion_completed' })
    )
  })

  it('NEGATIVE CONTROL: a future-dated row for a subject that still exists is not completed', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const { updates, client } = await runExecutor(
      [
        row({
          request_id: '44444444-4444-4444-8444-444444444444',
          user_id: PRESENT_USER,
          scheduled_for: future
        })
      ],
      [PRESENT_USER]
    )

    expect(updates).toEqual([])
    expect(client.auth.admin.getUserById).not.toHaveBeenCalled()
    expect(client.auth.admin.deleteUser).not.toHaveBeenCalled()
  })
})
