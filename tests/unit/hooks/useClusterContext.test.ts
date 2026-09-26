import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: vi.fn()
}))

describe('useClusterContext Hooks', () => {
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    auth: {
      getUser: ReturnType<typeof vi.fn>
      onAuthStateChange: ReturnType<typeof vi.fn>
    }
  }
  let mockUnsubscribe: ReturnType<typeof vi.fn>
  let authChangeCallback:
    ((event: string, session: { user?: { id: string } } | null) => void) | null

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockUnsubscribe = vi.fn()
    authChangeCallback = null

    mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                guild_code: 'TEST',
                cluster_code: 'EOT',
                role: 'member',
                display_name: 'Test User',
                theme_preference: null
              },
              error: null
            })
          })
        })
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } }
        }),
        onAuthStateChange: vi.fn().mockImplementation((callback) => {
          authChangeCallback = callback
          return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
        })
      }
    }
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('useClusterContext', () => {
    it('should return initial loading state', async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useClusterContext } =
        await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useClusterContext())

      expect(result.current.isLoading).toBe(true)
      expect(result.current.guildCode).toBe('')
      expect(result.current.clusterCode).toBe(null)

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })

    it('should fetch user profile on mount', async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useClusterContext } =
        await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useClusterContext())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.guildCode).toBe('TEST')
      expect(result.current.clusterCode).toBe('EOT')
      expect(result.current.role).toBe('member')
      expect(result.current.displayName).toBe('Test User')
    })

    it('should return empty context when no user', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null }
      })

      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useClusterContext } =
        await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useClusterContext())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.guildCode).toBe('')
      expect(result.current.userId).toBe(null)
    })

    it('should update context on auth state change', async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useClusterContext } =
        await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useClusterContext())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                guild_code: 'NEW',
                cluster_code: 'NEW_CLUSTER',
                role: 'leader',
                display_name: 'New User'
              },
              error: null
            })
          })
        })
      })

      await act(async () => {
        authChangeCallback?.('SIGNED_IN', { user: { id: 'new-user-456' } })
      })

      await waitFor(() => {
        expect(result.current.guildCode).toBe('NEW')
      })
    })

    it('should unsubscribe from auth on unmount', async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useClusterContext } =
        await import('@/app/hooks/useClusterContext')
      const { unmount } = renderHook(() => useClusterContext())

      await waitFor(() => {
        expect(mockSupabase.auth.onAuthStateChange).toHaveBeenCalled()
      })

      unmount()

      expect(mockUnsubscribe).toHaveBeenCalled()
    })

    it('should handle profile with null cluster code', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                guild_code: 'SOLO',
                cluster_code: null,
                role: 'officer',
                display_name: 'Solo Player'
              },
              error: null
            })
          })
        })
      })

      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useClusterContext } =
        await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useClusterContext())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.guildCode).toBe('SOLO')
      expect(result.current.clusterCode).toBe(null)
    })
  })

  describe('useClusterCode', () => {
    it('should return cluster code from context', async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useClusterCode } = await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useClusterCode())

      await waitFor(() => {
        expect(result.current).toBe('EOT')
      })
    })
  })

  describe('useGuildCode', () => {
    it('should return guild code from context', async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useGuildCode } = await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useGuildCode())

      await waitFor(() => {
        expect(result.current).toBe('TEST')
      })
    })
  })

  describe('useUserRole', () => {
    it('should return user role from context', async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useUserRole } = await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useUserRole())

      await waitFor(() => {
        expect(result.current).toBe('member')
      })
    })
  })

  describe('useIsOfficerOrLeader', () => {
    it('should return true for officer', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { guild_code: 'TEST', role: 'officer' },
              error: null
            })
          })
        })
      })

      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useIsOfficerOrLeader } =
        await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useIsOfficerOrLeader())

      await waitFor(() => {
        expect(result.current).toBe(true)
      })
    })

    it('should return true for leader', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { guild_code: 'TEST', role: 'leader' },
              error: null
            })
          })
        })
      })

      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useIsOfficerOrLeader } =
        await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useIsOfficerOrLeader())

      await waitFor(() => {
        expect(result.current).toBe(true)
      })
    })

    it('should return false for member', async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useIsOfficerOrLeader } =
        await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useIsOfficerOrLeader())

      await waitFor(() => {
        expect(result.current).toBe(false)
      })
    })
  })

  describe('useIsLeader', () => {
    it('should return true only for leader role', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { guild_code: 'TEST', role: 'leader' },
              error: null
            })
          })
        })
      })

      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useIsLeader } = await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useIsLeader())

      await waitFor(() => {
        expect(result.current).toBe(true)
      })
    })
  })

  describe('useUserThemePreference', () => {
    it('should return theme preference when set', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                guild_code: 'TEST',
                theme_preference: 'dark_imperium'
              },
              error: null
            })
          })
        })
      })

      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useUserThemePreference } =
        await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useUserThemePreference())

      await waitFor(() => {
        expect(result.current).toBe('dark_imperium')
      })
    })

    it('should fallback to guild code when no theme preference', async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue(mockSupabase as never)

      const { useUserThemePreference } =
        await import('@/app/hooks/useClusterContext')
      const { result } = renderHook(() => useUserThemePreference())

      await waitFor(() => {
        expect(result.current).toBe('TEST')
      })
    })
  })
})
