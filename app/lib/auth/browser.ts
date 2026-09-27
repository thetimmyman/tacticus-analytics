'use client'

import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr'
import type { Database } from '@tacticus/app-core/types'
import {
  createClient as createSupabaseDataClient,
  processLock,
  type SupabaseClient
} from '@supabase/supabase-js'
import { authConfig } from './config'

// Build-time defaults; real env vars replace them at runtime.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://api.tacticusanalytics.com'
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

// Singleton: multiple instances cause token refresh storms.
let browserClientInstance: SupabaseClient<Database> | null = null

export async function settledProcessLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>
): Promise<R> {
  const outcome = await processLock(name, acquireTimeout, async () => {
    try {
      return { success: true as const, value: await fn() }
    } catch (error) {
      return { success: false as const, error }
    }
  })

  if (!outcome.success) throw outcome.error
  return outcome.value
}

export function createClient(): SupabaseClient<Database> {
  if (browserClientInstance) {
    return browserClientInstance
  }

  if (
    typeof window !== 'undefined' &&
    (!process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  ) {
    throw new Error(
      'Missing required Supabase environment variables. Please check your configuration.'
    )
  }

  // Cookie domain only in production (cross-subdomain auth); localhost uses the request origin.
  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1')
  const cookieOptions = isLocalhost
    ? { path: '/', sameSite: 'lax' as const, secure: false }
    : {
        domain: '.tacticusanalytics.com',
        path: '/',
        sameSite: 'lax' as const,
        secure: true
      }

  browserClientInstance = createSupabaseBrowserClient<Database>(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      global: {
        // No global `Prefer: return=representation`: `RETURNING *` hits column-grant-withheld
        // guild_config columns (42501). Opt in per call with .select('<explicit columns>').
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      },
      cookieOptions,
      auth: {
        // Fixed key; the default derives from the Supabase URL hostname and breaks across hosts.
        storageKey: authConfig.session.storageKey,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        // processLock, not navigator.locks, which aborts under contention on mobile and breaks
        // sign-in. Its timeouts are retried by withTransientAuthRetry; weaker cross-tab refresh
        // coordination is accepted (auth-js tolerates concurrent refreshes).
        // Settle fn inside processLock so its internal queue promise cannot reject unhandled.
        lock: settledProcessLock
      }
    }
  )

  return browserClientInstance
}

export { createClient as createBrowserClient }

/**
 * Data-only client for high-fanout reads that resolve the session once, avoiding the per-request
 * getSession() lock queue. Its auth namespace is intentionally unavailable.
 */
export function createAuthenticatedDataClient(
  accessToken: () => Promise<string | null>
): SupabaseClient<Database> {
  return createSupabaseDataClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    accessToken,
    global: {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    }
  })
}

let storageClientInstance: SupabaseClient<Database> | null = null

/** Sets no Content-Type header so file uploads work. */
export function createStorageClient(): SupabaseClient<Database> {
  if (storageClientInstance) {
    return storageClientInstance
  }

  if (
    typeof window !== 'undefined' &&
    (!process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  ) {
    throw new Error(
      'Missing required Supabase environment variables. Please check your configuration.'
    )
  }

  storageClientInstance = createSupabaseBrowserClient<Database>(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        storageKey: authConfig.session.storageKey,
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
        // Same lock as the main client so the two singletons coordinate in-process.
        lock: settledProcessLock
      }
    }
  )

  return storageClientInstance
}
