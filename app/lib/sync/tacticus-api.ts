import { withRetry, TACTICUS_API_POLICY } from '@/app/lib/resilience'
import { withProviderRetry } from '@/app/lib/network/provider-metrics'
import {
  extractGuildRosterEvidence,
  type GuildRosterEvidence
} from '@/supabase/functions/_shared/guild-roster-evidence'
import {
  CONFIG,
  fetchWithAbortTimeout,
  fetchWithCircuitBreaker,
  logger
} from './api-client'

export type TacticusMembersResult = GuildRosterEvidence

export async function fetchGuildMembersViaTacticus(
  apiKey: string,
  guildId: string,
  guildCode: string,
  guildPayload?: unknown
): Promise<TacticusMembersResult> {
  if (guildPayload !== undefined)
    return extractGuildRosterEvidence(guildPayload, guildId)
  if (!guildId) return extractGuildRosterEvidence(null, guildId)
  const url = `${CONFIG.api.baseUrl}/guild`

  try {
    logger.info(
      { guildCode },
      'Reading guild membership from the documented guild response'
    )

    let requestAttempt = 0
    const response = await withRetry(
      () =>
        withProviderRetry(requestAttempt++ > 0, async () => {
          const res = await fetchWithAbortTimeout(
            url,
            {
              method: 'GET',
              headers: {
                'X-API-KEY': apiKey,
                Accept: 'application/json'
              }
            },
            CONFIG.api.requestTimeout,
            'Tacticus guild roster response'
          )
          if (!res.ok) {
            try {
              void res.body?.cancel().catch(() => {})
            } catch {}
          }
          if (!res.ok && res.status >= 500)
            throw new Error(`HTTP ${res.status}`)
          return res
        }),
      { ...TACTICUS_API_POLICY, maxAttempts: 2 }
    )

    if (!response.ok) {
      if (response.status === 404) {
        logger.info({ guildCode }, 'Tacticus guild response returned 404')
        return { success: false, memberIds: [], error: 'Endpoint not found' }
      }
      return { success: false, memberIds: [], error: `HTTP ${response.status}` }
    }

    return extractGuildRosterEvidence(await response.json(), guildId)
  } catch (error) {
    const message =
      error instanceof Error &&
      ['AbortError', 'TimeoutError'].includes(error.name)
        ? 'Guild roster request timed out'
        : 'Guild roster unavailable'
    logger.warn({ guildCode }, message)
    return { success: false, memberIds: [], error: message }
  }
}

export async function fetchGuildRaidData(
  apiKey: string,
  guildCode: string
): Promise<Response> {
  logger.info({ guildCode }, 'Fetching guild raid data...')
  return fetchWithCircuitBreaker(
    `${CONFIG.api.baseUrl}/guildRaid`,
    {
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json'
      }
    },
    3,
    CONFIG.api.requestTimeout
  )
}
