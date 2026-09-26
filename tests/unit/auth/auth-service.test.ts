import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { User, Session, AuthError } from '@supabase/supabase-js'

vi.mock('@/app/lib/db', () => ({
  db: vi.fn(),
  serviceDb: vi.fn()
}))

vi.mock('@/app/lib/auth/server', () => ({
  createServiceClient: vi.fn()
}))

const banLookupMocks = vi.hoisted(() => ({
  findActiveBanForAuthUser: vi.fn(),
  findActiveBanForUser: vi.fn()
}))

vi.mock('@/app/lib/auth/user-bans', () => banLookupMocks)

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

const authLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn()
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => authLogger
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  })
}))

const createMockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-123',
  email: 'test@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides
})

const createMockSession = (overrides: Partial<Session> = {}): Session => ({
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: 'bearer',
  user: createMockUser(),
  ...overrides
})

const OWNERSHIP_ATTESTATION_ID = '11111111-1111-4111-8111-111111111111'

const createMockProfile = (overrides: Record<string, unknown> = {}) => ({
  id: 101,
  player_id: 'player-123',
  user_id: 'user-123',
  display_name: 'TestUser',
  guild_code: 'TEST',
  role: 'member' as const,
  is_app_admin: false,
  is_current: true,
  ownership_attestation_id: OWNERSHIP_ATTESTATION_ID,
  timezone: 'UTC',
  avatar_url: null,
  ...overrides
})

const createVerifiedPlayer = (
  profile: ReturnType<typeof createMockProfile> = createMockProfile()
) => ({
  mapping_id: profile.id,
  player_id: profile.player_id,
  user_id: profile.user_id,
  guild_code: profile.guild_code,
  role: profile.role ?? null,
  is_app_admin: profile.is_app_admin === true,
  ownership_attestation_id: profile.ownership_attestation_id
})

