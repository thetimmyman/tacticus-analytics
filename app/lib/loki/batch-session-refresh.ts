import 'server-only'

import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.loki.batch-session-refresh')
import { createLokiClient } from './client'
import type { LokiCredentials } from './types'

export interface BatchSessionRefreshResult {
  success: boolean
  sessionId: string | null
  error?: string
  durationMs: number
}

interface BatchSessionRefreshOptions {
  fetchImpl?: typeof fetch
}

/** One shared-account LOKI CONNECT per batch cycle, instead of one per guild. */
export async function refreshSharedLokiSession(
  options: BatchSessionRefreshOptions = {}
): Promise<BatchSessionRefreshResult> {
  const startTime = Date.now()
  const userId = process.env.LOKI_SCRAPER_USER_ID
  const clientSecret = process.env.LOKI_SCRAPER_CLIENT_SECRET

  if (!userId || !clientSecret) {
    return {
      success: false,
      sessionId: null,
      error:
        'LOKI_SCRAPER_USER_ID or LOKI_SCRAPER_CLIENT_SECRET not configured',
      durationMs: Date.now() - startTime
    }
  }

  const credentials: LokiCredentials = {
    userId,
    sessionId: null,
    clientSecret
  }

  try {
    const client = createLokiClient(credentials, {
      retryAttempts: 2,
      retryDelayMs: 1000,
      fetchImpl: options.fetchImpl
    })

    const result = await client.refreshSession()

    if (result.ok && result.data.sessionId) {
      return {
        success: true,
        sessionId: result.data.sessionId,
        durationMs: Date.now() - startTime
      }
    }

    const errorMsg = result.ok
      ? 'No sessionId in response'
      : result.error.message
    logger.error(
      { err: errorMsg },
      '[batch-session-refresh] LOKI CONNECT failed:'
    )
    return {
      success: false,
      sessionId: null,
      error: errorMsg,
      durationMs: Date.now() - startTime
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(
      { err: msg },
      '[batch-session-refresh] Exception during LOKI CONNECT:'
    )
    return {
      success: false,
      sessionId: null,
      error: msg,
      durationMs: Date.now() - startTime
    }
  }
}
