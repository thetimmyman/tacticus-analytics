import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type DirectClientMock = {
  query: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
}

type SyncSchedulerHandler = (
  payload: Record<string, unknown>,
  context: { jobId: number; workerId: string; attempts: number }
) => Promise<Record<string, unknown> | void>

let mockDirectClient: DirectClientMock
let mockCaptureSentryException: ReturnType<typeof vi.fn>
let syncSchedulerHandler: SyncSchedulerHandler

const context = {
  jobId: 1485,
  workerId: 'vitest-worker',
  attempts: 1
}

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

function guildRow(options: {
  code: string
  /** `guild_sync_status.last_sync`: last attempt (moves on failures). */
  lastSyncMinutesAgo: number | null
  /** `guild_config.last_successful_sync`; defaults to the attempt time (healthy case). */
  lastSuccessMinutesAgo?: number | null
  fullSyncHoursAgo: number | null
  healthStatus?: string | null
  consecutiveFailures?: number
  lastFailedMinutesAgo?: number | null
}) {
  const successMinutesAgo =
    options.lastSuccessMinutesAgo === undefined
      ? options.lastSyncMinutesAgo
      : options.lastSuccessMinutesAgo

  return {
    guild_code: options.code,
    enabled: true,
    last_successful_sync:
      successMinutesAgo === null ? null : isoMinutesAgo(successMinutesAgo),
    guild_sync_status: {
      last_sync:
        options.lastSyncMinutesAgo === null
          ? null
          : isoMinutesAgo(options.lastSyncMinutesAgo),
      status: null,
      full_sync_at:
        options.fullSyncHoursAgo === null
          ? null
          : isoHoursAgo(options.fullSyncHoursAgo)
    },
    sync_health: {
      health_status: options.healthStatus ?? null,
      consecutive_failures: options.consecutiveFailures ?? 0,
      data_freshness_hours: null,
      last_failed_sync:
        options.lastFailedMinutesAgo === undefined ||
        options.lastFailedMinutesAgo === null
          ? null
          : isoMinutesAgo(options.lastFailedMinutesAgo)
    }
  }
}

async function importHandler() {
  const module = await import('@/app/lib/jobs/sync-scheduler')
  syncSchedulerHandler = module.__internal.syncSchedulerHandler
  return module
}

