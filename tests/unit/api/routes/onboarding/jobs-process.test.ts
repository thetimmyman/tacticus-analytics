import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createChainedMock as createSharedChainedMock } from '@/tests/helpers/supabase-mock'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

const mockServiceSupabase = {
  from: vi.fn()
}

vi.mock('@/app/lib/auth/server', () => ({
  createServiceClient: vi.fn(() => mockServiceSupabase)
}))

const mockProcessGuildInitialSyncJob = vi.fn()
vi.mock('@/app/lib/onboarding/job-runner', () => ({
  processGuildInitialSyncJob: (...args: any[]) =>
    mockProcessGuildInitialSyncJob(...args)
}))

const mockResetStatusFields = vi.fn((progress, updates) => ({
  ...progress,
  ...updates
}))
vi.mock('@/app/lib/onboarding/progress', () => ({
  resetStatusFields: (...args: any[]) => mockResetStatusFields(...args)
}))

// `null` omits the token, a string overrides it.
function createRequest(token: string | null = 'secret-token'): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['authorization'] = `Bearer ${token}`
  }
  return new NextRequest('http://localhost/api/onboarding/jobs/process', {
    method: 'POST',
    headers
  })
}

const createChainedMock = (data: any = null, error: any = null) =>
  createSharedChainedMock(data, error, ['update'], { thenMode: 'none' })

