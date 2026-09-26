import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { createChainedMock } from '@/tests/helpers/supabase-mock'

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

vi.mock('@/app/lib/db', () => ({
  db: vi.fn(() => Promise.resolve(mockSupabase)),
  serviceDb: vi.fn(() => mockServiceSupabase)
}))

vi.mock('@/app/lib/auth/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
  createServiceClient: vi.fn(() => Promise.resolve(mockServiceSupabase))
}))

const mockGuildConfigGetBasic = vi.fn()
const mockGuildConfigGetClusterGuilds = vi.fn()
vi.mock('@/app/lib/services/guild-config-service', () => ({
  GuildConfigService: {
    getBasic: (...args: any[]) => mockGuildConfigGetBasic(...args),
    getClusterGuilds: (...args: any[]) =>
      mockGuildConfigGetClusterGuilds(...args)
  }
}))

const mockGetOrCreateOnboardingProgress = vi.fn()
vi.mock('@/app/lib/onboarding/progress', () => ({
  getOrCreateOnboardingProgress: (...args: any[]) =>
    mockGetOrCreateOnboardingProgress(...args)
}))

const mockFetchLatestJobForGuild = vi.fn()
vi.mock('@/app/lib/onboarding/jobs', () => ({
  fetchLatestJobForGuild: (...args: any[]) =>
    mockFetchLatestJobForGuild(...args)
}))

const mockResolveOnboardingMembershipState = vi.fn()
vi.mock('@/app/lib/onboarding/membership-state', () => ({
  resolveOnboardingMembershipState: (...args: any[]) =>
    mockResolveOnboardingMembershipState(...args)
}))

const mockIsGuildAwaitingFirstClaim = vi.fn()
vi.mock('@/app/lib/onboarding/first-claim', () => ({
  isGuildAwaitingFirstClaim: (...args: any[]) =>
    mockIsGuildAwaitingFirstClaim(...args)
}))