describe('Auth Service', () => {
  let mockSupabaseClient: {
    auth: {
      getUser: ReturnType<typeof vi.fn>
      getSession: ReturnType<typeof vi.fn>
      signInWithPassword: ReturnType<typeof vi.fn>
      signOut: ReturnType<typeof vi.fn>
    }
    from: ReturnType<typeof vi.fn>
  }

  let mockServiceClient: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  function mockVerifiedProfile(profile: ReturnType<typeof createMockProfile>) {
    mockServiceClient.rpc.mockImplementation((name, args) => {
      if (
        name !== 'resolve_verified_players' ||
        !Array.isArray(args?.p_user_ids) ||
        !args.p_user_ids.includes(profile.user_id)
      ) {
        return Promise.resolve({ data: [], error: null })
      }

      return Promise.resolve({
        data: [createVerifiedPlayer(profile)],
        error: null
      })
    })
  }

  function mockFreshProfile(
    profile: ReturnType<typeof createMockProfile> | null,
    error: { code?: string; message: string } | null = null
  ) {
    if (profile) mockVerifiedProfile(profile)
    const maybeSingle = vi.fn().mockResolvedValue({ data: profile, error })
    const secondEq = vi.fn().mockReturnValue({ maybeSingle })
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq })
    const select = vi.fn().mockReturnValue({ eq: firstEq })
    mockSupabaseClient.from.mockReturnValue({ select })
    return { select, firstEq, secondEq, maybeSingle }
  }

  function mockServiceProfile(profile: ReturnType<typeof createMockProfile>) {
    mockVerifiedProfile(profile)
    mockServiceClient.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: profile,
              error: null
            })
          })
        })
      })
    })
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    banLookupMocks.findActiveBanForAuthUser.mockResolvedValue(null)
    banLookupMocks.findActiveBanForUser.mockResolvedValue(null)

    mockSupabaseClient = {
      auth: {
        getUser: vi.fn(),
        getSession: vi.fn(),
        signInWithPassword: vi.fn(),
        signOut: vi.fn()
      },
      from: vi.fn()
    }

    mockServiceClient = {
      from: vi.fn(),
      rpc: vi.fn()
    }
    mockVerifiedProfile(createMockProfile())

    const { db, serviceDb } = await import('@/app/lib/db')

    vi.mocked(db).mockReturnValue(
      mockSupabaseClient as unknown as ReturnType<typeof db>
    )
    vi.mocked(serviceDb).mockReturnValue(
      mockServiceClient as unknown as ReturnType<typeof serviceDb>
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getCurrentUser', () => {
    it('returns null when getUser fails', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Auth error', name: 'AuthError' } as AuthError
      })

      const { getCurrentUser } = await import('@/app/lib/auth')
      const result = await getCurrentUser()

      expect(result).toBeNull()
    })

    it('returns null when no user exists', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const { getCurrentUser } = await import('@/app/lib/auth')
      const result = await getCurrentUser()

      expect(result).toBeNull()
    })

    it('returns AppUser when authenticated with profile', async () => {
      const mockUser = createMockUser()
      const mockProfile = createMockProfile()

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceProfile(mockProfile)

      const { getCurrentUser } = await import('@/app/lib/auth')
      const result = await getCurrentUser()

      expect(result).not.toBeNull()
      expect(result?.id).toBe('user-123')
      expect(result?.email).toBe('test@example.com')
      expect(result?.guildCode).toBe('TEST')
      expect(result?.role).toBe('member')
    })

    it('returns user with onboarding role when no profile exists', async () => {
      const mockUser = createMockUser()

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null
              }),
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null
                  })
                })
              })
            })
          })
        })
      })

      const { getCurrentUser } = await import('@/app/lib/auth')
      const result = await getCurrentUser()

      expect(result).not.toBeNull()
      expect(result?.role).toBe('onboarding')
      expect(result?.guildCode).toBeNull()
      expect(result?.membershipStatus).toBe('none')
    })

    it('handles getUser throwing exception', async () => {
      mockSupabaseClient.auth.getUser.mockRejectedValue(
        new Error('Network error')
      )

      const { getCurrentUser } = await import('@/app/lib/auth')
      const result = await getCurrentUser()

      expect(result).toBeNull()
    })
  })

  describe('getSession', () => {
    it('returns empty session when getSession fails', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: { message: 'Session error', name: 'AuthError' } as AuthError
      })

      const { getSession } = await import('@/app/lib/auth')
      const result = await getSession()

      expect(result.user).toBeNull()
      expect(result.accessToken).toBeNull()
      expect(result.refreshToken).toBeNull()
    })

    it('returns empty session when no session exists', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null
      })

      const { getSession } = await import('@/app/lib/auth')
      const result = await getSession()

      expect(result.user).toBeNull()
      expect(result.accessToken).toBeNull()
    })

    it('returns full session with tokens when authenticated', async () => {
      const mockSession = createMockSession()
      const mockProfile = createMockProfile()

      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { session: mockSession },
        error: null
      })

      mockServiceProfile(mockProfile)

      const { getSession } = await import('@/app/lib/auth')
      const result = await getSession()

      expect(result.user).not.toBeNull()
      expect(result.accessToken).toBe('test-access-token')
      expect(result.refreshToken).toBe('test-refresh-token')
      expect(result.expiresAt).not.toBeNull()
    })

    it('converts expires_at timestamp to ISO string', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 7200
      const mockSession = createMockSession({ expires_at: expiresAt })
      const mockProfile = createMockProfile()

      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { session: mockSession },
        error: null
      })

      mockServiceProfile(mockProfile)

      const { getSession } = await import('@/app/lib/auth')
      const result = await getSession()

      expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })

  describe('signInWithPassword', () => {
    it('returns error when authentication fails', async () => {
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: {
          message: 'Invalid credentials',
          name: 'AuthApiError'
        } as AuthError
      })

      const { signInWithPassword } = await import('@/app/lib/auth')
      const result = await signInWithPassword({
        email: 'test@example.com',
        password: 'wrongpassword'
      })

      expect(result.user).toBeNull()
      expect(result.error).not.toBeNull()
      expect(result.error?.message).toBe('Invalid credentials')

      expect(authLogger.warn).toHaveBeenCalled()
      expect(JSON.stringify(authLogger.warn.mock.calls)).not.toContain(
        'test@example.com'
      )
    })

    it('returns user and session on successful login', async () => {
      const mockUser = createMockUser()
      const mockSession = createMockSession({ user: mockUser })
      const mockProfile = createMockProfile()

      mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })

      const { signInWithPassword } = await import('@/app/lib/auth')
      const result = await signInWithPassword({
        email: 'test@example.com',
        password: 'correctpassword'
      })

      expect(result.user).not.toBeNull()
      expect(result.error).toBeNull()
      expect(result.session.accessToken).toBe('test-access-token')
    })

    it('clears the session and rejects a banned credential', async () => {
      const mockUser = createMockUser()
      const mockSession = createMockSession({ user: mockUser })
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null
      })
      mockSupabaseClient.auth.signOut.mockResolvedValue({ error: null })
      banLookupMocks.findActiveBanForAuthUser.mockResolvedValue({
        id: 'ban-1',
        ban_group_id: 'group-1',
        subject_type: 'email',
        subject_value: 'test@example.com',
        reason: 'abuse',
        banned_at: '2026-08-24T00:00:00Z',
        expires_at: null
      })

      const { signInWithPassword } = await import('@/app/lib/auth')
      const result = await signInWithPassword({
        email: 'test@example.com',
        password: 'correctpassword'
      })

      expect(result.user).toBeNull()
      expect(result.error).toEqual({
        message: 'Account suspended',
        code: 'ACCOUNT_BANNED'
      })
      expect(mockSupabaseClient.auth.signOut).toHaveBeenCalledOnce()
    })

    it('clears the new session when ban verification throws', async () => {
      const mockUser = createMockUser()
      const mockSession = createMockSession({ user: mockUser })
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: mockUser, session: mockSession },
        error: null
      })
      mockSupabaseClient.auth.signOut.mockResolvedValue({ error: null })
      banLookupMocks.findActiveBanForAuthUser.mockRejectedValue(
        new Error('Unable to verify account access')
      )

      const { signInWithPassword } = await import('@/app/lib/auth')
      const result = await signInWithPassword({
        email: 'test@example.com',
        password: 'correctpassword'
      })

      expect(result.user).toBeNull()
      expect(result.error?.message).toBe('Unable to verify account access')
      expect(mockSupabaseClient.auth.signOut).toHaveBeenCalledOnce()
    })

    it('normalizes email to lowercase and trims whitespace', async () => {
      mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Failed', name: 'AuthError' } as AuthError
      })

      const { signInWithPassword } = await import('@/app/lib/auth')
      await signInWithPassword({
        email: '  TEST@EXAMPLE.COM  ',
        password: 'password'
      })

      expect(mockSupabaseClient.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password'
      })
    })

    it('handles exception during sign in', async () => {
      mockSupabaseClient.auth.signInWithPassword.mockRejectedValue(
        new Error('Network failure')
      )

      const { signInWithPassword } = await import('@/app/lib/auth')
      const result = await signInWithPassword({
        email: 'test@example.com',
        password: 'password'
      })

      expect(result.user).toBeNull()
      expect(result.error).not.toBeNull()
      expect(result.error?.message).toBe('Network failure')
    })
  })

  describe('signOut', () => {
    it('calls supabase signOut', async () => {
      mockSupabaseClient.auth.signOut.mockResolvedValue({ error: null })

      const { signOut } = await import('@/app/lib/auth')
      await signOut()

      expect(mockSupabaseClient.auth.signOut).toHaveBeenCalled()
    })

    it('handles signOut error gracefully', async () => {
      mockSupabaseClient.auth.signOut.mockResolvedValue({
        error: { message: 'Sign out failed', name: 'AuthError' } as AuthError
      })

      const { signOut } = await import('@/app/lib/auth')
      await expect(signOut()).resolves.not.toThrow()
    })

    it('handles signOut exception gracefully', async () => {
      mockSupabaseClient.auth.signOut.mockRejectedValue(
        new Error('Network error')
      )

      const { signOut } = await import('@/app/lib/auth')
      await expect(signOut()).resolves.not.toThrow()
    })
  })

  describe('getAuthUser', () => {
    it('returns null when no user', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const { getAuthUser } = await import('@/app/lib/auth')
      const result = await getAuthUser()

      expect(result).toBeNull()
    })

    it('returns null when user has no profile', async () => {
      const mockUser = createMockUser()

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null
              }),
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null
                  })
                })
              })
            })
          })
        })
      })

      const { getAuthUser } = await import('@/app/lib/auth')
      const result = await getAuthUser()

      expect(result).toBeNull()
    })

    it('returns user and profile when both exist', async () => {
      const mockUser = createMockUser()
      const mockProfile = createMockProfile()

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })

      const { getAuthUser } = await import('@/app/lib/auth')
      const result = await getAuthUser()

      expect(result).not.toBeNull()
      expect(result?.user.id).toBe('user-123')
      expect(result?.profile.guild_code).toBe('TEST')
    })
  })

  describe('getOptionalAuthForApi', () => {
    it('keeps anonymous API callers optional', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const { getOptionalAuthForApi } = await import('@/app/lib/auth')

      await expect(getOptionalAuthForApi()).resolves.toBeNull()
      expect(banLookupMocks.findActiveBanForUser).not.toHaveBeenCalled()
    })

    it('rejects a banned authenticated API caller before returning detail', async () => {
      const mockUser = createMockUser()
      const mockProfile = createMockProfile()
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })
      mockServiceProfile(mockProfile)
      banLookupMocks.findActiveBanForUser.mockResolvedValue({
        id: 'ban-1',
        ban_group_id: 'group-1',
        subject_type: 'user_id',
        subject_value: mockUser.id,
        reason: 'abuse',
        banned_at: '2026-08-24T00:00:00Z',
        expires_at: null
      })

      const { getOptionalAuthForApi } = await import('@/app/lib/auth')

      await expect(getOptionalAuthForApi()).rejects.toMatchObject({
        code: 'ACCOUNT_BANNED'
      })
    })
  })

  describe('requireAuth', () => {
    it('throws redirect to login when no user', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const { requireAuth } = await import('@/app/lib/auth')

      await expect(requireAuth()).rejects.toThrow(
        'REDIRECT:/auth/login?reason=required'
      )
    })

    it('throws redirect to onboarding when user exists but no profile', async () => {
      const mockUser = createMockUser()

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null
              }),
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null
                  })
                })
              })
            })
          })
        })
      })
      mockFreshProfile(null)

      const { requireAuth } = await import('@/app/lib/auth')

      await expect(requireAuth()).rejects.toThrow('REDIRECT:/onboarding')
    })

    it('returns auth data when user has profile', async () => {
      const mockUser = createMockUser()
      const mockProfile = createMockProfile()

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      const freshQuery = mockFreshProfile(mockProfile)

      const { requireAuth } = await import('@/app/lib/auth')
      const result = await requireAuth()

      expect(result.user.id).toBe('user-123')
      expect(result.profile.guild_code).toBe('TEST')
      expect(mockSupabaseClient.from).toHaveBeenCalledWith(
        'current_user_player_mapping'
      )
      expect(freshQuery.secondEq).toHaveBeenCalledWith('is_current', true)
      expect(mockServiceClient.from).not.toHaveBeenCalled()
    })
  })

  describe('requireRole', () => {
    it('throws redirect to unauthorized for insufficient role', async () => {
      const mockUser = createMockUser()
      const mockProfile = createMockProfile({ role: 'member' })

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })
      mockFreshProfile(mockProfile)

      const { requireRole } = await import('@/app/lib/auth')

      await expect(requireRole('officer')).rejects.toThrow(
        'REDIRECT:/unauthorized?required=officer&current=member'
      )
    })

    it('allows access for sufficient role', async () => {
      const mockUser = createMockUser()
      const mockProfile = createMockProfile({ role: 'leader' })

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })
      mockFreshProfile(mockProfile)

      const { requireRole } = await import('@/app/lib/auth')
      const result = await requireRole('officer')

      expect(result.user.role).toBe('leader')
    })

    it('allows same role access', async () => {
      const mockUser = createMockUser()
      const mockProfile = createMockProfile({ role: 'officer' })

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })
      mockFreshProfile(mockProfile)

      const { requireRole } = await import('@/app/lib/auth')
      const result = await requireRole('officer')

      expect(result.user.role).toBe('officer')
    })

    it('uses the fresh profile role instead of auth metadata', async () => {
      const mockUser = createMockUser({
        user_metadata: { role: 'leader' },
        app_metadata: { role: 'leader' }
      })
      const mockProfile = createMockProfile({ role: 'member' })

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })
      mockFreshProfile(mockProfile)

      const { requireRole } = await import('@/app/lib/auth')

      await expect(requireRole('officer')).rejects.toThrow(
        'REDIRECT:/unauthorized?required=officer&current=member'
      )
    })
  })

  describe('requireActiveMembership', () => {
    it('redirects to login when not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const { requireActiveMembership } = await import('@/app/lib/auth')

      await expect(requireActiveMembership()).rejects.toThrow(
        'REDIRECT:/auth/login?reason=required'
      )
    })

    it('redirects to onboarding when membership status is none', async () => {
      const mockUser = createMockUser()

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null
              }),
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null
                  })
                })
              })
            })
          })
        })
      })
      mockFreshProfile(null)

      const { requireActiveMembership } = await import('@/app/lib/auth')

      await expect(requireActiveMembership()).rejects.toThrow(
        'REDIRECT:/onboarding'
      )
    })

    it('redirects to home when membership is inactive', async () => {
      const mockUser = createMockUser()
      const mockProfile = createMockProfile({ is_current: false })

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      const mockFrom = vi.fn()
      mockServiceClient.from = mockFrom

      const selectChain = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn()
          })
        })
      }

      let activeCallCount = 0
      selectChain.eq.mockImplementation(function (this: typeof selectChain) {
        return this
      })

      selectChain.maybeSingle.mockImplementation(() => {
        activeCallCount++
        if (activeCallCount === 1) {
          return Promise.resolve({ data: null, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      })

      selectChain.order.mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: mockProfile,
            error: null
          })
        })
      })

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue(selectChain)
      })
      mockFreshProfile(null)

      const { requireActiveMembership } = await import('@/app/lib/auth')

      await expect(requireActiveMembership()).rejects.toThrow('REDIRECT:/home')
    })

    it('returns auth data when membership is active', async () => {
      const mockUser = createMockUser()
      const mockProfile = createMockProfile()

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })
      mockFreshProfile(mockProfile)

      const { requireActiveMembership } = await import('@/app/lib/auth')
      const result = await requireActiveMembership()

      expect(result.user.membershipStatus).toBe('active')
      expect(result.profile.guild_code).toBe('TEST')
    })
  })

  describe('requireActiveMembershipForApi', () => {
    it('rejects an unauthenticated request before any membership or service-role read', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const { requireActiveMembershipForApi } = await import('@/app/lib/auth')
      const { serviceDb } = await import('@/app/lib/db')

      await expect(requireActiveMembershipForApi()).rejects.toMatchObject({
        code: 'UNAUTHENTICATED'
      })
      expect(mockSupabaseClient.from).not.toHaveBeenCalled()
      expect(serviceDb).not.toHaveBeenCalled()
    })

    it('fails closed on a current-membership lookup error', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: createMockUser() },
        error: null
      })
      const freshQuery = mockFreshProfile(null, {
        code: '42501',
        message: 'permission denied'
      })

      const { requireActiveMembershipForApi } = await import('@/app/lib/auth')
      const { serviceDb } = await import('@/app/lib/db')

      await expect(requireActiveMembershipForApi()).rejects.toMatchObject({
        code: 'ONBOARDING_REQUIRED'
      })
      expect(freshQuery.firstEq).toHaveBeenCalledWith('user_id', 'user-123')
      expect(freshQuery.secondEq).toHaveBeenCalledWith('is_current', true)
      expect(freshQuery.firstEq.mock.invocationCallOrder[0]).toBeLessThan(
        freshQuery.secondEq.mock.invocationCallOrder[0]
      )
      expect(serviceDb).not.toHaveBeenCalled()
    })

    it('rejects an inactive account when the current-only lookup finds no mapping', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: createMockUser() },
        error: null
      })
      const freshQuery = mockFreshProfile(null)

      const { requireActiveMembershipForApi } = await import('@/app/lib/auth')
      const { serviceDb } = await import('@/app/lib/db')

      await expect(requireActiveMembershipForApi()).rejects.toMatchObject({
        code: 'ONBOARDING_REQUIRED'
      })
      expect(freshQuery.firstEq).toHaveBeenCalledWith('user_id', 'user-123')
      expect(freshQuery.secondEq).toHaveBeenCalledWith('is_current', true)
      expect(serviceDb).not.toHaveBeenCalled()
    })

    it('returns the fresh current member from the request-scoped query', async () => {
      const profile = createMockProfile({ role: 'member' })
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: createMockUser() },
        error: null
      })
      const freshQuery = mockFreshProfile(profile)

      const { requireActiveMembershipForApi } = await import('@/app/lib/auth')
      const { serviceDb } = await import('@/app/lib/db')
      const result = await requireActiveMembershipForApi()

      expect(result.profile).not.toBe(profile)
      expect(result.profile).toEqual(profile)
      expect(result.user).toMatchObject({
        id: 'user-123',
        guildCode: 'TEST',
        membershipStatus: 'active',
        role: 'member'
      })
      expect(freshQuery.select).toHaveBeenCalledWith(
        expect.not.stringContaining('*')
      )
      expect(mockSupabaseClient.from).toHaveBeenCalledWith(
        'current_user_player_mapping'
      )
      expect(freshQuery.firstEq).toHaveBeenCalledWith('user_id', 'user-123')
      expect(freshQuery.secondEq).toHaveBeenCalledWith('is_current', true)
      expect(freshQuery.firstEq.mock.invocationCallOrder[0]).toBeLessThan(
        freshQuery.secondEq.mock.invocationCallOrder[0]
      )
      expect(serviceDb).toHaveBeenCalledTimes(1)
      expect(mockServiceClient.from).not.toHaveBeenCalled()
      expect(mockServiceClient.rpc).toHaveBeenCalledWith(
        'resolve_verified_players',
        { p_user_ids: ['user-123'] }
      )
    })

    it('uses the current database profile instead of elevated auth metadata', async () => {
      const profile = createMockProfile({
        role: 'member',
        is_app_admin: true
      })
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: {
          user: createMockUser({
            user_metadata: { role: 'admin', is_app_admin: true },
            app_metadata: { role: 'admin', is_app_admin: true }
          })
        },
        error: null
      })
      const freshQuery = mockFreshProfile(profile)

      const { requireActiveMembershipForApi } = await import('@/app/lib/auth')
      const { serviceDb } = await import('@/app/lib/db')
      const result = await requireActiveMembershipForApi()

      expect(result.profile.is_app_admin).toBe(true)
      expect(result.user.role).toBe('member')
      expect(freshQuery.secondEq).toHaveBeenCalledWith('is_current', true)
      expect(serviceDb).toHaveBeenCalledTimes(1)
      expect(mockServiceClient.from).not.toHaveBeenCalled()
      expect(mockServiceClient.rpc).toHaveBeenCalledWith(
        'resolve_verified_players',
        { p_user_ids: ['user-123'] }
      )
    })

    it('does not let elevated auth metadata replace a missing current mapping', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: {
          user: createMockUser({
            user_metadata: { role: 'admin', is_app_admin: true },
            app_metadata: { role: 'admin', is_app_admin: true }
          })
        },
        error: null
      })
      mockFreshProfile(null)

      const { requireActiveMembershipForApi } = await import('@/app/lib/auth')
      const { serviceDb } = await import('@/app/lib/db')

      await expect(requireActiveMembershipForApi()).rejects.toMatchObject({
        code: 'ONBOARDING_REQUIRED'
      })
      expect(serviceDb).not.toHaveBeenCalled()
    })
  })

  describe('requireRoleForApi', () => {
    it('rejects an authenticated caller without a fresh current mapping', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: createMockUser() },
        error: null
      })
      mockFreshProfile(null)

      const { requireRoleForApi } = await import('@/app/lib/auth')

      await expect(requireRoleForApi('member')).rejects.toMatchObject({
        code: 'ONBOARDING_REQUIRED'
      })
      expect(mockServiceClient.from).not.toHaveBeenCalled()
    })

    it('uses the fresh profile role instead of elevated auth metadata', async () => {
      const mockUser = createMockUser({
        user_metadata: { role: 'leader' },
        app_metadata: { role: 'leader' }
      })
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })
      mockFreshProfile(createMockProfile({ role: 'member' }))

      const { requireRoleForApi } = await import('@/app/lib/auth')

      await expect(requireRoleForApi('officer')).rejects.toMatchObject({
        code: 'INSUFFICIENT_ROLE',
        currentRole: 'member'
      })
    })

    it.each(['Officer', 'Leader'])(
      'accepts the app_role casing variant %s',
      async (role) => {
        const mockUser = createMockUser()
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: mockUser },
          error: null
        })
        mockFreshProfile(createMockProfile({ role }))

        const { requireRoleForApi } = await import('@/app/lib/auth')

        await expect(requireRoleForApi('officer')).resolves.toMatchObject({
          profile: { role }
        })
      }
    )
  })

  describe('refreshCurrentUser', () => {
    it('returns null when getUser fails', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Auth error' } as AuthError
      })

      const { refreshCurrentUser } = await import('@/app/lib/auth')
      const result = await refreshCurrentUser()

      expect(result).toBeNull()
    })

    it('returns updated user when successful', async () => {
      const mockUser = createMockUser({ email: 'updated@example.com' })
      const mockProfile = createMockProfile()

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })

      const { refreshCurrentUser } = await import('@/app/lib/auth')
      const result = await refreshCurrentUser()

      expect(result).not.toBeNull()
      expect(result?.email).toBe('updated@example.com')
    })
  })

  describe('Role inference', () => {
    it('uses profile role when available', async () => {
      const mockUser = createMockUser({
        user_metadata: { role: 'admin' }
      })
      const mockProfile = createMockProfile({ role: 'officer' })

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })

      const { getCurrentUser } = await import('@/app/lib/auth')
      const result = await getCurrentUser()

      expect(result?.role).toBe('officer')
    })

    it('falls back to user_metadata role when profile has no role', async () => {
      const mockUser = createMockUser({
        user_metadata: { role: 'leader' }
      })
      const mockProfile = createMockProfile({ role: undefined })

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })

      const { getCurrentUser } = await import('@/app/lib/auth')
      const result = await getCurrentUser()

      expect(result?.role).toBe('leader')
    })

    it('falls back to app_metadata role', async () => {
      const mockUser = createMockUser({
        app_metadata: { role: 'admin' }
      })
      const mockProfile = createMockProfile({ role: undefined })

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })

      const { getCurrentUser } = await import('@/app/lib/auth')
      const result = await getCurrentUser()

      expect(result?.role).toBe('admin')
    })

    it('defaults to member role when no role is found', async () => {
      const mockUser = createMockUser()
      const mockProfile = createMockProfile({ role: undefined })

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })

      const { getCurrentUser } = await import('@/app/lib/auth')
      const result = await getCurrentUser()

      expect(result?.role).toBe('member')
    })
  })

  describe('Display name resolution', () => {
    it('uses profile display_name when available', async () => {
      const mockUser = createMockUser({
        user_metadata: { display_name: 'MetaName' }
      })
      const mockProfile = createMockProfile({ display_name: 'ProfileName' })

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })

      const { getCurrentUser } = await import('@/app/lib/auth')
      const result = await getCurrentUser()

      expect(result?.displayName).toBe('ProfileName')
    })

    it('falls back to user_metadata display_name', async () => {
      const mockUser = createMockUser({
        user_metadata: { display_name: 'MetaName' }
      })
      const mockProfile = createMockProfile({ display_name: null })

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })

      const { getCurrentUser } = await import('@/app/lib/auth')
      const result = await getCurrentUser()

      expect(result?.displayName).toBe('MetaName')
    })

    it('falls back to email when no display name', async () => {
      const mockUser = createMockUser({ email: 'fallback@example.com' })
      const mockProfile = createMockProfile({ display_name: null })

      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null
      })

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: mockProfile,
                error: null
              })
            })
          })
        })
      })

      const { getCurrentUser } = await import('@/app/lib/auth')
      const result = await getCurrentUser()

      expect(result?.displayName).toBe('fallback@example.com')
    })
  })
})
