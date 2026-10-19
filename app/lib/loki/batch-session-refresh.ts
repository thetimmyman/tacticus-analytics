import 'server-only'

import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.loki.batch-session-refresh')
import { createLokiClient } from './client'

/** Replaced even when accepted: a long-lived session can return a stale roster. */
export const SHARED_SESSION_MAX_AGE_MS = 30 * 60 * 1000

export interface StoredSharedSession {
  sessionId: string
  refreshedAt: string | null
  /** False when some cohort row holds another session or none. */
  allRowsMatch: boolean
}

export interface SharedSessionStore {
  read(): Promise<StoredSharedSession | null>
  /** Points every cohort row at `sessionId`; `connectedAt` restamps its age, so pass it after a CONNECT only. */
  write(sessionId: string, connectedAt: string | null): Promise<boolean>
}

export interface SharedSessionResult {
  sessionId: string | null
  /** The account whose CONNECT minted `sessionId`; null without a session. */
  userId: string | null
  connected: boolean
  reused: boolean
  error?: string
  durationMs: number
}

interface EnsureSharedSessionOptions {
  store: SharedSessionStore
  /** A guild_id from this run; null when no guild in it reaches LOKI. */
  probeGuildId: string | null
  fetchImpl?: typeof fetch
  now?: () => number
}

function isFresh(refreshedAt: string | null, now: number): boolean {
  const stamp = Date.parse(refreshedAt ?? '')
  if (!Number.isFinite(stamp)) return false
  const age = now - stamp
  // A future stamp (clock skew, bad write) counts as stale.
  return age >= 0 && age < SHARED_SESSION_MAX_AGE_MS
}

/** The shared LOKI session for one run: the stored one while the game accepts it, else one CONNECT. */
export async function ensureSharedLokiSession({
  store,
  probeGuildId,
  fetchImpl,
  now = Date.now
}: EnsureSharedSessionOptions): Promise<SharedSessionResult> {
  const startTime = Date.now()
  const userId = process.env.LOKI_SCRAPER_USER_ID
  const finish = (
    result: Omit<SharedSessionResult, 'durationMs' | 'userId'>
  ): SharedSessionResult => ({
    ...result,
    userId: result.sessionId ? userId || null : null,
    durationMs: Date.now() - startTime
  })

  const clientSecret = process.env.LOKI_SCRAPER_CLIENT_SECRET
  if (!userId || !clientSecret) {
    return finish({
      sessionId: null,
      connected: false,
      reused: false,
      error: 'LOKI_SCRAPER_USER_ID or LOKI_SCRAPER_CLIENT_SECRET not configured'
    })
  }
  if (!probeGuildId) {
    return finish({ sessionId: null, connected: false, reused: false })
  }

  const client = createLokiClient(
    { userId, sessionId: null, clientSecret },
    { fetchImpl }
  )

  try {
    const stored = await store.read()
    if (stored && isFresh(stored.refreshedAt, now())) {
      const check = await client.checkSession(stored.sessionId, probeGuildId)
      // 'unavailable' is no verdict: keep the session rather than CONNECT into an outage.
      if (check !== 'rejected') {
        if (check === 'valid' && !stored.allRowsMatch) {
          if (!(await store.write(stored.sessionId, null))) {
            logger.warn(
              '[batch-session-refresh] Could not point every guild at the shared LOKI session'
            )
          }
        }
        return finish({
          sessionId: stored.sessionId,
          connected: false,
          reused: true
        })
      }
    }

    const connect = await client.refreshSession()
    if (!connect.ok) {
      logger.error(
        { err: connect.error.message },
        '[batch-session-refresh] LOKI CONNECT failed'
      )
      return finish({
        sessionId: null,
        connected: false,
        reused: false,
        error: connect.error.message
      })
    }

    const sessionId = connect.data.sessionId
    if (!(await store.write(sessionId, new Date(now()).toISOString()))) {
      logger.warn(
        '[batch-session-refresh] Could not store the new LOKI session; guilds outside this run refresh their own'
      )
    }
    return finish({ sessionId, connected: true, reused: false })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(
      { err: message },
      '[batch-session-refresh] LOKI session check failed'
    )
    return finish({
      sessionId: null,
      connected: false,
      reused: false,
      error: message
    })
  }
}

interface RestSharedSessionStoreOptions {
  fetchImpl: typeof fetch
  baseUrl: string
  anonKey: string
  serviceKey: string
  scraperUserId: string
}

interface CohortSessionRow {
  session_id: string | null
  session_refreshed_at: string | null
}

/** The cohort is every guild_config row on the shared account: no user_id, or the scraper's. */
export function createRestSharedSessionStore(
  options: RestSharedSessionStoreOptions
): SharedSessionStore {
  const cohort = `or=(user_id.is.null,user_id.eq.${encodeURIComponent(options.scraperUserId)})`
  const headers = {
    apikey: options.anonKey,
    Authorization: `Bearer ${options.serviceKey}`,
    'Content-Type': 'application/json'
  }

  return {
    async read() {
      try {
        const response = await options.fetchImpl(
          `${options.baseUrl}/rest/v1/guild_config?select=session_id,session_refreshed_at&${cohort}&order=session_refreshed_at.desc.nullslast`,
          { method: 'GET', headers }
        )
        if (!response.ok) return null
        const rows = (await response.json()) as CohortSessionRow[]
        // A failed guild's row loses its session but keeps its stamp.
        const newest = rows.find((row) => row.session_id)
        if (!newest?.session_id) return null
        return {
          sessionId: newest.session_id,
          refreshedAt: newest.session_refreshed_at,
          allRowsMatch: rows.every(
            (row) => row.session_id === newest.session_id
          )
        }
      } catch {
        return null
      }
    },

    async write(sessionId, connectedAt) {
      try {
        // The session goes in the body only: URLs reach access logs.
        const response = await options.fetchImpl(
          `${options.baseUrl}/rest/v1/guild_config?${cohort}`,
          {
            method: 'PATCH',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({
              session_id: sessionId,
              ...(connectedAt ? { session_refreshed_at: connectedAt } : {}),
              updated_at: new Date().toISOString()
            })
          }
        )
        return response.ok
      } catch {
        return false
      }
    }
  }
}