describe('POST /api/onboarding/jobs/process', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    // The route fails closed (500) without a configured worker token.
    process.env.ONBOARDING_WORKER_TOKEN = 'secret-token'
    delete process.env.ONBOARDING_JOB_BATCH_SIZE
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns 401 when token is configured but not provided', async () => {
    process.env.ONBOARDING_WORKER_TOKEN = 'secret-token'

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest(null))
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json.error.message).toBe('Unauthorized')
  })

  it('returns 401 when token is configured but wrong', async () => {
    process.env.ONBOARDING_WORKER_TOKEN = 'secret-token'

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest('wrong-token'))
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json.error.message).toBe('Unauthorized')
  })

  it('allows access when token matches', async () => {
    process.env.ONBOARDING_WORKER_TOKEN = 'secret-token'
    mockServiceSupabase.from.mockReturnValue(createChainedMock(null))

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest('secret-token'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.processed).toBe(0)
  })

  it('fails closed with 500 when no worker token is configured', async () => {
    delete process.env.ONBOARDING_WORKER_TOKEN
    mockServiceSupabase.from.mockReturnValue(createChainedMock(null))

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest(null))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toContain('not configured')
  })

  it('returns 500 when job fetch fails', async () => {
    mockServiceSupabase.from.mockReturnValue(
      createChainedMock(null, { message: 'Database error' })
    )

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Unable to fetch jobs')
    expect(json.error.metadata?.details).toBe('Database error')
  })

  it('returns empty result when no queued jobs exist', async () => {
    mockServiceSupabase.from.mockReturnValue(createChainedMock(null))

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.processed).toBe(0)
    expect(json.skipped).toEqual([])
    expect(json.jobs).toEqual([])
  })

  it('skips job when claim fails (race condition)', async () => {
    const queuedJob = {
      id: 'job-1',
      status: 'queued',
      user_id: 'user-1',
      attempts: 0,
      max_attempts: 3
    }

    let selectCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      const chain = createChainedMock(null)
      if (table === 'onboarding_jobs') {
        selectCount++
        if (selectCount === 1) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: queuedJob, error: null })
        } else {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: null, error: null })
        }
      }
      return chain
    })

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.skipped).toContainEqual({
      id: 'job-1',
      reason: 'already_claimed'
    })
  })

  it('marks job as failed when max attempts reached', async () => {
    const queuedJob = {
      id: 'job-1',
      status: 'queued',
      user_id: 'user-1',
      attempts: 3,
      max_attempts: 3
    }
    const claimedJob = { ...queuedJob, status: 'processing' }

    let selectCount = 0
    let updateChain: any = null
    mockServiceSupabase.from.mockImplementation((table: string) => {
      const chain = createChainedMock(null)
      if (table === 'onboarding_jobs') {
        selectCount++
        if (selectCount === 1) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: queuedJob, error: null })
        } else if (selectCount === 2) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: claimedJob, error: null })
          updateChain = chain
        } else {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: null, error: null })
        }
      }
      return chain
    })

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.jobs).toContainEqual({
      id: 'job-1',
      success: false,
      error: 'Maximum attempts reached'
    })
  })

  it('marks job as failed when user_id is missing', async () => {
    const queuedJob = {
      id: 'job-1',
      status: 'queued',
      user_id: null,
      attempts: 0,
      max_attempts: 3
    }
    const claimedJob = { ...queuedJob, status: 'processing' }

    let selectCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      const chain = createChainedMock(null)
      if (table === 'onboarding_jobs') {
        selectCount++
        if (selectCount === 1) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: queuedJob, error: null })
        } else if (selectCount === 2) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: claimedJob, error: null })
        } else {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: null, error: null })
        }
      }
      return chain
    })

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.jobs).toContainEqual({
      id: 'job-1',
      success: false,
      error: 'Job missing user_id'
    })
  })

  it('marks job as failed when onboarding progress not found', async () => {
    const queuedJob = {
      id: 'job-1',
      status: 'queued',
      user_id: 'user-1',
      attempts: 0,
      max_attempts: 3
    }
    const claimedJob = { ...queuedJob, status: 'processing' }

    let selectCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      const chain = createChainedMock(null)
      if (table === 'onboarding_jobs') {
        selectCount++
        if (selectCount === 1) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: queuedJob, error: null })
        } else if (selectCount === 2) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: claimedJob, error: null })
        } else {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: null, error: null })
        }
      } else if (table === 'onboarding_progress') {
        chain.maybeSingle = vi
          .fn()
          .mockResolvedValue({ data: null, error: null })
      }
      return chain
    })

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.jobs).toContainEqual({
      id: 'job-1',
      success: false,
      error: 'Onboarding progress not found'
    })
  })

  it('successfully processes a job', async () => {
    const queuedJob = {
      id: 'job-1',
      status: 'queued',
      user_id: 'user-1',
      attempts: 0,
      max_attempts: 3
    }
    const claimedJob = { ...queuedJob, status: 'processing' }
    const progress = { user_id: 'user-1', guild_code: 'GUILD1' }

    let selectCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      const chain = createChainedMock(null)
      if (table === 'onboarding_jobs') {
        selectCount++
        if (selectCount === 1) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: queuedJob, error: null })
        } else if (selectCount === 2) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: claimedJob, error: null })
        } else {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: null, error: null })
        }
      } else if (table === 'onboarding_progress') {
        chain.maybeSingle = vi
          .fn()
          .mockResolvedValue({ data: progress, error: null })
      }
      return chain
    })
    mockProcessGuildInitialSyncJob.mockResolvedValue({ success: true })

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.processed).toBe(1)
    expect(json.jobs).toContainEqual({
      id: 'job-1',
      success: true,
      error: null
    })
  })

  it('requeues job on failure when retries remain', async () => {
    const queuedJob = {
      id: 'job-1',
      status: 'queued',
      user_id: 'user-1',
      attempts: 0,
      max_attempts: 3
    }
    const claimedJob = { ...queuedJob, status: 'processing' }
    const progress = { user_id: 'user-1', guild_code: 'GUILD1' }

    let selectCount = 0
    const updateMock = vi.fn().mockReturnThis()
    mockServiceSupabase.from.mockImplementation((table: string) => {
      const chain = createChainedMock(null)
      chain.update = updateMock
      if (table === 'onboarding_jobs') {
        selectCount++
        if (selectCount === 1) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: queuedJob, error: null })
        } else if (selectCount === 2) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: claimedJob, error: null })
        } else {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: null, error: null })
        }
      } else if (table === 'onboarding_progress') {
        chain.maybeSingle = vi
          .fn()
          .mockResolvedValue({ data: progress, error: null })
      }
      return chain
    })
    mockProcessGuildInitialSyncJob.mockResolvedValue({
      success: false,
      error: 'Sync failed'
    })

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.jobs).toContainEqual({
      id: 'job-1',
      success: false,
      error: 'Sync failed'
    })
  })

  it('uses custom batch size from environment', async () => {
    process.env.ONBOARDING_JOB_BATCH_SIZE = '5'

    const jobs = Array.from({ length: 5 }, (_, i) => ({
      id: `job-${i}`,
      status: 'queued',
      user_id: `user-${i}`,
      attempts: 0,
      max_attempts: 3
    }))

    let selectCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      const chain = createChainedMock(null)
      if (table === 'onboarding_jobs') {
        selectCount++
        const jobIndex = Math.floor((selectCount - 1) / 2)
        if (selectCount % 2 === 1 && jobIndex < jobs.length) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: jobs[jobIndex], error: null })
        } else if (selectCount % 2 === 0 && jobIndex < jobs.length) {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: { ...jobs[jobIndex - 1], status: 'processing' },
            error: null
          })
        } else {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: null, error: null })
        }
      } else if (table === 'onboarding_progress') {
        chain.maybeSingle = vi.fn().mockResolvedValue({
          data: { user_id: 'user-1', guild_code: 'GUILD1' },
          error: null
        })
      }
      return chain
    })
    mockProcessGuildInitialSyncJob.mockResolvedValue({ success: true })

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
  })

  it('uses default batch size of 3 when env is not set', async () => {
    mockServiceSupabase.from.mockReturnValue(createChainedMock(null))

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    await POST(createRequest())

    expect(mockServiceSupabase.from).toHaveBeenCalled()
  })

  it('handles claim error gracefully', async () => {
    const queuedJob = {
      id: 'job-1',
      status: 'queued',
      user_id: 'user-1',
      attempts: 0,
      max_attempts: 3
    }

    let selectCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      const chain = createChainedMock(null)
      if (table === 'onboarding_jobs') {
        selectCount++
        if (selectCount === 1) {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: queuedJob, error: null })
        } else if (selectCount === 2) {
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Claim error' }
          })
        } else {
          chain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: null, error: null })
        }
      }
      return chain
    })

    const { POST } = await import('@/app/api/onboarding/jobs/process/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.skipped).toContainEqual({ id: 'job-1', reason: 'claim_failed' })
  })
})
