import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createChainedMock as createSharedChainedMock } from '@/tests/helpers/supabase-mock'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

const mockUser = { id: 'user-123', email: 'test@example.com' }
const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn()
}
const mockServiceSupabase = {
  from: vi.fn()
}

vi.mock('@/app/lib/auth/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
  createServiceClient: vi.fn(() => mockServiceSupabase)
}))

const mockEnqueueOnboardingJob = vi.fn()
vi.mock('@/app/lib/onboarding/jobs', () => ({
  enqueueOnboardingJob: (...args: any[]) => mockEnqueueOnboardingJob(...args)
}))

const mockGetOrCreateOnboardingProgress = vi.fn()
const mockResetStatusFields = vi.fn((progress, updates) => ({
  ...progress,
  ...updates
}))
vi.mock('@/app/lib/onboarding/progress', () => ({
  getOrCreateOnboardingProgress: (...args: any[]) =>
    mockGetOrCreateOnboardingProgress(...args),
  resetStatusFields: (...args: any[]) => mockResetStatusFields(...args)
}))

function createRequest(body: any): NextRequest {
  return new NextRequest(
    'http://localhost/api/onboarding/cluster/requeue-guild',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' }
    }
  )
}

const createChainedMock = (data: any = null, error: any = null) =>
  createSharedChainedMock(data, error, ['update'], { thenMode: 'none' })

