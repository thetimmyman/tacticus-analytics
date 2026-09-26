import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// A failed single-row retry logs the constraint error and key so row loss is diagnosable.
describe('upsertDataBatches — single-row retry error logging (PS-532)', () => {
  let mockLogger: {
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    debug: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.resetModules()
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }

    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: vi.fn(() => mockLogger),
      logger: mockLogger,
      generateRequestId: vi.fn(() => 'test-request-id'),
      logError: vi.fn()
    }))

    vi.doMock('@/app/lib/utils/error-handling', () => ({
      parseSupabaseError: vi.fn((error: { message?: string } | null) => ({
        message: error?.message || 'Unknown error'
      }))
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs the single-row retry error with row key columns and increments errors by exactly 1', async () => {
    const record = {
      Guild: 'TEST_GUILD',
      Season: '81',
      userId: 'player1',
      encounterId: 3,
      startedOn: '2026-09-01T00:00:00.000Z',
      completedOn: '2026-09-01T00:05:00.000Z',
      damageDealt: 12345,
      damageType: 'Battle'
    }

    const singleUpsertError = {
      message: 'duplicate key value violates unique constraint',
      code: '23505',
      details:
        'Key (Guild, Season, userId)=(TEST_GUILD, 81, player1) already exists.'
    }

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        upsert: vi
          .fn()
          .mockReturnValueOnce({
            select: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'batch failed' }
            })
          })
          .mockReturnValueOnce({
            select: vi.fn().mockResolvedValue({
              data: null,
              error: singleUpsertError
            })
          })
      })
    }

    const { upsertDataBatches } =
      await import('@/app/lib/sync/db-operations/raid-upsert')

    const result = await upsertDataBatches(
      mockSupabase as never,
      'TEST_GUILD',
      [record] as never
    )

    expect(result.errors).toBe(1)
    expect(result.upserted).toBe(0)

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        guildCode: 'TEST_GUILD',
        key: expect.objectContaining({
          Guild: 'TEST_GUILD',
          Season: '81',
          userId: 'player1',
          encounterId: 3,
          startedOn: '2026-09-01T00:00:00.000Z',
          completedOn: '2026-09-01T00:05:00.000Z',
          damageDealt: 12345,
          damageType: 'Battle'
        }),
        code: '23505'
      }),
      expect.stringContaining('duplicate key value violates unique constraint')
    )

    const retryLogCall = mockLogger.warn.mock.calls.find(
      (call) => typeof call[1] === 'string' && call[1].includes('retry failed')
    ) as [Record<string, unknown>, string]
    expect(retryLogCall).toBeDefined()
    const [loggedContext] = retryLogCall
    expect(loggedContext).not.toHaveProperty('record')
    // Postgres `details` carries the whole row, including names the sanitizer cannot redact.
    expect(loggedContext).not.toHaveProperty('details')
    expect(JSON.stringify(loggedContext)).not.toContain('already exists')
    expect(Object.keys(loggedContext.key as object).sort()).toEqual(
      [
        'Guild',
        'Season',
        'completedOn',
        'damageDealt',
        'damageType',
        'encounterId',
        'startedOn',
        'userId'
      ].sort()
    )
  })
})
