import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

const mockGuildConfigService = {
  exists: vi.fn()
}
vi.mock('@/app/lib/services/guild-config-service', () => ({
  GuildConfigService: mockGuildConfigService
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

// createDirectClient() uses node:http, not the mocked global fetch.
const mockDirectMutate = vi.fn()
vi.mock('@/app/lib/network/direct-supabase', () => ({
  createDirectClient: () => ({
    mutate: (...args: any[]) => mockDirectMutate(...args)
  })
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

function createRequest(body: any): NextRequest {
  return new NextRequest('http://localhost/api/onboarding/cluster/add-guild', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', cookie: 'session=abc123' }
  })
}

const createChainedMock = (data: any = null, error: any = null) =>
  createSharedChainedMock(data, error, ['update'], { thenMode: 'none' })

function createListChainedMock(data: any[] = [], error: any = null) {
  const mockChain: any = {}
  mockChain.select = vi.fn().mockReturnValue(mockChain)
  mockChain.eq = vi.fn().mockReturnValue(mockChain)
  mockChain.in = vi.fn().mockReturnValue(mockChain)
  mockChain.then = vi.fn((resolve, reject) =>
    Promise.resolve({ data, error }).then(resolve, reject)
  )
  return mockChain
}

describe('POST /api/onboarding/cluster/add-guild', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } })
    mockFetch.mockReset()
    mockDirectMutate.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json.error.message).toBe('Unauthorized')
  })

  it('returns 400 when clusterCode is missing', async () => {
    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toContain('required')
  })

  it('returns 400 when guildCode is missing', async () => {
    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toContain('required')
  })

  it('returns 400 when guildName is missing', async () => {
    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toContain('required')
  })

  it('returns 400 when apiKey is missing', async () => {
    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toContain('required')
  })

  it('returns 400 when all fields are empty strings', async () => {
    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: '  ',
        guildCode: '  ',
        guildName: '  ',
        apiKey: '  '
      })
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toContain('required')
  })

  it('returns 500 when cluster lookup fails', async () => {
    mockServiceSupabase.from.mockReturnValue(
      createChainedMock(null, { message: 'Database error' })
    )

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Unable to verify cluster ownership.')
  })

  it('returns 404 when cluster is not found', async () => {
    mockServiceSupabase.from.mockReturnValue(createChainedMock(null))

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(404)
    expect(json.error.message).toBe('Cluster CLUSTER1 was not found.')
  })

  it('returns 403 when user is neither creator, app admin, nor a cluster guild leader', async () => {
    let playerMappingQuery = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: 'other-user'
        })
      }
      if (table === 'guild_config') {
        return createListChainedMock([{ guild_code: 'MEMBER_GUILD' }])
      }
      if (table === 'player_mapping') {
        playerMappingQuery += 1
        return playerMappingQuery === 1
          ? createChainedMock(null)
          : createListChainedMock([])
      }
      return createChainedMock(null)
    })

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.error.message).toBe(
      'Only the cluster creator or a guild leader within the cluster can add guilds.'
    )
  })

  it('allows a current guild leader within the cluster to add a guild', async () => {
    let playerMappingQuery = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: 'other-user'
        })
      }
      if (table === 'guild_config') {
        return createListChainedMock([{ guild_code: 'MEMBER_GUILD' }])
      }
      if (table === 'player_mapping') {
        playerMappingQuery += 1
        return playerMappingQuery === 1
          ? createChainedMock(null)
          : createListChainedMock([{ guild_code: 'MEMBER_GUILD' }])
      }
      return createChainedMock(null)
    })
    mockGuildConfigService.exists.mockResolvedValue(false)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    })
    mockGetOrCreateOnboardingProgress.mockResolvedValue({
      user_id: mockUser.id
    })
    mockEnqueueOnboardingJob.mockResolvedValue({
      job: { id: 'leader-job', status: 'queued' },
      error: null
    })
    mockSupabase.from.mockReturnValue(createChainedMock())

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it('returns 409 when guild already exists', async () => {
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      return createChainedMock(null)
    })
    mockGuildConfigService.exists.mockResolvedValue(true)

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error.message).toBe('Guild GUILD1 already exists in analytics.')
  })

  it('returns 409 without side effects when same-cluster guild is already complete', async () => {
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
          display_name: 'Test Guild',
          cluster_code: 'CLUSTER1',
          onboarding_completed: true
        })
      }
      return createChainedMock(null)
    })
    mockGuildConfigService.exists.mockResolvedValue(true)

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error.message).toBe('Guild GUILD1 already exists in analytics.')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnqueueOnboardingJob).not.toHaveBeenCalled()
    expect(mockGetOrCreateOnboardingProgress).not.toHaveBeenCalled()
  })

  it('returns error when create-config API fails', async () => {
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      return createChainedMock(null)
    })
    mockGuildConfigService.exists.mockResolvedValue(false)
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: 'Invalid API key',
          details: 'API key validation failed'
        })
    })

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'invalid-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toBe('API key validation failed')
  })

  it('returns 500 when onboarding progress cannot be loaded', async () => {
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      return createChainedMock(null)
    })
    mockGuildConfigService.exists.mockResolvedValue(false)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    })
    mockGetOrCreateOnboardingProgress.mockResolvedValue(null)

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe(
      'Unable to load onboarding progress for cluster owner.'
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
      return createChainedMock(null)
    })
    mockGuildConfigService.exists.mockResolvedValue(false)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    })
    mockGetOrCreateOnboardingProgress.mockResolvedValue({
      user_id: mockUser.id
    })
    mockEnqueueOnboardingJob.mockResolvedValue({
      job: null,
      error: 'Queue unavailable'
    })

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Queue unavailable')
  })

  it('retries queue repair when create-config already added the guild to the cluster', async () => {
    const mockProgress = { user_id: mockUser.id }
    const repairedJob = { id: 'job-2', status: 'queued' }

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
          display_name: 'Test Guild',
          cluster_code: 'CLUSTER1',
          onboarding_completed: false
        })
      }
      return createChainedMock(null)
    })
    mockGuildConfigService.exists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    })
    mockGetOrCreateOnboardingProgress.mockResolvedValue(mockProgress)
    mockEnqueueOnboardingJob
      .mockResolvedValueOnce({ job: null, error: 'Queue unavailable' })
      .mockResolvedValueOnce({ job: repairedJob, error: null })
    mockSupabase.from.mockReturnValue(createChainedMock())

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const requestBody = {
      clusterCode: 'CLUSTER1',
      guildCode: 'GUILD1',
      guildName: 'Test Guild',
      apiKey: 'test-api-key'
    }

    const firstResponse = await POST(createRequest(requestBody))
    expect(firstResponse.status).toBe(500)

    const retryResponse = await POST(createRequest(requestBody))
    const retryJson = await retryResponse.json()

    expect(retryResponse.status).toBe(200)
    expect(retryJson.success).toBe(true)
    expect(retryJson.job).toEqual(repairedJob)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockEnqueueOnboardingJob).toHaveBeenCalledTimes(2)
  })

  it('successfully adds guild to cluster', async () => {
    const mockJob = { id: 'job-123', status: 'queued' }
    const mockProgress = { user_id: mockUser.id }

    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      return createChainedMock(null)
    })
    mockGuildConfigService.exists.mockResolvedValue(false)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    })
    mockGetOrCreateOnboardingProgress.mockResolvedValue(mockProgress)
    mockEnqueueOnboardingJob.mockResolvedValue({ job: mockJob, error: null })
    mockSupabase.from.mockReturnValue(createChainedMock())

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'cluster1',
        guildCode: 'guild1',
        guildName: '  Test Guild  ',
        apiKey: '  test-api-key  '
      })
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.job).toEqual(mockJob)
    expect(json.guild).toEqual({
      guild_code: 'GUILD1',
      display_name: 'Test Guild',
      claimed: false
    })
  })

  it('keys all post-create work on the guild_code committed by create-config (identity-first claim)', async () => {
    // create-config can ADOPT an existing row's guild_code; later steps must use the committed code.
    const mockJob = { id: 'job-claimed', status: 'queued' }

    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      return createChainedMock(null)
    })
    mockGuildConfigService.exists.mockResolvedValue(false)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { guild_code: 'REALCO', claimed: true }
        })
    })
    mockGetOrCreateOnboardingProgress.mockResolvedValue({
      user_id: mockUser.id
    })
    mockEnqueueOnboardingJob.mockResolvedValue({ job: mockJob, error: null })
    mockSupabase.from.mockReturnValue(createChainedMock())

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'TYPED1',
        guildName: 'Typed Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(200)

    const createConfigBody = JSON.parse(
      mockFetch.mock.calls[0]?.[1]?.body as string
    )
    expect(createConfigBody.guild_code).toBe('TYPED1')

    expect(mockEnqueueOnboardingJob).toHaveBeenCalledWith(
      expect.anything(),
      'guild_initial_sync',
      expect.objectContaining({ guildCode: 'REALCO' })
    )

    expect(mockDirectMutate).toHaveBeenCalledWith(
      'work_queue',
      'POST',
      expect.objectContaining({
        job_type: 'guild_historical_backfill',
        payload: expect.objectContaining({ guild_code: 'REALCO' }),
        dedupe_key: 'guild_historical_backfill:REALCO:onboarding'
      }),
      expect.anything()
    )

    expect(json.guild).toEqual({
      guild_code: 'REALCO',
      display_name: 'Typed Guild',
      claimed: true
    })
  })

  it('calls create-config API with correct parameters', async () => {
    const previousSiteUrl = process.env.SITE_URL
    process.env.SITE_URL = 'https://internal.example'
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock({
          id: 'c1',
          cluster_code: 'CLUSTER1',
          created_by: mockUser.id
        })
      }
      return createChainedMock(null)
    })
    mockGuildConfigService.exists.mockResolvedValue(false)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    })
    mockGetOrCreateOnboardingProgress.mockResolvedValue({
      user_id: mockUser.id
    })
    mockEnqueueOnboardingJob.mockResolvedValue({ id: 'job-1' })
    mockSupabase.from.mockReturnValue(createChainedMock())

    try {
      const { POST } =
        await import('@/app/api/onboarding/cluster/add-guild/route')
      await POST(
        new NextRequest(
          'https://attacker.example/api/onboarding/cluster/add-guild',
          {
            method: 'POST',
            body: JSON.stringify({
              clusterCode: 'CLUSTER1',
              guildCode: 'GUILD1',
              guildName: 'Test Guild',
              apiKey: 'test-api-key'
            }),
            headers: {
              'Content-Type': 'application/json',
              cookie: 'session=abc123'
            }
          }
        )
      )

      const [fetchUrl, fetchInit] = mockFetch.mock.calls[0] ?? []
      expect(String(fetchUrl)).toBe(
        'https://internal.example/api/guild/create-config'
      )
      expect(fetchInit).toEqual(
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({
            guild_code: 'GUILD1',
            display_name: 'Test Guild',
            api_key: 'test-api-key',
            cluster_code: 'CLUSTER1'
          })
        })
      )
    } finally {
      if (previousSiteUrl === undefined) {
        delete process.env.SITE_URL
      } else {
        process.env.SITE_URL = previousSiteUrl
      }
    }
  })

  it('handles hung create-config registration as timeout failure', async () => {
    vi.useFakeTimers()
    const { CREATE_CONFIG_TIMEOUT_MS } =
      await import('@/app/api/onboarding/_lib/create-config-fetch')
    let aborted = false
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
    mockGuildConfigService.exists.mockResolvedValue(false)
    mockFetch.mockImplementation(
      (_url: URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true }
          )
        })
    )

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const responsePromise = POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    responsePromise.catch(() => undefined)

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(CREATE_CONFIG_TIMEOUT_MS)

    expect(aborted).toBe(true)
    const response = await responsePromise
    const json = await response.json()
    expect(response.status).toBe(504)
    expect(json.error.message).toContain('timed out')
  })

  it('handles hung create-config response body as timeout failure', async () => {
    vi.useFakeTimers()
    const { CREATE_CONFIG_TIMEOUT_MS } =
      await import('@/app/api/onboarding/_lib/create-config-fetch')
    let aborted = false
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
    mockGuildConfigService.exists.mockResolvedValue(false)
    mockFetch.mockImplementation((_url: URL, init?: RequestInit) => {
      init?.signal?.addEventListener(
        'abort',
        () => {
          aborted = true
        },
        { once: true }
      )
      return Promise.resolve({
        ok: true,
        json: () => new Promise(() => {})
      } as Response)
    })

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const responsePromise = POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    responsePromise.catch(() => undefined)

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(CREATE_CONFIG_TIMEOUT_MS)

    expect(aborted).toBe(true)
    const response = await responsePromise
    const json = await response.json()
    expect(response.status).toBe(504)
    expect(json.error.message).toContain('timed out')
  })

  it('updates onboarding progress after successful add', async () => {
    const mockProgress = { user_id: mockUser.id, sync_status: 'complete' }

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
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    })
    mockGetOrCreateOnboardingProgress.mockResolvedValue(mockProgress)
    mockEnqueueOnboardingJob.mockResolvedValue({
      job: { id: 'job-1' },
      error: null
    })
    mockSupabase.from.mockReturnValue(createChainedMock())

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )

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
      throw new Error('Unexpected failure')
    })

    const { POST } =
      await import('@/app/api/onboarding/cluster/add-guild/route')
    const response = await POST(
      createRequest({
        clusterCode: 'CLUSTER1',
        guildCode: 'GUILD1',
        guildName: 'Test Guild',
        apiKey: 'test-api-key'
      })
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Unexpected failure')
  })
})
