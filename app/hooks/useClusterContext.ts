'use client'

import { useState, useEffect, useCallback } from 'react'
import { dbClient } from '@/app/lib/db/client'

export type UserRole = 'member' | 'officer' | 'leader' | null

export interface ClusterContext {
  guildCode: string
  clusterCode: string | null
  isLoading: boolean
  userId: string | null
  role: UserRole
  displayName: string | null
  themePreference: string | null
}

interface PlayerProfileData {
  guild_code?: string
  cluster_code?: string | null
  role?: string
  display_name?: string | null
  theme_preference?: string | null
}

interface CachedContext {
  data: ClusterContext
  timestamp: number
}

const CACHE_DURATION = 5 * 60 * 1000
let cachedContext: CachedContext | null = null
// Concurrent mounts share one in-flight fetch; the module cache fills only
// after the first resolves.
let inflightFetch: Promise<ClusterContext> | null = null
let inflightUserId: string | null = null

export function useClusterContext(): ClusterContext {
  const [mounted, setMounted] = useState(false)
  const [context, setContext] = useState<ClusterContext>({
    guildCode: '',
    clusterCode: null,
    isLoading: true,
    userId: null,
    role: null,
    displayName: null,
    themePreference: null
  })

  const fetchContext = useCallback(async (userId: string | null) => {
    if (!userId) {
      const result = {
        guildCode: '',
        clusterCode: null,
        isLoading: false,
        userId: null,
        role: null as UserRole,
        displayName: null,
        themePreference: null
      }
      setContext(result)
      cachedContext = null
      inflightFetch = null
      inflightUserId = null
      return
    }

    if (
      cachedContext &&
      cachedContext.data.userId === userId &&
      Date.now() - cachedContext.timestamp < CACHE_DURATION
    ) {
      setContext({ ...cachedContext.data, isLoading: false })
      return
    }

    if (inflightFetch && inflightUserId === userId) {
      const shared = await inflightFetch
      setContext(shared)
      return
    }

    inflightUserId = userId
    inflightFetch = (async () => {
      const supabase = dbClient()
      const { data: profile, error } = await supabase
        .from('player_with_cluster')
        .select(
          'guild_code, cluster_code, role, display_name, theme_preference'
        )
        .eq('user_id', userId)
        .single()

      if (error) {
        return {
          guildCode: '',
          clusterCode: null,
          isLoading: false,
          userId,
          role: null as UserRole,
          displayName: null,
          themePreference: null
        }
      }

      const result = profile as PlayerProfileData | null
      const newContext: ClusterContext = {
        guildCode: result?.guild_code || '',
        clusterCode: result?.cluster_code ?? null,
        isLoading: false,
        userId,
        role: (result?.role as UserRole) ?? null,
        displayName: result?.display_name ?? null,
        themePreference: result?.theme_preference ?? null
      }

      cachedContext = { data: newContext, timestamp: Date.now() }
      return newContext
    })()

    try {
      const resolved = await inflightFetch
      setContext(resolved)
    } finally {
      if (inflightUserId === userId) {
        inflightFetch = null
        inflightUserId = null
      }
    }
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const supabase = dbClient()

    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        fetchContext(user?.id ?? null)
      })
      .catch(() => {
        setContext((prev) => ({ ...prev, isLoading: false }))
      })

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Ignore TOKEN_REFRESHED: refetching on it loops and floods the auth service.
      if (event === 'TOKEN_REFRESHED') {
        return
      }

      if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'USER_UPDATED'
      ) {
        cachedContext = null
        fetchContext(session?.user?.id ?? null)
      }
    })

    return () => subscription.unsubscribe()
  }, [mounted, fetchContext])

  return context
}

export function useClusterCode(): string | null {
  const { clusterCode } = useClusterContext()
  return clusterCode
}

/** Empty string when not in a guild. */
export function useGuildCode(): string {
  const { guildCode } = useClusterContext()
  return guildCode
}

export function useUserRole(): UserRole {
  const { role } = useClusterContext()
  return role
}

/** Falls back to the guild code when no explicit preference is set. */
export function useUserThemePreference(): string | null {
  const { themePreference, guildCode } = useClusterContext()
  return themePreference || guildCode || null
}

export function useIsOfficerOrLeader(): boolean {
  const { role } = useClusterContext()
  return role === 'officer' || role === 'leader'
}

export function useIsLeader(): boolean {
  const { role } = useClusterContext()
  return role === 'leader'
}
