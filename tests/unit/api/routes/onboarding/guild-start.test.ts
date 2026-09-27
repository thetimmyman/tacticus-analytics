import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock
} from 'vitest'

// vitest 5 types a bare vi.fn() as function-or-constructor; these mocks are called.
type AnyMock = Mock<(...args: any[]) => any>
import { NextRequest } from 'next/server'

let mockAuthedSupabase: {
  auth: { getUser: AnyMock }
  from: AnyMock
}
let mockServiceSupabase: {
  from: AnyMock
  rpc: AnyMock
}
let mockGetOrCreateOnboardingProgress: AnyMock
let mockResetStatusFields: AnyMock
let mockValidateApiKeyWithTacticus: AnyMock
let mockFetch: AnyMock
let mockGuildConfigService: {
  findByCodeOrTag: AnyMock
  getFull: AnyMock
  exists: AnyMock
}
let mockGetGuild: AnyMock
let mockCaptureGuildConflict: AnyMock
let mockReconcileGuildConflict: AnyMock

async function hasSettled<T>(promise: Promise<T>): Promise<boolean> {
  const pending = Symbol('pending')
  const result = await Promise.race([
    promise.then(
      () => true,
      () => true
    ),
    Promise.resolve(pending)
  ])
  return result !== pending
}

function latestGuildSettlementArgs(): Record<string, unknown> | undefined {
  return [...mockServiceSupabase.rpc.mock.calls]
    .reverse()
    .find(([name]) => name === 'settle_own_guild_onboarding_attempt')?.[1]
}

