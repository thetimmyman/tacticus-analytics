import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { createChainedMock as createSharedChainedMock } from '@/tests/helpers/supabase-mock'

/**
 * onboarding_progress.guild_code is browser-writable, so it is never authority; every case sets it
 * to VICTIM so a regression that reads it shows VICTIM where the derived code belongs.
 */

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-123')
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

const mockUser = { id: 'user-123', email: 'test@example.com' }
const VICTIM = 'VICTIM'
const OWNED = 'OWNED1'
const OWNED_GUILD_ID = 'guild-uuid-owned'

const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn()
}

let serviceQueues: Record<string, Array<{ data: unknown; error: unknown }>>

function serviceChain(table: string) {
  const next = () =>
    serviceQueues[table]?.shift() ?? { data: null, error: null }
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'insert']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => next())
  chain.single = vi.fn(async () => next())
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(next()).then(resolve)
  return chain
}

const mockServiceSupabase = {
  from: vi.fn((table: string) => serviceChain(table))
}

vi.mock('@/app/lib/auth/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
  createServiceClient: vi.fn(() => mockServiceSupabase)
}))

const mockGetGuild = vi.fn()
vi.mock('@/app/lib/api/tacticus-client', () => ({
  // With the real client mocked, getState() returns null (healthy) unless spied.
  TACTICUS_CIRCUIT_NAME: 'tacticus-api',
  tacticusAPI: {
    getGuild: (...args: any[]) => mockGetGuild(...args),
    getPlayer: vi.fn()
  }
}))

