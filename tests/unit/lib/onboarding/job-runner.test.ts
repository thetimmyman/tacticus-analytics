import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { SERVICE_TIMEOUTS } from '@/app/lib/utils/async-timeout'

const { mockDecryptApiKey, mockUpdateOnboardingJobStatus, mockLogger } =
  vi.hoisted(() => ({
    mockDecryptApiKey: vi.fn(),
    mockUpdateOnboardingJobStatus: vi.fn(),
    mockLogger: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    }
  }))

vi.mock('@tacticus/app-core/encryption', () => ({
  decryptApiKey: (...args: readonly unknown[]) => mockDecryptApiKey(...args)
}))

vi.mock('@/app/lib/onboarding/jobs', () => ({
  updateOnboardingJobStatus: (...args: readonly unknown[]) =>
    mockUpdateOnboardingJobStatus(...args)
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => mockLogger
}))

import { processGuildInitialSyncJob } from '@/app/lib/onboarding/job-runner'

const originalEnv = { ...process.env }

function createServiceClient(
  invoke: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    data: { success: true, recordsInserted: 12 },
    error: null
  })
) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'guild_config') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { api_key_encrypted: 'encrypted-key' },
                error: null
              })
            })
          })
        }
      }
      return {}
    }),
    functions: { invoke }
  }
}

function createAuthedClient() {
  const progressEq = vi.fn().mockResolvedValue({ error: null })
  const progressUpdate = vi.fn().mockReturnValue({ eq: progressEq })

  return {
    client: {
      from: vi.fn((table: string) => {
        if (table === 'onboarding_progress') {
          return { update: progressUpdate }
        }
        return {}
      })
    },
    progressUpdate
  }
}

async function waitForMockCall(mock: ReturnType<typeof vi.fn>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (mock.mock.calls.length > 0) {
      return
    }
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
  }
  throw new Error('Timed out waiting for mock call')
}

async function hasSettled<T>(promise: Promise<T>): Promise<boolean> {
  let settled = false
  promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (settled) {
      return true
    }
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
  }
  return settled
}

function processJob(overrides: {
  serviceClient: ReturnType<typeof createServiceClient>
  authedClient: ReturnType<typeof createAuthedClient>['client']
  request?: NextRequest
}) {
  return processGuildInitialSyncJob({
    job: {
      id: 'job-1',
      type: 'guild_initial_sync',
      status: 'queued',
      user_id: 'user-1',
      guild_code: 'GUILD1',
      attempts: 0,
      max_attempts: 3,
      created_at: '2026-06-22T00:00:00.000Z',
      updated_at: '2026-06-22T00:00:00.000Z'
    } as never,
    authedSupabase: overrides.authedClient as never,
    serviceSupabase: overrides.serviceClient as never,
    progress: {
      user_id: 'user-1',
      guild_code: 'GUILD1',
      sync_records_synced: 0
    } as never,
    request: overrides.request
  })
}

describe('processGuildInitialSyncJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    mockDecryptApiKey.mockResolvedValue('decrypted-key')
    mockUpdateOnboardingJobStatus.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
  })

  it('times out hung Edge Function invokes and marks sync retryable', async () => {
    vi.useFakeTimers()
    const invoke = vi.fn(() => new Promise(() => {}))
    const serviceClient = createServiceClient(invoke)
    const { client: authedClient, progressUpdate } = createAuthedClient()

    const resultPromise = processJob({ serviceClient, authedClient })

    await waitForMockCall(invoke)
    await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)

    expect(await hasSettled(resultPromise)).toBe(true)
    const result = await resultPromise

    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out')
    expect(mockUpdateOnboardingJobStatus).toHaveBeenCalledWith(
      serviceClient,
      'job-1',
      'failed',
      expect.objectContaining({
        error_message: expect.stringContaining('timed out')
      })
    )
    expect(progressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_status: 'failed',
        sync_can_retry: true
      })
    )
  })

  it('times out hung legacy initial sync fetches and marks sync retryable', async () => {
    vi.useFakeTimers()
    process.env.ONBOARDING_USE_EDGE_FUNCTION = 'false'
    process.env.SITE_URL = 'https://internal.example'

    let aborted = false
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborted = true
            const abortError = new Error('Request timed out')
            abortError.name = 'AbortError'
            reject(abortError)
          },
          { once: true }
        )
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const serviceClient = createServiceClient()
    const { client: authedClient, progressUpdate } = createAuthedClient()
    const resultPromise = processJob({
      serviceClient,
      authedClient,
      request: new NextRequest(
        'https://attacker.example/api/onboarding/jobs/process',
        {
          headers: { cookie: 'session=abc' }
        }
      )
    })

    await waitForMockCall(fetchMock)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://internal.example/api/guild/initial-sync'
    )
    await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)

    expect(aborted).toBe(true)
    expect(await hasSettled(resultPromise)).toBe(true)
    const result = await resultPromise

    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out')
    expect(progressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_status: 'failed',
        sync_can_retry: true
      })
    )
  })
  // The credential is keyed on the job, never on client-writable onboarding_progress.guild_code.
  it('loads the credential for the JOB guild, never the progress guild', async () => {
    const eq = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { api_key_encrypted: 'encrypted-key' },
        error: null
      })
    })
    const serviceClient = {
      from: vi.fn((table: string) =>
        table === 'guild_config'
          ? { select: vi.fn().mockReturnValue({ eq }) }
          : {}
      ),
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: { success: true, recordsInserted: 1 },
          error: null
        })
      }
    }
    const { client: authedClient } = createAuthedClient()

    const result = await processGuildInitialSyncJob({
      job: {
        id: 'job-1',
        type: 'guild_initial_sync',
        status: 'queued',
        user_id: 'user-1',
        guild_code: 'AUTHORIZED',
        attempts: 0,
        max_attempts: 3,
        created_at: '2026-06-22T00:00:00.000Z',
        updated_at: '2026-06-22T00:00:00.000Z'
      } as never,
      authedSupabase: authedClient as never,
      serviceSupabase: serviceClient as never,
      // The poisoned value. Nothing in this function may reach for it.
      progress: {
        user_id: 'user-1',
        guild_code: 'VICTIM',
        sync_records_synced: 0
      } as never
    })

    expect(result.success).toBe(true)
    expect(eq).toHaveBeenCalledWith('guild_code', 'AUTHORIZED')
    expect(eq).not.toHaveBeenCalledWith('guild_code', 'VICTIM')
    expect(serviceClient.functions.invoke).toHaveBeenCalledWith(
      'sync-modular-workflow',
      expect.objectContaining({
        body: expect.objectContaining({ guild_code: 'AUTHORIZED' })
      })
    )
  })

  it('refuses to run a job that carries no authorized guild', async () => {
    const serviceClient = createServiceClient()
    const { client: authedClient } = createAuthedClient()

    const result = await processGuildInitialSyncJob({
      job: {
        id: 'job-1',
        type: 'guild_initial_sync',
        status: 'queued',
        user_id: 'user-1',
        guild_code: null,
        attempts: 0,
        max_attempts: 3,
        created_at: '2026-06-22T00:00:00.000Z',
        updated_at: '2026-06-22T00:00:00.000Z'
      } as never,
      authedSupabase: authedClient as never,
      serviceSupabase: serviceClient as never,
      progress: {
        user_id: 'user-1',
        guild_code: 'VICTIM',
        sync_records_synced: 0
      } as never
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Sync job carries no authorized guild')
    expect(serviceClient.from).not.toHaveBeenCalledWith('guild_config')
  })
})
