import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

vi.mock('@/app/lib/monitoring/sentry', () => ({
  captureSentryException: vi.fn()
}))

import { failSyncJob } from '@/app/lib/sync/sync-job-lifecycle'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import type {
  ServiceSupabaseClient,
  SyncJob,
  WorkerResult
} from '@/app/lib/sync/worker-types'

const GUILD = 'SYNTH01'
const JOB_ID = '00000000-0000-4000-8000-0000000000a1'
const WORKER = 'synthetic-worker-l0'

function job(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    id: JOB_ID,
    guild_code: GUILD,
    job_type: 'realtime_sync',
    claimStartedAt: '2026-10-27T12:00:00.123456+00:00',
    claimAttempts: 1,
    claimMaxAttempts: 3,
    ...overrides
  }
}

function result(): WorkerResult {
  return {
    jobId: JOB_ID,
    success: false,
    recordsProcessed: 0,
    playersUpdated: 0,
    errors: [],
    upsertFailures: 0,
    duration: 0
  }
}

function failJobOnlyClient() {
  return {
    rpc: vi.fn(async () => ({ data: true, error: null, status: 200 }))
  } as unknown as ServiceSupabaseClient
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('failSyncJob transient upstream classification', () => {
  it.each<[string, Error]>([
    [
      'circuit breaker trip',
      new Error('Circuit breaker is OPEN — too many recent failures')
    ],
    [
      '5xx upstream response',
      Object.assign(new Error('API returned 500'), { statusCode: 500 })
    ],
    [
      '429 throttled response',
      Object.assign(new Error('API returned 429'), { statusCode: 429 })
    ],
    [
      '502 gateway response',
      Object.assign(new Error('API returned 502'), { statusCode: 502 })
    ]
  ])(
    'suppresses Sentry and retries quietly for a %s',
    async (_label, error) => {
      const client = failJobOnlyClient()
      await failSyncJob(error, job(), client, WORKER, result())

      expect(captureSentryException).not.toHaveBeenCalled()
      expect(client.rpc).toHaveBeenCalledWith(
        'fail_job',
        expect.objectContaining({ p_job_id: JOB_ID, p_worker_id: WORKER })
      )
    }
  )

  it('still captures Sentry for a non-transient error on an early attempt', async () => {
    const client = failJobOnlyClient()
    await failSyncJob(
      new Error('duplicate key value violates unique constraint'),
      job(),
      client,
      WORKER,
      result()
    )

    expect(captureSentryException).toHaveBeenCalledTimes(1)
  })

  it('still captures Sentry when a transient error exhausts its retry budget', async () => {
    const client = failJobOnlyClient()
    await failSyncJob(
      new Error('Circuit breaker is OPEN — too many recent failures'),
      job({ claimAttempts: 3, claimMaxAttempts: 3 }),
      client,
      WORKER,
      result()
    )

    expect(captureSentryException).toHaveBeenCalledTimes(1)
  })
})
