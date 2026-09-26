import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth/server', () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn()
}))

vi.mock('@/app/lib/onboarding/progress', () => ({
  getOrCreateOnboardingProgress: vi.fn(),
  resetStatusFields: vi.fn((obj) => ({ ...obj, all_complete: true }))
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

describe('Integration: POST /api/onboarding/complete-via-invite', () => {
  let createClient: ReturnType<typeof vi.fn>
  let createServiceClient: ReturnType<typeof vi.fn>
  let getOrCreateOnboardingProgress: ReturnType<typeof vi.fn>

  const PLAYER_MAPPING = {
    guild_code: 'GUILD1',
    player_id: 'player-001',
    display_name: 'AlphaPlayer',
    guild_name: 'Alpha Guild',
    role: 'member',
    is_current: true,
    user_id: 'user-123'
  }

  const GUILD_CONFIG = {
    id: 'gc-1',
    guild_code: 'GUILD1',
    guild_name: 'Alpha Guild',
    onboarding_completed: false
  }

  const INITIAL_PROGRESS = {
    id: 'prog-1',
    user_id: 'user-123',
    guild_code: null,
    guild_name: null,
    guild_mode: null,
    role_intent: null,
    player_id: null,
    player_name: null
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    const serverModule = await import('@/app/lib/auth/server')
    const progressModule = await import('@/app/lib/onboarding/progress')

    createClient = vi.mocked(serverModule.createClient)
    createServiceClient = vi.mocked(serverModule.createServiceClient)
    getOrCreateOnboardingProgress = vi.mocked(
      progressModule.getOrCreateOnboardingProgress
    )

    getOrCreateOnboardingProgress.mockResolvedValue(INITIAL_PROGRESS)

    const UPDATED_PROGRESS = {
      id: 'prog-1',
      guild_code: 'GUILD1',
      role_intent: 'member'
    }

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null
        })
      },
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: UPDATED_PROGRESS, error: null })
            })
          })
        })
      })
    })

    createServiceClient.mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: PLAYER_MAPPING, error: null })
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
                  .mockResolvedValue({ data: GUILD_CONFIG, error: null })
              })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        if (table === 'onboarding_progress') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        return { select: vi.fn(), update: vi.fn() }
      }),
      auth: {
        admin: {
          updateUserById: vi.fn().mockResolvedValue({ error: null })
        }
      }
    })
  })

  it('completes full state transition: player_mapping → onboarding completion', async () => {
    const { POST } =
      await import('@/app/api/onboarding/complete-via-invite/route')
    const req = new NextRequest(
      'http://localhost:3000/api/onboarding/complete-via-invite',
      { method: 'POST' }
    )
    const response = await POST(req)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
  })

  it('response contains player_name from mapping', async () => {
    const { POST } =
      await import('@/app/api/onboarding/complete-via-invite/route')
    const req = new NextRequest(
      'http://localhost:3000/api/onboarding/complete-via-invite',
      { method: 'POST' }
    )
    const response = await POST(req)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.player.name).toBe('AlphaPlayer')
  })

  it('response contains guild_code from mapping', async () => {
    const { POST } =
      await import('@/app/api/onboarding/complete-via-invite/route')
    const req = new NextRequest(
      'http://localhost:3000/api/onboarding/complete-via-invite',
      { method: 'POST' }
    )
    const response = await POST(req)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.player.guild_code).toBe('GUILD1')
  })

  it('updates guild onboarding_completed when it was false', async () => {
    let guildUpdateCalled = false

    createServiceClient.mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: PLAYER_MAPPING, error: null })
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
                  .mockResolvedValue({ data: GUILD_CONFIG, error: null })
              })
            }),
            update: vi.fn().mockImplementation(() => {
              guildUpdateCalled = true
              return { eq: vi.fn().mockResolvedValue({ error: null }) }
            })
          }
        }
        if (table === 'onboarding_progress') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }
        return { select: vi.fn(), update: vi.fn() }
      }),
      auth: {
        admin: { updateUserById: vi.fn().mockResolvedValue({ error: null }) }
      }
    })

    const { POST } =
      await import('@/app/api/onboarding/complete-via-invite/route')
    const req = new NextRequest(
      'http://localhost:3000/api/onboarding/complete-via-invite',
      { method: 'POST' }
    )
    await POST(req)

    expect(guildUpdateCalled).toBe(true)
  })
})