describe('POST /api/onboarding/cluster/requeue-guild', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } })
  })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(
      createRequest({ clusterCode: 'CLUSTER1', guildCode: 'GUILD1' })
    )
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json.error.message).toBe('Unauthorized')
  })

  it('returns 400 when clusterCode is missing', async () => {
    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(createRequest({ guildCode: 'GUILD1' }))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toBe('Cluster code and guild code are required.')
  })

  it('returns 400 when guildCode is missing', async () => {
    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(createRequest({ clusterCode: 'CLUSTER1' }))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toBe('Cluster code and guild code are required.')
  })

  it('returns 400 when both codes are empty strings', async () => {
    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(
      createRequest({ clusterCode: '  ', guildCode: '  ' })
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toBe('Cluster code and guild code are required.')
  })

  it('normalizes cluster and guild codes to uppercase', async () => {
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      if (table === 'guild_config') {
        return createChainedMock({
          guild_code: 'GUILD1',
          cluster_code: 'CLUSTER1',
          enabled: true
        })
      }
      return createChainedMock(null)
    })
    mockEnqueueOnboardingJob.mockResolvedValue({ job: { id: 'job-1' } })
    mockGetOrCreateOnboardingProgress.mockResolvedValue({
      user_id: mockUser.id
    })
    mockSupabase.from.mockReturnValue(createChainedMock())

    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    await POST(
      createRequest({ clusterCode: '  cluster1  ', guildCode: '  guild1  ' })
    )

    expect(mockServiceSupabase.from).toHaveBeenCalledWith('clusters')
  })

  it('returns 500 when cluster lookup fails', async () => {
    mockServiceSupabase.from.mockReturnValue(
      createChainedMock(null, { message: 'Database error' })
    )

    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(
      createRequest({ clusterCode: 'CLUSTER1', guildCode: 'GUILD1' })
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Unable to verify cluster ownership.')
    expect(json.error.metadata?.details).toBe('Database error')
  })

  it('returns 404 when cluster is not found', async () => {
    mockServiceSupabase.from.mockReturnValue(createChainedMock(null))

    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(
      createRequest({ clusterCode: 'CLUSTER1', guildCode: 'GUILD1' })
    )
    const json = await response.json()

    expect(response.status).toBe(404)
    expect(json.error.message).toBe('Cluster CLUSTER1 was not found.')
  })

  it('returns 403 when user is not the cluster owner', async () => {
    mockServiceSupabase.from.mockReturnValue(
      createChainedMock({
        id: 'c1',
        cluster_code: 'CLUSTER1',
        created_by: 'other-user-id'
      })
    )

    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(
      createRequest({ clusterCode: 'CLUSTER1', guildCode: 'GUILD1' })
    )
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.error.message).toBe(
      'Only the cluster owner can requeue guild syncs.'
    )
  })

  it('returns 500 when guild lookup fails', async () => {
    let callCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      if (table === 'guild_config') {
        return createChainedMock(null, { message: 'Guild DB error' })
      }
      return createChainedMock(null)
    })

    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(
      createRequest({ clusterCode: 'CLUSTER1', guildCode: 'GUILD1' })
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Unable to verify guild record.')
  })

  it('returns 404 when guild is not found', async () => {
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      if (table === 'guild_config') {
        return createChainedMock(null)
      }
      return createChainedMock(null)
    })

    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(
      createRequest({ clusterCode: 'CLUSTER1', guildCode: 'GUILD1' })
    )
    const json = await response.json()

    expect(response.status).toBe(404)
    expect(json.error.message).toBe('Guild GUILD1 is not registered.')
  })

  it('returns 400 when guild is not linked to the cluster', async () => {
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      if (table === 'guild_config') {
        return createChainedMock({
          guild_code: 'GUILD1',
          cluster_code: 'OTHER_CLUSTER',
          enabled: true
        })
      }
      return createChainedMock(null)
    })

    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(
      createRequest({ clusterCode: 'CLUSTER1', guildCode: 'GUILD1' })
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toBe(
      'Guild GUILD1 is not linked to cluster CLUSTER1.'
    )
  })

  it('returns 500 when job queue fails', async () => {
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      if (table === 'guild_config') {
        return createChainedMock({
          guild_code: 'GUILD1',
          cluster_code: 'CLUSTER1',
          enabled: true
        })
      }
      return createChainedMock(null)
    })
    mockEnqueueOnboardingJob.mockResolvedValue({
      job: null,
      error: 'Queue unavailable'
    })

    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(
      createRequest({ clusterCode: 'CLUSTER1', guildCode: 'GUILD1' })
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Queue unavailable')
  })

  it('successfully requeues guild sync job', async () => {
    const mockJob = { id: 'job-123', status: 'queued' }
    const mockProgress = { user_id: mockUser.id, sync_status: 'failed' }

    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      if (table === 'guild_config') {
        return createChainedMock({
          guild_code: 'GUILD1',
          cluster_code: 'CLUSTER1',
          enabled: true
        })
      }
      return createChainedMock(null)
    })
    mockEnqueueOnboardingJob.mockResolvedValue({ job: mockJob, error: null })
    mockGetOrCreateOnboardingProgress.mockResolvedValue(mockProgress)
    mockSupabase.from.mockReturnValue(createChainedMock())

    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(
      createRequest({ clusterCode: 'CLUSTER1', guildCode: 'GUILD1' })
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.job).toEqual(mockJob)
    expect(mockEnqueueOnboardingJob).toHaveBeenCalledWith(
      mockServiceSupabase,
      'guild_initial_sync',
      expect.objectContaining({
        userId: mockUser.id,
        guildCode: 'GUILD1',
        clusterCode: 'CLUSTER1'
      })
    )
  })

  it('updates onboarding progress after successful requeue', async () => {
    const mockJob = { id: 'job-123', status: 'queued' }
    const mockProgress = { user_id: mockUser.id, sync_status: 'failed' }

    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      if (table === 'guild_config') {
        return createChainedMock({
          guild_code: 'GUILD1',
          cluster_code: 'CLUSTER1',
          enabled: true
        })
      }
      return createChainedMock(null)
    })
    mockEnqueueOnboardingJob.mockResolvedValue({ job: mockJob })
    mockGetOrCreateOnboardingProgress.mockResolvedValue(mockProgress)

    const mockUpdateChain = createChainedMock()
    mockSupabase.from.mockReturnValue(mockUpdateChain)

    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    await POST(createRequest({ clusterCode: 'CLUSTER1', guildCode: 'GUILD1' }))

    expect(mockResetStatusFields).toHaveBeenCalledWith(
      mockProgress,
      expect.objectContaining({
        sync_status: 'pending',
        sync_error_message: null,
        sync_can_retry: true
      })
    )
  })

  it('handles unexpected errors gracefully', async () => {
    mockServiceSupabase.from.mockImplementation(() => {
      throw new Error('Unexpected database failure')
    })

    const { POST } =
      await import('@/app/api/onboarding/cluster/requeue-guild/route')
    const response = await POST(
      createRequest({ clusterCode: 'CLUSTER1', guildCode: 'GUILD1' })
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Unexpected database failure')
  })
})
