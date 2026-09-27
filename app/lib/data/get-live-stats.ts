import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.data.get-live-stats')
import { apiCache } from '@tacticus/app-core/unified-cache'
import { LIVE_STATS_CACHE_TTL } from '@/app/lib/constants/time-constants'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

export interface LiveStats {
  activePlayers: number
  battlesTracked: number
  guilds: number
  totalDamage: number
}

type SupabaseServerClient = TypedSupabaseClient

type ClientFactory = () => Promise<SupabaseServerClient> | SupabaseServerClient

interface RawLiveStats {
  active_players?: number | string | null
  activePlayers?: number | string | null
  battles_tracked?: number | string | null
  battlesTracked?: number | string | null
  guild_count?: number | string | null
  guilds?: number | string | null
  total_damage?: number | string | null
  total_damage_dealt?: number | string | null
  totalDamage?: number | string | null
}

interface StatsFetchError {
  code?: string
  message?: string
}

interface StatsFetchResult {
  stats: LiveStats | null
  error?: StatsFetchError
}

const FALLBACK_STATS: LiveStats = {
  activePlayers: 12902,
  battlesTracked: 2326450,
  guilds: 331,
  totalDamage: 425682450890
}

function coerceNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeStats(
  raw: RawLiveStats | null | undefined
): LiveStats | null {
  if (!raw) return null

  const activePlayers = coerceNumber(raw.active_players ?? raw.activePlayers)
  const battlesTracked = coerceNumber(raw.battles_tracked ?? raw.battlesTracked)
  const guilds = coerceNumber(raw.guild_count ?? raw.guilds)
  const totalDamage = coerceNumber(
    raw.total_damage ?? raw.total_damage_dealt ?? raw.totalDamage
  )

  return {
    activePlayers: Math.max(0, activePlayers),
    battlesTracked: Math.max(0, battlesTracked),
    guilds: Math.max(0, guilds),
    totalDamage: Math.max(0, totalDamage)
  }
}

function hasMeaningfulStats(
  stats: LiveStats | null | undefined
): stats is LiveStats {
  if (!stats) return false
  return stats.activePlayers > 0 && stats.battlesTracked > 0 && stats.guilds > 0
}

const FUNCTION_NOT_FOUND_CODES = new Set(['42883', 'PGRST202', 'PGRST302'])
const STATEMENT_TIMEOUT_CODE = '57014'

async function fetchStatsWithClient(
  clientFactory: ClientFactory,
  source: 'anon' | 'service',
  rpcName: 'get_public_stats' | 'get_public_stats_cached'
): Promise<StatsFetchResult> {
  try {
    const client = await clientFactory()
    const { data, error } = await client.rpc(rpcName)

    if (error) {
      const code = (error as { code?: string })?.code
      const logFn =
        code && FUNCTION_NOT_FOUND_CODES.has(code) ? logger.debug : logger.error
      logFn(
        { err: error, rpcName, source },
        'Error fetching public stats via RPC'
      )
      return {
        stats: null,
        error: {
          code,
          message: (error as { message?: string })?.message
        }
      }
    }

    const normalized = normalizeStats(data as RawLiveStats | null)

    if (!normalized) {
      logger.error(
        `Live stats RPC returned empty payload (${rpcName}, ${source} client)`
      )
      return { stats: null }
    }

    return { stats: normalized }
  } catch (error) {
    logger.error(
      { err: error },
      `Unexpected error retrieving live stats (${rpcName}, ${source} client):`
    )
    return {
      stats: null,
      error: {
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

export async function getLiveStats(): Promise<LiveStats> {
  try {
    const cached = await apiCache.getOrFetch(
      'live_stats',
      async () => {
        const rpcCandidates: Array<{
          name: 'get_public_stats' | 'get_public_stats_cached'
          requireMeaningful?: boolean
        }> = [{ name: 'get_public_stats' }]

        let lastNonMeaningful: LiveStats | null = null

        for (const candidate of rpcCandidates) {
          const anonResult = await fetchStatsWithClient(
            db,
            'anon',
            candidate.name
          )

          if (anonResult.stats) {
            if (
              !candidate.requireMeaningful ||
              hasMeaningfulStats(anonResult.stats)
            ) {
              return anonResult.stats
            }

            lastNonMeaningful = anonResult.stats
            logger.debug(
              `Live stats via anon client returned minimal data for ${candidate.name}; evaluating fallback.`
            )
          }

          const errorCode = anonResult.error?.code

          if (errorCode && FUNCTION_NOT_FOUND_CODES.has(errorCode)) {
            logger.debug(`RPC ${candidate.name} not available; skipping.`)
            continue
          }

          if (errorCode === STATEMENT_TIMEOUT_CODE) {
            logger.warn(
              `RPC ${candidate.name} timed out for anon client; skipping service retry to avoid duplicate load.`
            )
            continue
          }

          try {
            const serviceResult = await fetchStatsWithClient(
              serviceDb,
              'service',
              candidate.name
            )

            if (serviceResult.stats) {
              if (
                !candidate.requireMeaningful ||
                hasMeaningfulStats(serviceResult.stats)
              ) {
                return serviceResult.stats
              }

              lastNonMeaningful = serviceResult.stats
            }

            const serviceErrorCode = serviceResult.error?.code

            if (
              serviceErrorCode &&
              FUNCTION_NOT_FOUND_CODES.has(serviceErrorCode)
            ) {
              logger.debug(
                `RPC ${candidate.name} not available for service client; skipping.`
              )
            }

            if (serviceErrorCode === STATEMENT_TIMEOUT_CODE) {
              logger.warn(
                `RPC ${candidate.name} timed out for service client as well.`
              )
            }

            if (serviceResult.stats) {
              continue
            }
          } catch (serviceError) {
            logger.error(
              { err: serviceError },
              `Failed to fetch live stats with service client for ${candidate.name}:`
            )
          }
        }

        if (lastNonMeaningful) {
          return lastNonMeaningful
        }

        return FALLBACK_STATS
      },
      {
        ttl: LIVE_STATS_CACHE_TTL.MEDIUM_SHORT,
        priority: 'high',
        tags: ['live_stats', 'public_stats']
      }
    )
    return cached as LiveStats
  } catch (error) {
    logger.error({ err: error }, 'Error fetching live stats:')
    return FALLBACK_STATS
  }
}