describe('/api/onboarding/guild/start', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    mockAuthedSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }
    mockServiceSupabase = {
      from: vi.fn(),
      rpc: vi.fn((name: string, args?: Record<string, unknown>) => {
        if (name === 'begin_own_guild_onboarding_attempt') {
          return Promise.resolve({ data: 1, error: null })
        }
        if (name === 'settle_own_guild_onboarding_attempt') {
          return Promise.resolve({
            data: {
              success: true,
              generation: args?.p_generation,
              progress: {
                guild_status: args?.p_outcome,
                guild_code: args?.p_guild_code,
                guild_name: args?.p_guild_name,
                sync_status: args?.p_sync_status
              }
            },
            error: null
          })
        }
        return Promise.resolve({ data: null, error: null })
      })
    }
    mockGetOrCreateOnboardingProgress = vi.fn()
    mockResetStatusFields = vi.fn((progress, updates) => ({
      ...progress,
      ...updates
    }))
    mockValidateApiKeyWithTacticus = vi.fn()
    mockCaptureGuildConflict = vi.fn().mockResolvedValue(null)
    mockReconcileGuildConflict = vi
      .fn()
      .mockResolvedValue({ reconciled: false })
    mockFetch = vi.fn()
    mockGuildConfigService = {
      findByCodeOrTag: vi.fn(),
      getFull: vi.fn(),
      exists: vi.fn()
    }
    mockGuildConfigService.findByCodeOrTag.mockImplementation(
      async (client, code) => {
        const full = await mockGuildConfigService.getFull(client, code)
        if (full !== undefined) return full

        const exists = await mockGuildConfigService.exists(client, code)
        return exists ? { guild_code: code, enabled: true } : null
      }
    )

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: vi.fn().mockResolvedValue(mockAuthedSupabase),
      createServiceClient: vi.fn().mockReturnValue(mockServiceSupabase)
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))
    vi.doMock('@/app/lib/onboarding/progress', () => ({
      getOrCreateOnboardingProgress: mockGetOrCreateOnboardingProgress,
      resetStatusFields: mockResetStatusFields
    }))
    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus
    }))
    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: mockGuildConfigService
    }))
    vi.doMock('@/app/lib/onboarding/guild-membership-reconciliation', () => ({
      captureGuildConflict: mockCaptureGuildConflict,
      reconcileGuildConflict: mockReconcileGuildConflict
    }))
    // "Upstream told us nothing" must fall through to the 409.
    mockGetGuild = vi.fn().mockResolvedValue(null)
    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      tacticusAPI: { getGuild: mockGetGuild }
    }))

    vi.stubGlobal('fetch', mockFetch)

    const routeModule = await import('@/app/api/onboarding/guild/start/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('POST /api/onboarding/guild/start', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockAuthedSupabase.auth.getUser.mockResolvedValue({
        data: { user: null }
      })

      const request = new NextRequest(
        'http://localhost/api/onboarding/guild/start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guildMode: 'existing_guild',
            guildCode: 'TEST1'
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Unauthorized')
    })

    it('returns 500 when onboarding progress cannot be loaded', async () => {
      mockAuthedSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetOrCreateOnboardingProgress.mockResolvedValue(null)

      const request = new NextRequest(
        'http://localhost/api/onboarding/guild/start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guildMode: 'existing_guild',
            guildCode: 'TEST1'
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Unable to load onboarding prog')
    })

    it('returns 400 when no guild mode is available', async () => {
      mockAuthedSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetOrCreateOnboardingProgress.mockResolvedValue({
        guild_mode: null
      })

      const request = new NextRequest(
        'http://localhost/api/onboarding/guild/start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Onboarding mode not selected')
    })

    describe('existing_guild mode', () => {
      it('returns 400 when guild code is missing', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        mockGetOrCreateOnboardingProgress.mockResolvedValue({
          guild_mode: 'existing_guild'
        })

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guildMode: 'existing_guild' })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toBe('Guild code is required')
      })

      it('returns 404 when guild is not found', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'existing_guild' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockGuildConfigService.getFull.mockResolvedValue(null)

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'existing_guild',
              guildCode: 'NOTEXIST'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error.message).toContain('could not find that guild code')
      })

      it('returns 400 when guild is not enabled', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'existing_guild' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockGuildConfigService.getFull.mockResolvedValue({
          guild_code: 'TEST1',
          enabled: false
        })

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'existing_guild',
              guildCode: 'TEST1'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toContain('not enabled')
      })

      it('returns 400 when guild has no synced players', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'existing_guild' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockGuildConfigService.getFull.mockResolvedValue({
          guild_code: 'TEST1',
          enabled: true,
          onboarding_completed: false
        })

        mockServiceSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ count: 0 })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis()
          }
        })

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'existing_guild',
              guildCode: 'TEST1'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toContain('no synced players')
      })

      it('successfully joins existing guild with completed sync', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'existing_guild', user_id: 'user-123' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockGuildConfigService.getFull.mockResolvedValue({
          guild_code: 'TEST1',
          display_name: 'Test Guild',
          enabled: true,
          onboarding_completed: true
        })

        mockServiceSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ count: 10, error: null })
                })
              })
            }
          }
          if (table === 'guild_sync_status') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { full_sync_success: true },
                error: null
              })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis()
          }
        })

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              ...progress,
              guild_status: 'complete',
              sync_status: 'not_required'
            },
            error: null
          })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'existing_guild',
              guildCode: 'test1'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.progress.guild_status).toBe('complete')
        expect(body.progress.sync_status).toBe('not_required')
        expect(latestGuildSettlementArgs()).toEqual(
          expect.objectContaining({
            p_generation: 1,
            p_guild_mode: 'existing_guild',
            p_role_intent: 'member',
            p_guild_code: 'TEST1'
          })
        )
      })

      it('normalizes guild code to uppercase', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'existing_guild' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockGuildConfigService.getFull.mockResolvedValue(null)

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'existing_guild',
              guildCode: '  lowercase  '
            })
          }
        )

        await POST(request)

        expect(mockGuildConfigService.findByCodeOrTag).toHaveBeenCalledWith(
          expect.anything(),
          'LOWERCASE'
        )
      })
    })

    describe('new_guild mode', () => {
      it('returns 400 when required fields are missing', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        mockGetOrCreateOnboardingProgress.mockResolvedValue({
          guild_mode: 'new_guild'
        })

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guildMode: 'new_guild', guildCode: 'TEST1' })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toContain(
          'Guild code, name, and API key are required'
        )
      })

      it('returns 409 when guild already exists', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'new_guild' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockGuildConfigService.getFull.mockResolvedValue({
          guild_code: 'TEST1',
          display_name: 'Test Guild',
          enabled: true,
          onboarding_completed: true
        })

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'TEST1',
              guildName: 'Test Guild',
              apiKey: 'valid-api-key'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(409)
        expect(body.error.message).toMatch(/Existing Guild/)
        expect(body.error.message).not.toBe('Guild already exists in analytics')
      })

      it('resumes onboarding when the caller holds the registered guild key', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        mockGetOrCreateOnboardingProgress.mockResolvedValue({
          guild_mode: 'new_guild',
          user_id: 'user-123'
        })

        mockGuildConfigService.getFull.mockResolvedValue({
          guild_code: 'ZKFPH',
          display_name: 'Claim Test Guild',
          enabled: true,
          onboarding_completed: true
        })

        mockServiceSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: { guild_id: 'guild-uuid-1' } })
        })
        mockGetGuild.mockResolvedValue({ guildId: 'guild-uuid-1' })
        const conflict = {
          mappingId: 17,
          playerId: 'player-1',
          sourceGuildCode: 'OLD1',
          sourceGuildId: 'guild-uuid-old'
        }
        mockCaptureGuildConflict.mockResolvedValue(conflict)
        mockReconcileGuildConflict.mockResolvedValue({
          reconciled: true,
          sourceGuildCode: 'OLD1',
          targetGuildCode: 'ZKFPH'
        })

        const updated = {
          user_id: 'user-123',
          guild_code: 'ZKFPH',
          guild_status: 'complete',
          role_intent: 'leader'
        }
        mockAuthedSupabase.from.mockReturnValue({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: updated, error: null })
        })

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'ZKFPH',
              guildName: 'Claim Test Guild',
              apiKey: 'valid-api-key'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.alreadyRegistered).toBe(true)
        expect(body.membershipReconciled).toBe(true)
        expect(body.progress.guild_code).toBe('ZKFPH')
        expect(mockCaptureGuildConflict).toHaveBeenCalledWith({
          service: mockServiceSupabase,
          userId: 'user-123',
          targetGuildId: 'guild-uuid-1'
        })
        expect(mockReconcileGuildConflict).toHaveBeenCalledWith({
          service: mockServiceSupabase,
          userId: 'user-123',
          apiKey: 'valid-api-key',
          attemptGeneration: 1,
          targetGuildCode: 'ZKFPH',
          targetGuildId: 'guild-uuid-1',
          candidate: conflict
        })
        expect(latestGuildSettlementArgs()).toEqual(
          expect.objectContaining({
            p_generation: 1,
            p_outcome: 'complete',
            p_guild_code: 'ZKFPH'
          })
        )
        expect(mockServiceSupabase.rpc).toHaveBeenCalledWith(
          'record_guild_bootstrap_claim_authority',
          {
            p_subject: 'user-123',
            p_guild_code: 'ZKFPH',
            p_attempt_generation: 1,
            p_source: 'verified_registration'
          }
        )
      })

      it('still returns 409 when the key belongs to a different guild', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        mockGetOrCreateOnboardingProgress.mockResolvedValue({
          guild_mode: 'new_guild',
          user_id: 'user-123'
        })

        mockGuildConfigService.getFull.mockResolvedValue({
          guild_code: 'ZKFPH',
          display_name: 'Claim Test Guild',
          enabled: true,
          onboarding_completed: true
        })

        mockServiceSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: { guild_id: 'guild-uuid-1' } })
        })
        mockGetGuild.mockResolvedValue({ guildId: 'guild-uuid-OTHER' })

        mockAuthedSupabase.from.mockReturnValue({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        })

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'ZKFPH',
              guildName: 'Claim Test Guild',
              apiKey: 'someone-elses-key'
            })
          }
        )

        expect((await POST(request)).status).toBe(409)
      })

      it('retries incomplete standard guild registration instead of returning 409', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'new_guild', user_id: 'user-123' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)
        mockGuildConfigService.getFull.mockResolvedValue({
          guild_code: 'NEW1',
          display_name: 'Partial Guild',
          enabled: true,
          onboarding_completed: false
        })
        mockServiceSupabase.from.mockImplementation((table: string) => {
          if (table === 'guild_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  guild_code: 'NEW1',
                  display_name: 'Partial Guild',
                  cluster_code: null,
                  onboarding_source: 'standard',
                  onboarding_completed: false
                },
                error: null
              })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis()
          }
        })
        mockValidateApiKeyWithTacticus.mockResolvedValue({ isValid: true })
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            success: true,
            data: {
              playerMappingsCreated: false,
              autoDiscovered: { guildName: 'Partial Guild' }
            }
          })
        })

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              ...progress,
              guild_status: 'complete',
              sync_status: 'pending'
            },
            error: null
          })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'NEW1',
              guildName: 'New Guild',
              apiKey: 'valid-api-key'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()
        const forwardedPayload = JSON.parse(
          mockFetch.mock.calls[0]?.[1]?.body as string
        )

        expect(response.status).toBe(200)
        expect(body.progress.guild_status).toBe('complete')
        expect(forwardedPayload.guild_code).toBe('NEW1')
      })

      it('returns 400 when API key validation fails', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'new_guild' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockGuildConfigService.exists.mockResolvedValue(false)
        mockValidateApiKeyWithTacticus.mockResolvedValue({
          isValid: false,
          error: 'Invalid API key'
        })

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'NEW1',
              guildName: 'New Guild',
              apiKey: 'invalid-key'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toContain('Invalid API key')
      })

      it('registers a new guild and reconciles a conflicting former membership', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'new_guild', user_id: 'user-123' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockGuildConfigService.exists.mockResolvedValue(false)
        mockValidateApiKeyWithTacticus.mockResolvedValue({
          isValid: true,
          guildInfo: { guildId: 'target-guild-id' }
        })
        const conflict = {
          mappingId: 17,
          playerId: 'player-1',
          sourceGuildCode: 'OLD1',
          sourceGuildId: 'old-guild-id'
        }
        mockCaptureGuildConflict.mockResolvedValue(conflict)
        mockReconcileGuildConflict.mockResolvedValue({
          reconciled: true,
          sourceGuildCode: 'OLD1',
          targetGuildCode: 'NEW1'
        })

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            success: true,
            data: {
              playerMappingsCreated: true,
              autoDiscovered: { guildName: 'Discovered Guild Name' }
            }
          })
        })

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              ...progress,
              guild_status: 'complete',
              sync_status: 'complete'
            },
            error: null
          })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'NEW1',
              guildName: 'New Guild',
              apiKey: 'valid-api-key'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.progress.guild_status).toBe('complete')
        expect(body.guildInfo).toBeDefined()
        expect(body.claimed).toBe(false)
        expect(body.membershipReconciled).toBe(true)
        expect(mockCaptureGuildConflict).toHaveBeenCalledWith({
          service: mockServiceSupabase,
          userId: 'user-123',
          targetGuildId: 'target-guild-id'
        })
        expect(mockReconcileGuildConflict).toHaveBeenCalledWith({
          service: mockServiceSupabase,
          userId: 'user-123',
          apiKey: 'valid-api-key',
          attemptGeneration: 1,
          targetGuildCode: 'NEW1',
          targetGuildId: 'target-guild-id',
          candidate: conflict
        })
      })

      it('returns a retryable failure when onboarding completion cannot be saved after reconciliation', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'new_guild', user_id: 'user-123' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)
        mockGuildConfigService.exists.mockResolvedValue(false)
        mockValidateApiKeyWithTacticus.mockResolvedValue({
          isValid: true,
          guildInfo: { guildId: 'target-guild-id' }
        })
        mockCaptureGuildConflict.mockResolvedValue({
          mappingId: 17,
          playerId: 'player-1',
          sourceGuildCode: 'OLD1',
          sourceGuildId: 'old-guild-id'
        })
        mockReconcileGuildConflict.mockResolvedValue({ reconciled: true })
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            success: true,
            data: { guild_code: 'NEW1', playerMappingsCreated: true }
          })
        })

        mockServiceSupabase.rpc.mockImplementation(
          (name: string, args?: Record<string, unknown>) => {
            if (name === 'begin_own_guild_onboarding_attempt') {
              return Promise.resolve({ data: 1, error: null })
            }
            if (
              name === 'settle_own_guild_onboarding_attempt' &&
              args?.p_outcome === 'complete'
            ) {
              return Promise.resolve({
                data: null,
                error: { message: 'temporary write failure' }
              })
            }
            return Promise.resolve({
              data: { success: true, progress: {} },
              error: null
            })
          }
        )

        const response = await POST(
          new NextRequest('http://localhost/api/onboarding/guild/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'NEW1',
              guildName: 'New Guild',
              apiKey: 'valid-api-key'
            })
          })
        )
        const body = await response.json()

        expect(response.status).toBe(503)
        expect(body.error.message).toContain('could not be finalized')
        expect(mockReconcileGuildConflict).toHaveBeenCalledOnce()
      })

      it('does not overwrite progress when a newer guild attempt supersedes completion', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        mockGetOrCreateOnboardingProgress.mockResolvedValue({
          guild_mode: 'new_guild',
          user_id: 'user-123'
        })
        mockGuildConfigService.exists.mockResolvedValue(false)
        mockValidateApiKeyWithTacticus.mockResolvedValue({
          isValid: true,
          guildInfo: { guildId: 'target-guild-id' }
        })
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            success: true,
            data: { guild_code: 'NEW1', playerMappingsCreated: true }
          })
        })
        mockServiceSupabase.rpc.mockImplementation(
          (name: string, args?: Record<string, unknown>) => {
            if (name === 'begin_own_guild_onboarding_attempt') {
              return Promise.resolve({ data: 7, error: null })
            }
            if (name === 'settle_own_guild_onboarding_attempt') {
              return Promise.resolve({
                data: {
                  success: false,
                  error_code: 'ATTEMPT_SUPERSEDED',
                  current_generation: 8,
                  attempted_outcome: args?.p_outcome
                },
                error: null
              })
            }
            return Promise.resolve({ data: null, error: null })
          }
        )

        const response = await POST(
          new NextRequest('http://localhost/api/onboarding/guild/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'NEW1',
              guildName: 'New Guild',
              apiKey: 'valid-api-key'
            })
          })
        )
        const body = await response.json()

        expect(response.status).toBe(409)
        expect(body.error.message).toContain('newer guild registration')
        const settlements = mockServiceSupabase.rpc.mock.calls.filter(
          ([name]) => name === 'settle_own_guild_onboarding_attempt'
        )
        expect(settlements).toHaveLength(1)
        expect(settlements[0]?.[1]).toEqual(
          expect.objectContaining({
            p_generation: 7,
            p_outcome: 'complete',
            p_guild_code: 'NEW1'
          })
        )
      })

      it('keys onboarding progress on the guild_code committed by create-config (identity-first claim)', async () => {
        // create-config can adopt an existing row's code; progress and response use the committed one.
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'new_guild', user_id: 'user-123' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockGuildConfigService.exists.mockResolvedValue(false)
        mockValidateApiKeyWithTacticus.mockResolvedValue({ isValid: true })

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            success: true,
            data: {
              guild_code: 'REALCO',
              claimed: true,
              playerMappingsCreated: true,
              autoDiscovered: { guildName: 'Real Guild Name' }
            }
          })
        })

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              ...progress,
              guild_status: 'complete',
              guild_code: 'REALCO',
              sync_status: 'complete'
            },
            error: null
          })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'TYPED1',
              guildName: 'Typed Guild',
              apiKey: 'valid-api-key'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)

        const forwardedPayload = JSON.parse(
          mockFetch.mock.calls[0]?.[1]?.body as string
        )
        expect(forwardedPayload.guild_code).toBe('TYPED1')

        expect(latestGuildSettlementArgs()).toEqual(
          expect.objectContaining({
            p_outcome: 'complete',
            p_guild_code: 'REALCO'
          })
        )

        expect(body.claimed).toBe(true)
        expect(body.progress.guild_code).toBe('REALCO')
        expect(mockServiceSupabase.rpc).toHaveBeenCalledWith(
          'record_guild_bootstrap_claim_authority',
          {
            p_subject: 'user-123',
            p_guild_code: 'REALCO',
            p_attempt_generation: 1,
            p_source: 'verified_registration'
          }
        )
      })

      it('keeps create-config request open beyond one external API budget', async () => {
        vi.useFakeTimers()
        const { SERVICE_TIMEOUTS } =
          await import('@/app/lib/utils/async-timeout')
        const { CREATE_CONFIG_TIMEOUT_MS } =
          await import('@/app/api/onboarding/_lib/create-config-fetch')
        let aborted = false
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'new_guild', user_id: 'user-123' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockGuildConfigService.exists.mockResolvedValue(false)
        mockValidateApiKeyWithTacticus.mockResolvedValue({ isValid: true })
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

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'NEW1',
              guildName: 'New Guild',
              apiKey: 'valid-api-key'
            })
          }
        )

        const responsePromise = POST(request)
        responsePromise.catch(() => undefined)

        await vi.waitFor(() => {
          expect(mockFetch).toHaveBeenCalled()
        })
        await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)

        expect(aborted).toBe(false)
        expect(await hasSettled(responsePromise)).toBe(false)

        await vi.advanceTimersByTimeAsync(
          CREATE_CONFIG_TIMEOUT_MS - SERVICE_TIMEOUTS.EXTERNAL_API
        )

        expect(aborted).toBe(true)
        const response = await responsePromise
        expect(response.status).toBe(504)
      })

      it('handles create-config API failure', async () => {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'new_guild' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockServiceSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi
            .fn()
            .mockResolvedValue({ data: null, error: { message: 'Not found' } })
        })
        mockValidateApiKeyWithTacticus.mockResolvedValue({ isValid: true })

        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          json: vi.fn().mockResolvedValue({
            error: {
              code: 5001,
              message:
                'duplicate key value violates unique constraint "guild_config_guild_id_key"',
              retryable: true,
              metadata: {
                endpoint: '/api/guild/create-config',
                details:
                  'Key (guild_id)=(11111111-1111-1111-1111-111111111111) already exists.'
              },
              statusCode: 500,
              requestId: 'req-1'
            }
          })
        })

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'NEW1',
              guildName: 'New Guild',
              apiKey: 'valid-api-key'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error.message).toBe(
          'We could not register your guild. Please try again in a few minutes.'
        )
        for (const secret of [
          'Key (guild_id)',
          '11111111-1111-1111-1111-111111111111',
          '/api/guild/create-config',
          'unique constraint'
        ]) {
          expect(body.error.message).not.toContain(secret)
          expect(JSON.stringify(body)).not.toContain(secret)
        }

        const settlement = latestGuildSettlementArgs()
        expect(typeof settlement?.p_error_message).toBe('string')
        expect(settlement?.p_error_message).toBe(body.error.message)
      })

      it('handles hung create-config registration as retryable failure', async () => {
        vi.useFakeTimers()
        const { CREATE_CONFIG_TIMEOUT_MS } =
          await import('@/app/api/onboarding/_lib/create-config-fetch')
        let aborted = false
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'new_guild', user_id: 'user-123' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockGuildConfigService.exists.mockResolvedValue(false)
        mockValidateApiKeyWithTacticus.mockResolvedValue({ isValid: true })
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

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'NEW1',
              guildName: 'New Guild',
              apiKey: 'valid-api-key'
            })
          }
        )

        const responsePromise = POST(request)
        responsePromise.catch(() => undefined)

        await vi.waitFor(() => {
          expect(mockFetch).toHaveBeenCalled()
        })
        await vi.advanceTimersByTimeAsync(CREATE_CONFIG_TIMEOUT_MS)

        expect(aborted).toBe(true)
        const response = await responsePromise
        const body = await response.json()
        expect(response.status).toBe(504)
        expect(body.error.message).toContain('timed out')
        expect(latestGuildSettlementArgs()).toEqual(
          expect.objectContaining({ p_outcome: 'failed' })
        )
      })

      it('handles hung create-config response body as retryable failure', async () => {
        vi.useFakeTimers()
        const { CREATE_CONFIG_TIMEOUT_MS } =
          await import('@/app/api/onboarding/_lib/create-config-fetch')
        let aborted = false
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
        const progress = { guild_mode: 'new_guild', user_id: 'user-123' }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)

        mockGuildConfigService.exists.mockResolvedValue(false)
        mockValidateApiKeyWithTacticus.mockResolvedValue({ isValid: true })
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
            status: 200,
            json: () => new Promise(() => {})
          } as Response)
        })

        const mockUpdateChain = {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        }
        mockAuthedSupabase.from.mockReturnValue(mockUpdateChain)

        const request = new NextRequest(
          'http://localhost/api/onboarding/guild/start',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildMode: 'new_guild',
              guildCode: 'NEW1',
              guildName: 'New Guild',
              apiKey: 'valid-api-key'
            })
          }
        )

        const responsePromise = POST(request)
        responsePromise.catch(() => undefined)

        await vi.waitFor(() => {
          expect(mockFetch).toHaveBeenCalled()
        })
        await vi.advanceTimersByTimeAsync(CREATE_CONFIG_TIMEOUT_MS)

        expect(aborted).toBe(true)
        const response = await responsePromise
        const body = await response.json()
        expect(response.status).toBe(504)
        expect(body.error.message).toContain('timed out')
        expect(latestGuildSettlementArgs()).toEqual(
          expect.objectContaining({ p_outcome: 'failed' })
        )
      })
    })

    it('returns 500 for unexpected errors', async () => {
      mockAuthedSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetOrCreateOnboardingProgress.mockRejectedValue(
        new Error('Unexpected error')
      )

      const request = new NextRequest(
        'http://localhost/api/onboarding/guild/start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guildMode: 'existing_guild',
            guildCode: 'TEST1'
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Internal server error')
    })

    describe('stored/returned failure parity', () => {
      const USER = { id: 'user-123' }

      function newUpdateChain() {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      }

      function requestFor(body: Record<string, unknown>) {
        return new NextRequest('http://localhost/api/onboarding/guild/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      }

      function storedMessage(chain: { update: AnyMock }) {
        const settlement = latestGuildSettlementArgs()
        if (settlement?.p_outcome === 'failed') {
          return settlement.p_error_message
        }
        const arg = chain.update.mock.calls[0]?.[0] as Record<string, unknown>
        return arg?.guild_error_message
      }

      async function runBranch(
        branch:
          | 'guild_not_found'
          | 'guild_not_enabled'
          | 'no_synced_players'
          | 'already_registered'
          | 'key_validation'
          | 'create_config_timeout'
          | 'create_config_failed',
        options: { validationError?: string; createConfig?: Response } = {}
      ) {
        mockAuthedSupabase.auth.getUser.mockResolvedValue({
          data: { user: USER }
        })
        const progress = { guild_mode: 'new_guild', user_id: USER.id }
        mockGetOrCreateOnboardingProgress.mockResolvedValue(progress)
        const chain = newUpdateChain()
        mockAuthedSupabase.from.mockReturnValue(chain)
        mockServiceSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        })
        mockValidateApiKeyWithTacticus.mockResolvedValue({ isValid: true })

        let response: Response
        switch (branch) {
          case 'guild_not_found':
            mockGuildConfigService.getFull.mockResolvedValue(null)
            response = await POST(
              requestFor({ guildMode: 'existing_guild', guildCode: 'NOPE' })
            )
            break
          case 'guild_not_enabled':
            mockGuildConfigService.getFull.mockResolvedValue({
              guild_code: 'TEST1',
              enabled: false
            })
            response = await POST(
              requestFor({ guildMode: 'existing_guild', guildCode: 'TEST1' })
            )
            break
          case 'no_synced_players':
            mockGuildConfigService.getFull.mockResolvedValue({
              guild_code: 'TEST1',
              enabled: true,
              onboarding_completed: false
            })
            response = await POST(
              requestFor({ guildMode: 'existing_guild', guildCode: 'TEST1' })
            )
            break
          case 'already_registered':
            mockGuildConfigService.getFull.mockResolvedValue({
              guild_code: 'TEST1',
              display_name: 'Test Guild',
              enabled: true,
              onboarding_completed: true
            })
            response = await POST(
              requestFor({
                guildMode: 'new_guild',
                guildCode: 'TEST1',
                guildName: 'Test Guild',
                apiKey: 'valid-api-key'
              })
            )
            break
          case 'key_validation':
            mockGuildConfigService.getFull.mockResolvedValue(null)
            mockGuildConfigService.exists.mockResolvedValue(false)
            mockValidateApiKeyWithTacticus.mockResolvedValue({
              isValid: false,
              error: options.validationError ?? 'Invalid API key'
            })
            response = await POST(
              requestFor({
                guildMode: 'new_guild',
                guildCode: 'NEW1',
                guildName: 'New Guild',
                apiKey: 'invalid-key'
              })
            )
            break
          case 'create_config_timeout':
            mockGuildConfigService.getFull.mockResolvedValue(null)
            mockGuildConfigService.exists.mockResolvedValue(false)
            mockFetch.mockRejectedValue(
              new DOMException('Aborted', 'AbortError')
            )
            response = await POST(
              requestFor({
                guildMode: 'new_guild',
                guildCode: 'NEW1',
                guildName: 'New Guild',
                apiKey: 'valid-api-key'
              })
            )
            break
          case 'create_config_failed':
            mockGuildConfigService.getFull.mockResolvedValue(null)
            mockGuildConfigService.exists.mockResolvedValue(false)
            mockFetch.mockResolvedValue(
              options.createConfig ??
                ({
                  ok: false,
                  status: 500,
                  json: vi.fn().mockResolvedValue({
                    error: { message: 'boom' }
                  })
                } as unknown as Response)
            )
            response = await POST(
              requestFor({
                guildMode: 'new_guild',
                guildCode: 'NEW1',
                guildName: 'New Guild',
                apiKey: 'valid-api-key'
              })
            )
            break
        }

        return { chain, response, body: await response.json() }
      }

      it.each([
        ['guild_not_found', 404],
        ['guild_not_enabled', 400],
        ['no_synced_players', 400],
        ['already_registered', 409],
        ['key_validation', 400],
        ['create_config_timeout', 504],
        ['create_config_failed', 500]
      ] as const)(
        'stores exactly what it returns on the %s branch',
        async (branch, status) => {
          const { chain, response, body } = await runBranch(branch)

          expect(response.status).toBe(status)
          expect(typeof storedMessage(chain)).toBe('string')
          expect(storedMessage(chain)).toBe(body.error.message)
        }
      )

      it('suppresses the raw-exception validation message', async () => {
        const { chain, body } = await runBranch('key_validation', {
          validationError:
            'Validation failed: connect ECONNREFUSED 10.0.0.5:443'
        })

        for (const secret of ['ECONNREFUSED', '10.0.0.5']) {
          expect(body.error.message).not.toContain(secret)
          expect(storedMessage(chain)).not.toContain(secret)
        }
        expect(body.error.message).toBe(
          'API key validation failed. Please confirm the key is correct and has Guild + Guild Raid read access.'
        )
      })

      // Non-vacuity: an always-fallback sanitizer would destroy this message.
      it('preserves the hand-authored Player-key remediation verbatim', async () => {
        const remediation =
          'This appears to be a Player API key. The Guild API Key field requires a key with Guild + Guild Raid read permissions. Go to https://api.tacticusgame.com/ and create a new key with "Guild" and "Guild Raid" scopes selected.'

        const { chain, body } = await runBranch('key_validation', {
          validationError: remediation
        })

        expect(body.error.message).toBe(remediation)
        expect(body.error.message).toContain('https://api.tacticusgame.com/')
        expect(storedMessage(chain)).toBe(remediation)
      })

      it('reports a create-config 401 as a bad request, not a session failure', async () => {
        const { response, body, chain } = await runBranch(
          'create_config_failed',
          {
            createConfig: {
              ok: false,
              status: 401,
              json: vi.fn().mockResolvedValue({
                error: { message: 'Invalid API key provided' }
              })
            } as unknown as Response
          }
        )

        expect(response.status).toBe(400)
        expect(body.error.message).toBe('Invalid API key provided')
        expect(storedMessage(chain)).toBe(body.error.message)
      })

      // Its 409 wording embeds another guild's id or name.
      it('curates a create-config 409 instead of forwarding its wording', async () => {
        const { response, body } = await runBranch('create_config_failed', {
          createConfig: {
            ok: false,
            status: 409,
            json: vi.fn().mockResolvedValue({
              error: {
                message:
                  'Guild already exists: Key (guild_id)=(22222222-2222-2222-2222-222222222222) already exists.',
                metadata: { details: 'Owned by "Some Other Guild"' }
              }
            })
          } as unknown as Response
        })

        expect(response.status).toBe(409)
        expect(JSON.stringify(body)).not.toContain('22222222')
        expect(JSON.stringify(body)).not.toContain('Some Other Guild')
        expect(body.error.message).toMatch(/Existing Guild/)
      })

      it('forwards a curated create-config 400 message', async () => {
        const { body } = await runBranch('create_config_failed', {
          createConfig: {
            ok: false,
            status: 400,
            json: vi.fn().mockResolvedValue({
              error: { message: 'Could not determine guild from API key' }
            })
          } as unknown as Response
        })

        expect(body.error.message).toBe(
          'Could not determine guild from API key'
        )
      })
    })
  })
})
