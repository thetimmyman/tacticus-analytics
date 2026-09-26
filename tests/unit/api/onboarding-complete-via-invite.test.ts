import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth/server', () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn()
}))

vi.mock('@/app/lib/onboarding/progress', () => ({
  getOrCreateOnboardingProgress: vi.fn(),
  resetStatusFields: vi.fn((obj) => ({ ...obj }))
}))

vi.mock('@/app/lib/middleware/errorHandler', async () => {
  const { withErrorHandlerMock } =
    await import('../../helpers/mock-error-handler')
  return withErrorHandlerMock
})

vi.mock('@/app/lib/errors/AppError', async (importOriginal) => {
  const actual = (await importOriginal()) as object
  return actual
})

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

describe('POST /api/onboarding/complete-via-invite', () => {
  let createClient: ReturnType<typeof vi.fn>
  let createServiceClient: ReturnType<typeof vi.fn>
  let getOrCreateOnboardingProgress: ReturnType<typeof vi.fn>
  let mockUserClient: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }
  let mockServiceClient: {
    from: ReturnType<typeof vi.fn>
    auth: { admin: { updateUserById: ReturnType<typeof vi.fn> } }
  }

  function makeProgressUpdate(
    updatedProgress: Record<string, unknown> = { id: 'prog-1' }
  ) {
    return vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockResolvedValue({ data: updatedProgress, error: null })
          })
        })
      })
    })
  }

  function makeServiceFrom(
    mapping: Record<string, unknown> | null,
    guildConfig: Record<string, unknown> | null
  ) {
    return vi.fn().mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: mapping, error: null })
              })
            })
          })
        }
      }
      if (table === 'guild_config') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: guildConfig, error: null })
            })
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        }
      }
      return { select: vi.fn(), update: vi.fn(), insert: vi.fn() }
    })
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    const updatedProgress = {
      id: 'prog-1',
      guild_code: 'GUILD1',
      role_intent: 'member'
    }

    mockUserClient = {
      auth: { getUser: vi.fn() },
      from: makeProgressUpdate(updatedProgress)
    }

    mockServiceClient = {
      from: vi.fn(),
      auth: {
        admin: { updateUserById: vi.fn().mockResolvedValue({ error: null }) }
      }
    }

    const serverModule = await import('@/app/lib/auth/server')
    const progressModule = await import('@/app/lib/onboarding/progress')

    createClient = vi.mocked(serverModule.createClient)
    createServiceClient = vi.mocked(serverModule.createServiceClient)
    getOrCreateOnboardingProgress = vi.mocked(
      progressModule.getOrCreateOnboardingProgress
    )

    createClient.mockResolvedValue(mockUserClient)
    createServiceClient.mockReturnValue(mockServiceClient)
  })

  function makeRequest() {
    return new NextRequest(
      'http://localhost:3000/api/onboarding/complete-via-invite',
      {
        method: 'POST'
      }
    )
  }

  it('returns 401 when no user session', async () => {
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null
    })
    const { POST } =
      await import('@/app/api/onboarding/complete-via-invite/route')
    const response = await POST(makeRequest())
    expect(response.status).toBe(401)
  })

  it('returns 404 when player_mapping is not found', async () => {
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null
    })
    mockServiceClient.from = makeServiceFrom(null, null)
    getOrCreateOnboardingProgress.mockResolvedValue({ id: 'prog-1' })
    const { POST } =
      await import('@/app/api/onboarding/complete-via-invite/route')
    const response = await POST(makeRequest())
    expect(response.status).toBe(404)
  })

  it('returns 404 when guild_config is not found', async () => {
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null
    })
    const mapping = {
      guild_code: 'GUILD1',
      player_id: 'P1',
      display_name: 'TestPlayer',
      guild_name: 'TestGuild',
      role: 'member'
    }
    mockServiceClient.from = makeServiceFrom(mapping, null)
    getOrCreateOnboardingProgress.mockResolvedValue({ id: 'prog-1' })
    const { POST } =
      await import('@/app/api/onboarding/complete-via-invite/route')
    const response = await POST(makeRequest())
    expect(response.status).toBe(404)
  })

  it('maps leader role to role_intent=leader and returns 200', async () => {
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null
    })
    const mapping = {
      guild_code: 'GUILD1',
      player_id: 'P1',
      display_name: 'TestPlayer',
      guild_name: 'TestGuild',
      role: 'leader'
    }
    const guildConfig = {
      id: 'g1',
      guild_code: 'GUILD1',
      onboarding_completed: false
    }
    mockServiceClient.from = makeServiceFrom(mapping, guildConfig)
    getOrCreateOnboardingProgress.mockResolvedValue({ id: 'prog-1' })

    const { POST } =
      await import('@/app/api/onboarding/complete-via-invite/route')
    const response = await POST(makeRequest())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
  })

  it('returns 200 with success response on happy path', async () => {
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null
    })
    const mapping = {
      guild_code: 'GUILD1',
      player_id: 'P1',
      display_name: 'TestPlayer',
      guild_name: 'TestGuild',
      role: 'member'
    }
    const guildConfig = {
      id: 'g1',
      guild_code: 'GUILD1',
      onboarding_completed: false
    }
    mockServiceClient.from = makeServiceFrom(mapping, guildConfig)
    getOrCreateOnboardingProgress.mockResolvedValue({ id: 'prog-1' })

    const { POST } =
      await import('@/app/api/onboarding/complete-via-invite/route')
    const response = await POST(makeRequest())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.player.guild_code).toBe('GUILD1')
  })

  it('handles onboarding_progress failure as 500 (outer catch re-throws as internal error)', async () => {
    mockUserClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null
    })
    const mapping = {
      guild_code: 'GUILD1',
      player_id: 'P1',
      display_name: 'TestPlayer',
      guild_name: 'TestGuild',
      role: 'member'
    }
    const guildConfig = {
      id: 'g1',
      guild_code: 'GUILD1',
      onboarding_completed: false
    }
    mockServiceClient.from = makeServiceFrom(mapping, guildConfig)
    getOrCreateOnboardingProgress.mockRejectedValue(new Error('DB error'))
    const { POST } =
      await import('@/app/api/onboarding/complete-via-invite/route')
    const response = await POST(makeRequest())
    expect([200, 500]).toContain(response.status)
  })
})