describe('GET /api/onboarding/progress', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: mockUser },
      error: null
    })
    mockResolveOnboardingMembershipState.mockResolvedValue('none')
    mockGuildConfigGetBasic.mockResolvedValue(null)
    mockGuildConfigGetClusterGuilds.mockResolvedValue([])
    mockIsGuildAwaitingFirstClaim.mockResolvedValue(false)
  })

  // RLS hides a not-yet-joined guild's roster, so the client cannot recompute this flag.
  describe('guildAwaitingFirstClaim', () => {
    it('reports a guild that still has nobody able to issue an invite', async () => {
      mockGetOrCreateOnboardingProgress.mockResolvedValue({
        user_id: mockUser.id,
        guild_code: 'GUILD1',
        role_intent: 'member',
        guild_status: 'complete'
      })
      mockSupabase.from.mockReturnValue(createChainedMock(null))
      mockServiceSupabase.from.mockReturnValue(createChainedMock(null))
      mockFetchLatestJobForGuild.mockResolvedValue(null)
      mockIsGuildAwaitingFirstClaim.mockResolvedValue(true)

      const { GET } = await import('@/app/api/onboarding/progress/route')
      const json = await (await GET()).json()

      expect(json.guildAwaitingFirstClaim).toBe(true)
      expect(mockIsGuildAwaitingFirstClaim).toHaveBeenCalledWith(
        mockServiceSupabase,
        'GUILD1',
        'user-123'
      )
    })

    // `false`, never `undefined`: the client's boolean guard would show the unknown state.
    it('answers false rather than omitting the field before a guild exists', async () => {
      mockGetOrCreateOnboardingProgress.mockResolvedValue({
        user_id: mockUser.id,
        guild_code: null,
        role_intent: 'member',
        guild_status: 'not_started'
      })
      mockSupabase.from.mockReturnValue(createChainedMock(null))

      const { GET } = await import('@/app/api/onboarding/progress/route')
      const json = await (await GET()).json()

      expect(json).toHaveProperty('guildAwaitingFirstClaim')
      expect(json.guildAwaitingFirstClaim).toBe(false)
      expect(mockIsGuildAwaitingFirstClaim).toHaveBeenCalledWith(
        mockServiceSupabase,
        null,
        'user-123'
      )
    })

    it('asks about the sanitized guild for an inactive membership', async () => {
      mockResolveOnboardingMembershipState.mockResolvedValue('inactive')
      mockGetOrCreateOnboardingProgress.mockResolvedValue({
        user_id: mockUser.id,
        guild_code: 'FORMER',
        guild_name: 'Former Guild',
        role_intent: 'leader',
        guild_status: 'complete'
      })
      mockSupabase.from.mockReturnValue(createChainedMock(null))

      const { GET } = await import('@/app/api/onboarding/progress/route')
      const json = await (await GET()).json()

      expect(mockIsGuildAwaitingFirstClaim).toHaveBeenCalledWith(
        mockServiceSupabase,
        null,
        'user-123'
      )
      expect(json.guildAwaitingFirstClaim).toBe(false)
    })
  })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null
    })

    const { GET } = await import('@/app/api/onboarding/progress/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json.error.message).toBe('Unauthorized')
    expect(mockResolveOnboardingMembershipState).not.toHaveBeenCalled()
    expect(mockGetOrCreateOnboardingProgress).not.toHaveBeenCalled()
  })

  it('returns 503 on an indeterminate membership before progress or service reads', async () => {
    mockResolveOnboardingMembershipState.mockResolvedValue('error')

    const { GET } = await import('@/app/api/onboarding/progress/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(503)
    expect(json.error.message).toBe('Unable to determine membership')
    expect(mockResolveOnboardingMembershipState).toHaveBeenCalledWith(
      mockServiceSupabase,
      mockUser.id
    )
    expect(mockGetOrCreateOnboardingProgress).not.toHaveBeenCalled()
    expect(mockServiceSupabase.from).not.toHaveBeenCalled()
    expect(mockFetchLatestJobForGuild).not.toHaveBeenCalled()
  })

  it('returns 500 when progress cannot be loaded', async () => {
    mockGetOrCreateOnboardingProgress.mockResolvedValue(null)

    const { GET } = await import('@/app/api/onboarding/progress/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Unable to load onboarding progress')
  })

  it('returns progress with null profile when no player mapping exists', async () => {
    const mockProgress = {
      user_id: mockUser.id,
      guild_code: null,
      role_intent: 'member',
      guild_status: 'pending'
    }
    mockGetOrCreateOnboardingProgress.mockResolvedValue(mockProgress)
    mockSupabase.from.mockReturnValue(createChainedMock(null))

    const { GET } = await import('@/app/api/onboarding/progress/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.progress).toEqual(mockProgress)
    expect(json.profile).toBeNull()
  })

  it('returns progress with profile when player mapping exists', async () => {
    const mockProgress = {
      user_id: mockUser.id,
      guild_code: 'GUILD1',
      role_intent: 'member',
      guild_status: 'complete'
    }
    const mockPlayerMapping = {
      player_id: 'player-123',
      display_name: 'TestPlayer',
      guild_code: 'GUILD1',
      role: 'member',
      user_id: mockUser.id,
      is_current: true
    }
    mockGetOrCreateOnboardingProgress.mockResolvedValue(mockProgress)
    mockSupabase.from.mockReturnValue(createChainedMock(mockPlayerMapping))
    mockGuildConfigGetBasic.mockResolvedValue({ cluster_code: 'CLUSTER1' })

    const { GET } = await import('@/app/api/onboarding/progress/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.profile).toMatchObject({
      user_id: mockUser.id,
      role: 'member',
      guild_code: 'GUILD1',
      display_name: 'TestPlayer',
      cluster_code: 'CLUSTER1'
    })
  })

  it('preserves the normal guild sync path for a membership with no current profile', async () => {
    const mockProgress = {
      user_id: mockUser.id,
      guild_code: 'GUILD1',
      role_intent: 'member',
      guild_status: 'complete'
    }
    const mockSyncRow = {
      guild_code: 'GUILD1',
      status: 'complete',
      queue_status: 'idle',
      records_synced: 100,
      last_sync: '2025-01-01T00:00:00Z',
      full_sync_success: true,
      updated_at: '2025-01-01T00:00:00Z'
    }
    mockGetOrCreateOnboardingProgress.mockResolvedValue(mockProgress)
    mockSupabase.from.mockReturnValue(createChainedMock(null))
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_sync_status') {
        return createChainedMock(mockSyncRow)
      }
      return createChainedMock(null)
    })
    mockFetchLatestJobForGuild.mockResolvedValue({
      id: 'job-1',
      status: 'complete'
    })

    const { GET } = await import('@/app/api/onboarding/progress/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.syncStatus).toMatchObject({
      guild_code: 'GUILD1',
      status: 'complete',
      records_synced: 100
    })
    expect(json.job).toMatchObject({ id: 'job-1', status: 'complete' })
    expect(mockResolveOnboardingMembershipState).toHaveBeenCalledWith(
      mockServiceSupabase,
      mockUser.id
    )
  })

  it('sanitizes an inactive former leader before any guild or cluster service reads', async () => {
    const historicalProgress = {
      user_id: mockUser.id,
      guild_mode: 'new_guild',
      role_intent: 'leader',
      guild_status: 'failed',
      guild_code: 'FORMER',
      guild_name: 'Former Guild',
      guild_error_message: 'former error',
      guild_can_retry: false,
      guild_lock_expires_at: '2026-08-04T00:00:00Z',
      sync_status: 'failed',
      sync_progress: 73,
      sync_records_synced: 1234,
      sync_error_message: 'former sync error',
      sync_can_retry: false,
      profile_status: 'complete',
      player_id: 'player-1',
      player_name: 'Player One',
      profile_error_message: null,
      profile_can_retry: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z'
    }
    mockResolveOnboardingMembershipState.mockResolvedValue('inactive')
    mockGetOrCreateOnboardingProgress.mockResolvedValue(historicalProgress)
    mockSupabase.from.mockReturnValue(createChainedMock(null))

    const { GET } = await import('@/app/api/onboarding/progress/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.progress).toMatchObject({
      guild_mode: 'existing_guild',
      role_intent: 'member',
      guild_status: 'not_started',
      guild_code: null,
      guild_name: null,
      guild_error_message: null,
      guild_lock_expires_at: null,
      sync_status: 'not_required',
      sync_progress: 0,
      sync_records_synced: 0,
      sync_error_message: null,
      profile_status: 'not_started',
      player_id: null,
      player_name: null,
      profile_error_message: null
    })
    expect(json.syncStatus).toBeNull()
    expect(json.job).toBeNull()
    expect(json.cluster).toBeNull()
    expect(json.clusterGuilds).toEqual([])
    expect(mockResolveOnboardingMembershipState).toHaveBeenCalledWith(
      mockServiceSupabase,
      mockUser.id
    )
    expect(mockFetchLatestJobForGuild).not.toHaveBeenCalled()
    expect(mockServiceSupabase.from).not.toHaveBeenCalled()
    expect(mockGuildConfigGetBasic).not.toHaveBeenCalled()
    expect(mockGuildConfigGetClusterGuilds).not.toHaveBeenCalled()
  })

  it('includes cluster data for leaders', async () => {
    const mockProgress = {
      user_id: mockUser.id,
      guild_code: 'GUILD1',
      role_intent: 'leader',
      guild_status: 'complete'
    }
    const mockCluster = {
      id: 'cluster-id',
      cluster_code: 'CLUSTER1',
      display_name: 'Test Cluster',
      description: 'A test cluster',
      onboarding_completed: true,
      created_by: mockUser.id
    }
    const mockGuildRows = [
      {
        guild_code: 'GUILD1',
        display_name: 'Guild 1',
        enabled: true,
        onboarding_completed: true
      }
    ]
    mockGetOrCreateOnboardingProgress.mockResolvedValue(mockProgress)
    mockSupabase.from.mockReturnValue(createChainedMock(null))
    mockGuildConfigGetClusterGuilds.mockResolvedValue(mockGuildRows)
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock(mockCluster)
      }
      if (table === 'onboarding_jobs') {
        const chain = createChainedMock(null)
        chain.then = (resolve: any) => resolve({ data: [], error: null })
        return chain
      }
      return createChainedMock(null)
    })
    mockFetchLatestJobForGuild.mockResolvedValue(null)

    const { GET } = await import('@/app/api/onboarding/progress/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.cluster).toMatchObject({
      id: 'cluster-id',
      cluster_code: 'CLUSTER1',
      display_name: 'Test Cluster'
    })
    expect(json.clusterGuilds).toHaveLength(1)
    expect(json.clusterGuilds[0].guild_code).toBe('GUILD1')
  })

  it('falls back to profile cluster_code for leaders when no created cluster', async () => {
    const mockProgress = {
      user_id: mockUser.id,
      guild_code: 'GUILD1',
      role_intent: 'leader',
      guild_status: 'complete'
    }
    const mockPlayerMapping = {
      player_id: 'player-123',
      display_name: 'TestPlayer',
      guild_code: 'GUILD1',
      role: 'leader',
      user_id: mockUser.id,
      is_current: true
    }
    const mockClusterByCode = {
      id: 'cluster-id-2',
      cluster_code: 'CLUSTER2',
      display_name: 'Fallback Cluster',
      description: null,
      onboarding_completed: false,
      created_by: 'other-user'
    }
    mockGetOrCreateOnboardingProgress.mockResolvedValue(mockProgress)
    mockSupabase.from.mockReturnValue(createChainedMock(mockPlayerMapping))
    mockGuildConfigGetBasic.mockResolvedValue({ cluster_code: 'CLUSTER2' })

    let clusterCallCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        clusterCallCount++
        if (clusterCallCount === 1) {
          return createChainedMock(null)
        }
        return createChainedMock(mockClusterByCode)
      }
      if (table === 'guild_config') {
        const chain = createChainedMock(null)
        chain.then = (resolve: any) => resolve({ data: [], error: null })
        return chain
      }
      return createChainedMock(null)
    })
    mockFetchLatestJobForGuild.mockResolvedValue(null)

    const { GET } = await import('@/app/api/onboarding/progress/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
  })

  it('handles sync metadata lookup errors gracefully', async () => {
    const mockProgress = {
      user_id: mockUser.id,
      guild_code: 'GUILD1',
      role_intent: 'member',
      guild_status: 'complete'
    }
    mockGetOrCreateOnboardingProgress.mockResolvedValue(mockProgress)
    mockSupabase.from.mockReturnValue(createChainedMock(null))
    mockServiceSupabase.from.mockReturnValue(
      createChainedMock(null, { message: 'DB error' })
    )
    mockFetchLatestJobForGuild.mockResolvedValue(null)

    const { GET } = await import('@/app/api/onboarding/progress/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.syncStatus).toBeNull()
  })

  it('handles cluster lookup errors gracefully for leaders', async () => {
    const mockProgress = {
      user_id: mockUser.id,
      guild_code: 'GUILD1',
      role_intent: 'leader',
      guild_status: 'complete'
    }
    mockGetOrCreateOnboardingProgress.mockResolvedValue(mockProgress)
    mockSupabase.from.mockReturnValue(createChainedMock(null))
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'clusters') {
        return createChainedMock(null, { message: 'Cluster lookup failed' })
      }
      return createChainedMock(null)
    })
    mockFetchLatestJobForGuild.mockResolvedValue(null)

    const { GET } = await import('@/app/api/onboarding/progress/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.cluster).toBeNull()
    expect(json.clusterGuilds).toEqual([])
  })

  it('returns 500 on unexpected errors', async () => {
    mockGetOrCreateOnboardingProgress.mockRejectedValue(
      new Error('Unexpected error')
    )

    const { GET } = await import('@/app/api/onboarding/progress/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Internal server error')
  })
})
