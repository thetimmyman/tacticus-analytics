import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockSupabase: {
  auth: { getUser: ReturnType<typeof vi.fn> }
  from: ReturnType<typeof vi.fn>
}
let mockGetOrCreateOnboardingProgress: ReturnType<typeof vi.fn>
let mockResetStatusFields: ReturnType<typeof vi.fn>

describe('/api/onboarding/start', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }
    mockGetOrCreateOnboardingProgress = vi.fn()
    mockResetStatusFields = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: vi.fn().mockResolvedValue(mockSupabase)
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

    const routeModule = await import('@/app/api/onboarding/start/route')
    POST = routeModule.POST
  })

  describe('POST /api/onboarding/start', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new NextRequest('http://localhost/api/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildMode: 'existing_guild' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Unauthorized')
    })

    it('returns 400 when guildMode is missing', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })

      const request = new NextRequest('http://localhost/api/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Invalid guild mode')
    })

    it('returns 400 when guildMode is invalid', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })

      const request = new NextRequest('http://localhost/api/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildMode: 'invalid_mode' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Invalid guild mode')
    })

    it('returns 500 when getOrCreateOnboardingProgress returns null', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetOrCreateOnboardingProgress.mockResolvedValue(null)

      const request = new NextRequest('http://localhost/api/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildMode: 'existing_guild' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Unable to initialise onboardin')
    })

    it('returns 500 when database update fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetOrCreateOnboardingProgress.mockResolvedValue({ id: 'progress-1' })
      mockResetStatusFields.mockReturnValue({ guild_mode: 'existing_guild' })

      const mockUpdateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: new Error('DB error') })
      }
      mockSupabase.from.mockReturnValue(mockUpdateChain)

      const request = new NextRequest('http://localhost/api/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildMode: 'existing_guild' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to update onboarding mo')
    })

    it('successfully updates progress for existing_guild mode', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      const existingProgress = { id: 'progress-1', user_id: 'user-123' }
      mockGetOrCreateOnboardingProgress.mockResolvedValue(existingProgress)

      const resetData = {
        guild_status: 'not_started',
        guild_code: null,
        sync_status: 'not_required',
        role_intent: 'member',
        guild_mode: 'existing_guild'
      }
      mockResetStatusFields.mockReturnValue(resetData)

      const updatedProgress = { ...existingProgress, ...resetData }
      const mockUpdateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: updatedProgress, error: null })
      }
      mockSupabase.from.mockReturnValue(mockUpdateChain)

      const request = new NextRequest('http://localhost/api/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildMode: 'existing_guild' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.progress).toEqual(updatedProgress)
      expect(mockResetStatusFields).toHaveBeenCalledWith(
        existingProgress,
        expect.objectContaining({
          role_intent: 'member',
          guild_mode: 'existing_guild',
          sync_status: 'not_required'
        })
      )
    })

    it('successfully updates progress for new_guild mode', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      const existingProgress = { id: 'progress-1', user_id: 'user-123' }
      mockGetOrCreateOnboardingProgress.mockResolvedValue(existingProgress)

      const resetData = {
        guild_status: 'not_started',
        guild_code: null,
        sync_status: 'pending',
        role_intent: 'leader',
        guild_mode: 'new_guild'
      }
      mockResetStatusFields.mockReturnValue(resetData)

      const updatedProgress = { ...existingProgress, ...resetData }
      const mockUpdateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: updatedProgress, error: null })
      }
      mockSupabase.from.mockReturnValue(mockUpdateChain)

      const request = new NextRequest('http://localhost/api/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildMode: 'new_guild' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.progress).toEqual(updatedProgress)
      expect(mockResetStatusFields).toHaveBeenCalledWith(
        existingProgress,
        expect.objectContaining({
          role_intent: 'leader',
          guild_mode: 'new_guild',
          sync_status: 'pending'
        })
      )
    })

    it('preserves a completed guild registration instead of clearing it', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      const completedProgress = {
        id: 'progress-1',
        user_id: 'user-123',
        guild_status: 'complete',
        guild_code: 'ZKFPH',
        guild_name: 'Claim Test Guild',
        role_intent: 'leader'
      }
      mockGetOrCreateOnboardingProgress.mockResolvedValue(completedProgress)
      mockResetStatusFields.mockReturnValue({ guild_mode: 'new_guild' })

      const mockUpdateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: completedProgress, error: null })
      }
      mockSupabase.from.mockReturnValue(mockUpdateChain)

      const request = new NextRequest('http://localhost/api/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildMode: 'new_guild' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.progress.guild_code).toBe('ZKFPH')
      expect(mockResetStatusFields).toHaveBeenCalledWith(completedProgress, {
        guild_mode: 'new_guild'
      })
      expect(mockResetStatusFields).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ guild_code: null })
      )
    })

    it('still resets a guild step that never completed', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      const failedProgress = {
        id: 'progress-1',
        user_id: 'user-123',
        guild_status: 'failed',
        guild_code: null
      }
      mockGetOrCreateOnboardingProgress.mockResolvedValue(failedProgress)
      mockResetStatusFields.mockReturnValue({ guild_code: null })

      const mockUpdateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: failedProgress, error: null })
      }
      mockSupabase.from.mockReturnValue(mockUpdateChain)

      const request = new NextRequest('http://localhost/api/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildMode: 'new_guild' })
      })

      expect((await POST(request)).status).toBe(200)
      expect(mockResetStatusFields).toHaveBeenCalledWith(
        failedProgress,
        expect.objectContaining({ guild_code: null, role_intent: 'leader' })
      )
    })

    it('returns 500 for invalid JSON body', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })

      const request = new NextRequest('http://localhost/api/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json'
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Internal server error')
    })
  })
})
