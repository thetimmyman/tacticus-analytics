import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@tacticus/app-core/types'
import { serverEnv } from '@tacticus/app-core/server-env'
import { authConfig } from './config'
import { getSharedFetch } from '@/app/lib/network/undici-agent'

/** Use only getAll/setAll: per-cookie get/set/remove break auth. */
export async function createClient(): Promise<
  ReturnType<typeof createServerClient<Database>>
> {
  try {
    const cookieStore = await cookies()
    const siteUrl =
      process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || ''
    const isLocalhost =
      siteUrl.includes('localhost') || siteUrl.includes('127.0.0.1')
    const cookieDomain = isLocalhost ? undefined : '.tacticusanalytics.com'

    return createServerClient<Database>(
      serverEnv.SUPABASE_INTERNAL_URL,
      serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        global: { fetch: getSharedFetch() },
        auth: {
          storageKey: authConfig.session.storageKey
        },
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, {
                  ...options,
                  ...(cookieDomain && { domain: cookieDomain })
                })
              )
            } catch {
              // Called from a Server Component; middleware refreshes sessions.
            }
          }
        }
      }
    )
  } catch (_error) {
    return createServerClient<Database>(
      serverEnv.SUPABASE_INTERNAL_URL,
      serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        global: { fetch: getSharedFetch() },
        auth: {
          storageKey: authConfig.session.storageKey
        },
        cookies: {
          getAll() {
            return []
          },
          setAll() {
            // no-op
          }
        }
      }
    )
  }
}

/** Bypasses RLS: trusted server operations only. */
export function createServiceClient(
  signal?: AbortSignal
): ReturnType<typeof createServerClient<Database>> {
  const sharedFetch = getSharedFetch()
  const serviceFetch: typeof globalThis.fetch = signal
    ? (input, init) => sharedFetch(input, { ...init, signal })
    : sharedFetch
  return createServerClient<Database>(
    serverEnv.SUPABASE_INTERNAL_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      global: { fetch: serviceFetch },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      cookies: {
        getAll() {
          return []
        },
        setAll() {}
      }
    }
  )
}

/** Signed URLs carry the internal host; rewrite before returning to clients. */
export function toPublicSignedUrl(
  signedUrl: string | null | undefined
): string | null {
  if (!signedUrl) return null

  const internalUrl = serverEnv.SUPABASE_INTERNAL_URL
  const publicUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL

  if (internalUrl === publicUrl) return signedUrl

  if (signedUrl.startsWith(internalUrl)) {
    return signedUrl.replace(internalUrl, publicUrl)
  }

  try {
    const internalHost = new URL(internalUrl).host
    const publicHost = new URL(publicUrl).host
    return signedUrl.replace(internalHost, publicHost)
  } catch {
    return signedUrl
  }
}
