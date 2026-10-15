import { afterEach, expect, it, vi } from 'vitest'
import { ProviderAdmissionError } from '@/supabase/functions/_shared/provider-admission'
import { failSyncJob } from '@/app/lib/sync/sync-job-lifecycle'
import type {
  ServiceSupabaseClient,
  WorkerResult
} from '@/app/lib/sync/worker-types'

afterEach(() => vi.useRealTimers())

it('returns the existing sync claim without a failed-job or credential strike, retaining a huge hold', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  const writes: Record<string, unknown>[] = []
  const tables: string[] = []
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(async () => ({ data: { attempts: 3 }, error: null })),
    update: vi.fn((patch: Record<string, unknown>) => {
      writes.push(patch)
      return chain
    }),
    then: (resolve: (value: unknown) => void) => resolve({ error: null })
  }
  const rpc = vi.fn()
  const database = {
    from: (table: string) => {
      tables.push(table)
      return chain
    },
    rpc
  } as unknown as ServiceSupabaseClient
  const job = {
    id: '00000000-0000-4000-8000-000000000001',
    guild_code: 'synthetic',
    job_type: 'full_sync' as const
  }
  const result: WorkerResult = {
    jobId: job.id,
    success: false,
    recordsProcessed: 0,
    playersUpdated: 0,
    errors: [],
    upsertFailures: 0,
    duration: 0
  }
  await failSyncJob(
    new ProviderAdmissionError(1e100),
    job,
    database,
    'synthetic-worker',
    result
  )
  expect(rpc).not.toHaveBeenCalled()
  expect(tables).toEqual(['sync_queue', 'sync_queue'])
  expect(writes).toEqual([
    expect.objectContaining({
      status: 'pending',
      worker_id: null,
      attempts: 2,
      scheduled_for: '2026-01-01T00:05:00.000Z',
      progress: expect.objectContaining({
        reason: 'provider_admission',
        provider_retry_after_seconds: 1e100
      })
    })
  ])
  expect(result.success).toBe(false)
})