describe('sync-scheduler work_queue handler', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-12T05:00:00.000Z'))

    mockDirectClient = {
      query: vi.fn(),
      rpc: vi.fn()
    }
    mockCaptureSentryException = vi.fn()

    vi.doMock('@/app/lib/network/direct-supabase', () => ({
      createDirectClient: () => mockDirectClient
    }))

    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      })
    }))

    vi.doMock('@/app/lib/errors/AppError', () => ({
      rethrowIfAppError: vi.fn()
    }))

    vi.doMock('@/app/lib/monitoring/sentry', () => ({
      captureSentryException: mockCaptureSentryException
    }))

    await importHandler()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('fetches valid-key guilds and enqueues the expected staleness jobs', async () => {
    const guilds = [
      guildRow({ code: 'FRESH', lastSyncMinutesAgo: 2, fullSyncHoursAgo: 1 }),
      guildRow({
        code: 'REALTIME',
        lastSyncMinutesAgo: 10,
        fullSyncHoursAgo: 1
      }),
      guildRow({
        code: 'INCREMENTAL',
        lastSyncMinutesAgo: 30,
        fullSyncHoursAgo: 1
      }),
      guildRow({
        code: 'PLAYER',
        lastSyncMinutesAgo: 370,
        fullSyncHoursAgo: 1
      }),
      guildRow({ code: 'FULL', lastSyncMinutesAgo: 30, fullSyncHoursAgo: 25 }),
      guildRow({
        code: 'CRITICAL',
        lastSyncMinutesAgo: 30,
        fullSyncHoursAgo: 1,
        healthStatus: 'critical'
      }),
      guildRow({
        code: 'COOLDOWN',
        lastSyncMinutesAgo: 30,
        fullSyncHoursAgo: 1,
        consecutiveFailures: 5,
        lastFailedMinutesAgo: 10
      }),
      guildRow({
        code: 'VALIDATE',
        lastSyncMinutesAgo: 30,
        fullSyncHoursAgo: 1,
        consecutiveFailures: 5,
        lastFailedMinutesAgo: 31
      })
    ]

    mockDirectClient.query.mockResolvedValue({ data: guilds, error: null })
    mockDirectClient.rpc.mockImplementation(
      async (_fn: string, args: Record<string, unknown>) => ({
        data: `job-${args.p_guild_code}`,
        error: null
      })
    )

    const result = await syncSchedulerHandler({}, context)

    expect(mockDirectClient.query).toHaveBeenCalledWith(
      expect.stringContaining('api_key_is_valid=not.is.false')
    )
    expect(mockDirectClient.rpc.mock.calls).toEqual([
      [
        'enqueue_sync',
        expect.objectContaining({
          p_guild_code: 'REALTIME',
          p_job_type: 'realtime_sync',
          p_priority: 3
        })
      ],
      [
        'enqueue_sync',
        expect.objectContaining({
          p_guild_code: 'INCREMENTAL',
          p_job_type: 'incremental_sync',
          p_priority: 5
        })
      ],
      [
        'enqueue_sync',
        expect.objectContaining({
          p_guild_code: 'PLAYER',
          p_job_type: 'player_sync',
          p_priority: 8
        })
      ],
      [
        'enqueue_sync',
        expect.objectContaining({
          p_guild_code: 'FULL',
          p_job_type: 'full_sync',
          p_priority: 7
        })
      ],
      [
        'enqueue_sync',
        expect.objectContaining({
          p_guild_code: 'CRITICAL',
          p_job_type: 'validation_sync',
          p_priority: 1
        })
      ],
      [
        'enqueue_sync',
        expect.objectContaining({
          p_guild_code: 'VALIDATE',
          p_job_type: 'validation_sync',
          p_priority: 1
        })
      ]
    ])
    expect(result).toMatchObject({
      guildsChecked: guilds.length,
      scheduled: 6,
      breakdown: {
        realtime_sync: 1,
        incremental_sync: 1,
        full_sync: 1,
        validation_sync: 2,
        player_sync: 1,
        total: 6
      }
    })
  })

  it('grades staleness on the success clock, not on when we last tried', async () => {
    // Nothing landed in 6.5h: grade by the success clock, not the attempt clock.
    const guilds = [
      guildRow({
        code: 'FAILING',
        lastSyncMinutesAgo: 10,
        lastSuccessMinutesAgo: 400,
        fullSyncHoursAgo: 1
      })
    ]

    mockDirectClient.query.mockResolvedValue({ data: guilds, error: null })
    mockDirectClient.rpc.mockImplementation(
      async (_fn: string, args: Record<string, unknown>) => ({
        data: `job-${args.p_guild_code}`,
        error: null
      })
    )

    await syncSchedulerHandler({}, context)

    expect(mockDirectClient.rpc.mock.calls).toEqual([
      [
        'enqueue_sync',
        expect.objectContaining({
          p_guild_code: 'FAILING',
          p_job_type: 'player_sync'
        })
      ]
    ])
  })

  it('still throttles retries on the attempt clock', async () => {
    const guilds = [
      guildRow({
        code: 'JUST_TRIED',
        lastSyncMinutesAgo: 2,
        lastSuccessMinutesAgo: 400,
        fullSyncHoursAgo: 1
      })
    ]

    mockDirectClient.query.mockResolvedValue({ data: guilds, error: null })
    mockDirectClient.rpc.mockImplementation(async () => ({
      data: 'job',
      error: null
    }))

    await syncSchedulerHandler({}, context)

    expect(mockDirectClient.rpc).not.toHaveBeenCalled()
  })

  it('runs the 06 UTC validation pass through ordered valid-key batches', async () => {
    vi.setSystemTime(new Date('2026-02-12T06:00:00.000Z'))

    mockDirectClient.query.mockImplementation(async (path: string) => {
      if (path.includes('offset=0&limit=50')) {
        return {
          data: [{ guild_code: 'ALPHA' }, { guild_code: 'BRAVO' }],
          error: null
        }
      }
      return { data: [], error: null }
    })
    mockDirectClient.rpc.mockResolvedValue({ data: 'job-id', error: null })

    const result = await syncSchedulerHandler({}, context)
    const validationPath = mockDirectClient.query.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .find((path: string) => path.includes('offset=0&limit=50'))

    expect(validationPath).toContain('api_key_encrypted=not.is.null')
    expect(validationPath).toContain('api_key_is_valid=not.is.false')
    expect(validationPath).toContain('order=guild_code.asc')
    expect(validationPath).toContain('offset=0&limit=50')
    expect(mockDirectClient.rpc.mock.calls).toEqual([
      [
        'enqueue_sync',
        expect.objectContaining({
          p_guild_code: 'ALPHA',
          p_job_type: 'validation_sync',
          p_priority: 9
        })
      ],
      [
        'enqueue_sync',
        expect.objectContaining({
          p_guild_code: 'BRAVO',
          p_job_type: 'validation_sync',
          p_priority: 9
        })
      ]
    ])
    expect(result).toMatchObject({
      guildsChecked: 0,
      scheduled: 2,
      breakdown: expect.objectContaining({
        validation_sync: 2,
        total: 2
      })
    })
  })

  describe('incremental syncs behind a pending realtime sync', () => {
    function mockQueries(activeRealtime: unknown) {
      mockDirectClient.query.mockImplementation(async (path: string) => {
        if (path.startsWith('sync_queue?')) return activeRealtime
        return {
          data: [
            guildRow({
              code: 'QUEUED',
              lastSyncMinutesAgo: 30,
              fullSyncHoursAgo: 1
            }),
            guildRow({
              code: 'IDLE',
              lastSyncMinutesAgo: 30,
              fullSyncHoursAgo: 1
            }),
            guildRow({
              code: 'DUE_REALTIME',
              lastSyncMinutesAgo: 10,
              fullSyncHoursAgo: 1
            })
          ],
          error: null
        }
      })
      mockDirectClient.rpc.mockImplementation(
        async (_fn: string, args: Record<string, unknown>) => ({
          data: `job-${args.p_guild_code}`,
          error: null
        })
      )
    }

    function enqueued(): Array<[string, string]> {
      return mockDirectClient.rpc.mock.calls.map((call: unknown[]) => {
        const args = call[1] as Record<string, unknown>
        return [String(args.p_guild_code), String(args.p_job_type)]
      })
    }

    it('reads the active realtime_sync rows for the park guard', async () => {
      mockQueries({ data: [], error: null })

      await syncSchedulerHandler({}, context)

      const activePath = mockDirectClient.query.mock.calls
        .map((call: unknown[]) => String(call[0]))
        .find((path: string) => path.startsWith('sync_queue?'))
      expect(activePath).toContain('job_type=eq.realtime_sync')
      expect(activePath).toContain('status=in.(pending,processing)')
    })

    it('does not queue an incremental sync while the guild has a claimable realtime sync', async () => {
      mockQueries({
        data: [
          {
            guild_code: 'QUEUED',
            status: 'pending',
            attempts: 0,
            max_attempts: 3
          },
          {
            guild_code: 'DUE_REALTIME',
            status: 'processing',
            attempts: 1,
            max_attempts: 3
          }
        ],
        error: null
      })

      const result = await syncSchedulerHandler({}, context)

      expect(enqueued()).toEqual([
        ['IDLE', 'incremental_sync'],
        ['DUE_REALTIME', 'realtime_sync']
      ])
      expect(result).toMatchObject({
        incrementalDeferred: 1,
        breakdown: expect.objectContaining({
          incremental_sync: 1,
          realtime_sync: 1
        })
      })
    })

    it('treats a processing realtime sync as active', async () => {
      mockQueries({
        data: [
          {
            guild_code: 'QUEUED',
            status: 'processing',
            attempts: 3,
            max_attempts: 3
          }
        ],
        error: null
      })

      await syncSchedulerHandler({}, context)

      expect(enqueued()).not.toContainEqual(['QUEUED', 'incremental_sync'])
    })

    it('still queues an incremental sync when the pending realtime row can never be claimed', async () => {
      mockQueries({
        data: [
          {
            guild_code: 'QUEUED',
            status: 'pending',
            attempts: 3,
            max_attempts: 3
          },
          {
            guild_code: 'IDLE',
            status: 'pending',
            attempts: 0,
            max_attempts: null
          }
        ],
        error: null
      })

      const result = await syncSchedulerHandler({}, context)

      expect(enqueued()).toEqual([
        ['QUEUED', 'incremental_sync'],
        ['IDLE', 'incremental_sync'],
        ['DUE_REALTIME', 'realtime_sync']
      ])
      expect(result).toMatchObject({ incrementalDeferred: 0 })
    })

    it.each([
      ['an error', { data: null, error: 'HTTP 503: unavailable' }],
      ['a non-array body', { data: { message: 'unexpected' }, error: null }]
    ])(
      'fails open and schedules as before when the active-job read returns %s',
      async (_label, response) => {
        mockQueries(response)

        const result = await syncSchedulerHandler({}, context)

        expect(enqueued()).toEqual([
          ['QUEUED', 'incremental_sync'],
          ['IDLE', 'incremental_sync'],
          ['DUE_REALTIME', 'realtime_sync']
        ])
        expect(result).toMatchObject({ incrementalDeferred: 0 })
        expect(mockCaptureSentryException).not.toHaveBeenCalled()
      }
    )
  })

  it('registers the canonical work_queue job type', async () => {
    vi.resetModules()
    const { getJobHandler } = await import('@/app/lib/jobs/dispatcher')
    const module = await import('@/app/lib/jobs/sync-scheduler')

    module.registerSyncSchedulerHandler()

    expect(getJobHandler('sync-scheduler')).toBe(
      module.__internal.syncSchedulerHandler
    )
  })

  it('captures and rethrows primary guild query failures', async () => {
    mockDirectClient.query.mockResolvedValue({
      data: null,
      error: 'database unavailable'
    })

    await expect(syncSchedulerHandler({}, context)).rejects.toThrow(
      'Failed to fetch guilds: database unavailable'
    )
    expect(mockCaptureSentryException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { handler: 'sync-scheduler', jobId: '1485' }
      })
    )
  })
})
