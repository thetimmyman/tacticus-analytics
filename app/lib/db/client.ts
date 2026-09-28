import {
  createAuthenticatedDataClient,
  createBrowserClient,
  createStorageClient
} from '@/app/lib/auth/browser'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@tacticus/app-core/types'

export function dbClient(): SupabaseClient<Database> {
  return createBrowserClient()
}

export function storageClient(): SupabaseClient<Database> {
  return createStorageClient()
}

/**
 * Queries can fire before session hydration: throwing makes React Query retry, while
 * returning empty would cache a spurious result. Concurrent calls share one getSession()
 * or the auth-js processLock queue starves parallel callers.
 */
let sessionCheckInFlight: Promise<void> | null = null
let sessionAccessToken: string | null = null
let authenticatedDataClient: SupabaseClient<Database> | null = null

export async function assertClientSession(): Promise<void> {
  if (!sessionCheckInFlight) {
    sessionCheckInFlight = (async () => {
      const { data, error } = await dbClient().auth.getSession()
      if (error) {
        sessionAccessToken = null
        throw error
      }
      if (!data.session) {
        sessionAccessToken = null
        throw new Error(
          'AUTH_PENDING: Supabase session not hydrated yet — retrying. ' +
            'Guild analytics are not anonymously readable.'
        )
      }
      sessionAccessToken = data.session.access_token
    })().finally(() => {
      sessionCheckInFlight = null
    })
  }
  return sessionCheckInFlight
}

/** Uses the captured token instead of a getSession() per request; no usable `auth`. */
export function authenticatedDbClient(): SupabaseClient<Database> {
  if (!authenticatedDataClient) {
    authenticatedDataClient = createAuthenticatedDataClient(async () => {
      if (!sessionAccessToken) {
        throw new Error(
          'AUTH_PENDING: Authenticated data client has no session token.'
        )
      }
      return sessionAccessToken
    })
  }
  return authenticatedDataClient
}