const mockDecryptApiKey = vi.fn(async (stored: string) =>
  stored.replace(/^enc:/, '')
)
vi.mock('@tacticus/app-core/encryption', () => ({
  decryptApiKey: (...args: any[]) => mockDecryptApiKey(...args)
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

const mockEnqueueOnboardingJob = vi.fn()
const mockFetchOnboardingJobById = vi.fn()
vi.mock('@/app/lib/onboarding/jobs', () => ({
  enqueueOnboardingJob: (...args: any[]) => mockEnqueueOnboardingJob(...args),
  fetchOnboardingJobById: (...args: any[]) =>
    mockFetchOnboardingJobById(...args)
}))

const mockProcessGuildInitialSyncJob = vi.fn()
vi.mock('@/app/lib/onboarding/job-runner', () => ({
  processGuildInitialSyncJob: (...args: any[]) =>
    mockProcessGuildInitialSyncJob(...args)
}))

function createRequest(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/onboarding/data-sync/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
}

const createChainedMock = (data: any = null, error: any = null) =>
  createSharedChainedMock(data, error, ['update'], { thenMode: 'none' })

function poisonedProgress(overrides: Record<string, unknown> = {}) {
  return {
    user_id: mockUser.id,
    sync_status: 'pending',
    guild_status: 'complete',
    guild_code: VICTIM,
    ...overrides
  }
}

function arrangeKeyResolvesToOwned() {
  mockGetGuild.mockResolvedValue({ guildId: OWNED_GUILD_ID, members: [] })
  serviceQueues.guild_config = [
    { data: { guild_code: OWNED }, error: null },
    ...(serviceQueues.guild_config ?? [])
  ]
}

function arrangeStoredCredential(plaintext: string | null) {
  serviceQueues.guild_config = [
    ...(serviceQueues.guild_config ?? []),
    {
      data: {
        api_key_encrypted: plaintext === null ? null : `enc:${plaintext}`
      },
      error: null
    }
  ]
}

/** A key proves WHICH guild, never that its holder leads it, so a sync also needs an elevation witness. */
function arrangeKeyProvesOwnedGuild() {
  arrangeKeyResolvesToOwned()
  serviceQueues.player_mapping = [{ data: [{ role: 'leader' }], error: null }]
}

function arrangeRosterSeat(rows: Array<Record<string, unknown>>) {
  serviceQueues.player_mapping = [{ data: rows, error: null }]
}

describe('POST /api/onboarding/data-sync/start', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    serviceQueues = {}
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } })
    mockSupabase.from.mockReturnValue(createChainedMock())
    process.env = { ...originalEnv }
    delete process.env.ONBOARDING_PROCESS_JOBS_INLINE
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json.error.message).toBe('Unauthorized')
  })

  it('returns 500 when progress cannot be loaded', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(null)

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Unable to load onboarding progress')
  })

  it('returns success message when sync is not required', async () => {
    const progress = poisonedProgress({ sync_status: 'not_required' })
    mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.progress).toEqual(progress)
    expect(json.message).toBe(
      'Sync not required for existing guild onboarding path'
    )
  })

  it('REFUSES a sync when the only thing naming a guild is the client-writable row', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeRosterSeat([])

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({}))
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('GUILD_ATTESTATION_REQUIRED')
    expect(mockEnqueueOnboardingJob).not.toHaveBeenCalled()
    expect(mockProcessGuildInitialSyncJob).not.toHaveBeenCalled()
  })

  it('REFUSES the foreign guild_code and syncs the guild the KEY names instead', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeKeyProvesOwnedGuild()
    mockEnqueueOnboardingJob.mockResolvedValue({
      job: { id: 'job-123', status: 'queued' },
      error: null
    })
    mockProcessGuildInitialSyncJob.mockResolvedValue({ success: true })
    mockFetchOnboardingJobById.mockResolvedValue({ id: 'job-123' })

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-owned' }))

    expect(response.status).toBe(200)
    expect(mockGetGuild).toHaveBeenCalledWith('sk-owned')
    expect(mockEnqueueOnboardingJob).toHaveBeenCalledWith(
      mockServiceSupabase,
      'guild_initial_sync',
      expect.objectContaining({ guildCode: OWNED })
    )
    expect(JSON.stringify(mockEnqueueOnboardingJob.mock.calls)).not.toContain(
      VICTIM
    )
  })

  it('accepts a current leader seat as authority and still ignores the row', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeRosterSeat([{ guild_code: OWNED, role: 'leader' }])
    mockEnqueueOnboardingJob.mockResolvedValue({
      job: { id: 'job-123', status: 'queued' },
      error: null
    })
    mockProcessGuildInitialSyncJob.mockResolvedValue({ success: true })
    mockFetchOnboardingJobById.mockResolvedValue({ id: 'job-123' })

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({}))

    expect(response.status).toBe(200)
    expect(mockGetGuild).not.toHaveBeenCalled()
    expect(mockEnqueueOnboardingJob).toHaveBeenCalledWith(
      mockServiceSupabase,
      'guild_initial_sync',
      expect.objectContaining({ guildCode: OWNED })
    )
  })

  it('REFUSES a plain member seat — a member may not spend the guild credential', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeRosterSeat([{ guild_code: OWNED, role: 'member' }])

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({}))
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('GUILD_ATTESTATION_REQUIRED')
    expect(mockEnqueueOnboardingJob).not.toHaveBeenCalled()
  })

  it('REFUSES rather than guesses when the caller holds elevated seats in two guilds', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeRosterSeat([
      { guild_code: OWNED, role: 'leader' },
      { guild_code: 'OTHER1', role: 'officer' }
    ])

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({}))
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('GUILD_ATTESTATION_REQUIRED')
    expect(mockEnqueueOnboardingJob).not.toHaveBeenCalled()
  })

  it('REFUSES a member holding a valid guild key, before touching the credential', async () => {
    // A member's valid key is not standing to spend the guild's stored key.
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeKeyResolvesToOwned()
    serviceQueues.player_mapping = [{ data: [{ role: 'member' }], error: null }]
    arrangeStoredCredential('sk-the-guilds-own-key')

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-members-own-key' }))
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.error.code).toBe('GUILD_ELEVATION_REQUIRED')
    expect(mockEnqueueOnboardingJob).not.toHaveBeenCalled()
    expect(mockProcessGuildInitialSyncJob).not.toHaveBeenCalled()
    expect(mockResetStatusFields).not.toHaveBeenCalled()
  })

  it('ALLOWS a freshly registered leader with no seat, on the key registration stored', async () => {
    // Deadlock guard: the registrar has no seat yet (this sync fills the roster).
    const job = { id: 'job-123', status: 'queued' }
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeKeyResolvesToOwned()
    serviceQueues.player_mapping = [{ data: [], error: null }]
    arrangeStoredCredential('sk-registrar-key')
    mockEnqueueOnboardingJob.mockResolvedValue({ job, error: null })
    mockProcessGuildInitialSyncJob.mockResolvedValue({ success: true })
    mockFetchOnboardingJobById.mockResolvedValue(job)

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-registrar-key' }))

    expect(response.status).toBe(200)
    expect(mockEnqueueOnboardingJob).toHaveBeenCalledWith(
      mockServiceSupabase,
      'guild_initial_sync',
      expect.objectContaining({
        guildCode: OWNED,
        payload: expect.objectContaining({
          authoritySource: 'api_key',
          authorityElevation: 'registered_credential'
        })
      })
    )
  })

  it('REFUSES a key whose upstream guild is not registered here', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    mockGetGuild.mockResolvedValue({ guildId: 'guild-uuid-unknown' })
    serviceQueues.guild_config = [{ data: null, error: null }]

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-unknown' }))
    const json = await response.json()

    expect(response.status).toBe(404)
    expect(json.error.code).toBe('GUILD_NOT_REGISTERED')
    expect(mockEnqueueOnboardingJob).not.toHaveBeenCalled()
  })

  it('blames the key, not Tacticus, when the upstream is healthy', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    mockGetGuild.mockResolvedValue(null)

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-no-scope' }))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.code).toBe('GUILD_SCOPE_REQUIRED')
  })

  it('blames Tacticus, not the key, when the circuit is open', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    mockGetGuild.mockResolvedValue(null)
    const { circuitRegistry } = await import('@/app/lib/resilience')
    vi.spyOn(circuitRegistry, 'getState').mockReturnValue('OPEN')

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-any' }))
    const json = await response.json()

    expect(response.status).toBe(503)
    expect(json.error.code).toBe('TACTICUS_UNAVAILABLE')
    vi.restoreAllMocks()
  })

  it('uses fallback mode when job queue fails', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeKeyProvesOwnedGuild()
    mockEnqueueOnboardingJob.mockResolvedValue({
      job: null,
      error: 'Queue unavailable'
    })
    mockProcessGuildInitialSyncJob.mockResolvedValue({ success: true })

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-owned' }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.fallback).toBe(true)
    expect(json.message).toBe(
      'Initial sync completed successfully (fallback mode).'
    )
  })

  it('gives the fallback job the DERIVED guild code, not the row-supplied one', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeKeyProvesOwnedGuild()
    mockEnqueueOnboardingJob.mockResolvedValue({
      job: null,
      error: 'Queue unavailable'
    })
    mockProcessGuildInitialSyncJob.mockResolvedValue({ success: true })

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-owned' }))
    const json = await response.json()

    expect(json.job.guild_code).toBe(OWNED)
    expect(mockProcessGuildInitialSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({ guild_code: OWNED })
      })
    )
  })

  it('returns 500 when fallback sync fails', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeKeyProvesOwnedGuild()
    mockEnqueueOnboardingJob.mockResolvedValue({
      job: null,
      error: 'Queue unavailable'
    })
    mockProcessGuildInitialSyncJob.mockResolvedValue({
      success: false,
      error: 'Fallback sync failed'
    })

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-owned' }))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Fallback sync failed')
    expect(json.error.metadata?.queueError).toBe('Queue unavailable')
  })

  it('returns 202 when job is queued but inline processing is disabled', async () => {
    process.env.ONBOARDING_PROCESS_JOBS_INLINE = 'false'
    const job = { id: 'job-123', status: 'queued' }

    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeKeyProvesOwnedGuild()
    mockEnqueueOnboardingJob.mockResolvedValue({ job, error: null })

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-owned' }))
    const json = await response.json()

    expect(response.status).toBe(202)
    expect(json.queued).toBe(true)
    expect(json.job).toEqual(job)
    expect(json.message).toBe('Sync job queued. It will be processed shortly.')
  })

  it('processes job inline when enabled (default)', async () => {
    const progress = poisonedProgress()
    const job = { id: 'job-123', status: 'queued' }
    const refreshedJob = { id: 'job-123', status: 'complete' }
    const updatedProgress = { ...progress, sync_status: 'complete' }

    mockGetOrCreateOnboardingProgress
      .mockResolvedValueOnce(progress)
      .mockResolvedValueOnce(updatedProgress)
    arrangeKeyProvesOwnedGuild()
    mockEnqueueOnboardingJob.mockResolvedValue({ job, error: null })
    mockProcessGuildInitialSyncJob.mockResolvedValue({ success: true })
    mockFetchOnboardingJobById.mockResolvedValue(refreshedJob)

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-owned' }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.progress).toEqual(updatedProgress)
    expect(json.job).toEqual(refreshedJob)
    expect(json.message).toBe('Initial sync completed successfully.')
  })

  it('returns 500 when inline processing fails', async () => {
    const job = { id: 'job-123', status: 'queued' }
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeKeyProvesOwnedGuild()
    mockEnqueueOnboardingJob.mockResolvedValue({ job, error: null })
    mockProcessGuildInitialSyncJob.mockResolvedValue({
      success: false,
      error: 'Sync job failed'
    })

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-owned' }))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Sync job failed')
  })

  it('returns original job when refresh fails', async () => {
    const job = { id: 'job-123', status: 'queued' }
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeKeyProvesOwnedGuild()
    mockEnqueueOnboardingJob.mockResolvedValue({ job, error: null })
    mockProcessGuildInitialSyncJob.mockResolvedValue({ success: true })
    mockFetchOnboardingJobById.mockResolvedValue(null)

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest({ apiKey: 'sk-owned' }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.job).toEqual(job)
  })

  it('writes the DERIVED guild code back over the poisoned row', async () => {
    const progress = poisonedProgress()
    const job = { id: 'job-123', status: 'queued' }

    mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)
    arrangeKeyProvesOwnedGuild()
    mockEnqueueOnboardingJob.mockResolvedValue({ job, error: null })
    mockProcessGuildInitialSyncJob.mockResolvedValue({ success: true })
    mockFetchOnboardingJobById.mockResolvedValue(job)

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    await POST(createRequest({ apiKey: 'sk-owned' }))

    expect(mockResetStatusFields).toHaveBeenCalledWith(
      progress,
      expect.objectContaining({
        guild_code: OWNED,
        sync_status: 'syncing',
        sync_progress: 0,
        sync_records_synced: 0,
        sync_error_message: null,
        sync_can_retry: false
      })
    )
  })

  it('passes request to processGuildInitialSyncJob', async () => {
    const job = { id: 'job-123', status: 'queued' }
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeKeyProvesOwnedGuild()
    mockEnqueueOnboardingJob.mockResolvedValue({ job, error: null })
    mockProcessGuildInitialSyncJob.mockResolvedValue({ success: true })
    mockFetchOnboardingJobById.mockResolvedValue(job)

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const request = createRequest({ apiKey: 'sk-owned' })
    await POST(request)

    expect(mockProcessGuildInitialSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ job, request })
    )
  })

  it('returns 500 on unexpected errors', async () => {
    mockGetOrCreateOnboardingProgress.mockRejectedValue(
      new Error('Unexpected error')
    )

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    const response = await POST(createRequest())
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Internal server error')
  })

  it('calls enqueueOnboardingJob with correct parameters', async () => {
    const job = { id: 'job-123', status: 'queued' }
    mockGetOrCreateOnboardingProgress.mockResolvedValue(poisonedProgress())
    arrangeKeyProvesOwnedGuild()
    mockEnqueueOnboardingJob.mockResolvedValue({ job, error: null })
    mockProcessGuildInitialSyncJob.mockResolvedValue({ success: true })
    mockFetchOnboardingJobById.mockResolvedValue(job)

    const { POST } = await import('@/app/api/onboarding/data-sync/start/route')
    await POST(createRequest({ apiKey: 'sk-owned' }))

    expect(mockEnqueueOnboardingJob).toHaveBeenCalledWith(
      mockServiceSupabase,
      'guild_initial_sync',
      expect.objectContaining({
        userId: mockUser.id,
        guildCode: OWNED,
        clusterCode: null,
        payload: expect.objectContaining({
          source: 'onboarding_dashboard',
          authoritySource: 'api_key',
          authorityElevation: 'roster_seat'
        })
      })
    )
  })
})
