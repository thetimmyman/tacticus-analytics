import 'server-only'

// Waste comes from pace aggregates; the planner's `metrics.wastedTokens` is an optimistic lower bound.

import { mainCache } from '@tacticus/app-core/unified-cache'
import { createComponentLogger } from '@/app/lib/logging'
import { deduplicateRequest } from '@/app/lib/utils/request-deduplication'
import { generateSeasonPlanForGuild } from '@/app/lib/boss-assignments/season-planner/generate-season-plan'
import { reduceSeasonOutlookDetail } from '@/app/lib/season-forecast/season-outlook-reduce'

export type {
  SeasonOutlookProjection,
  SeasonOutlookDetail
} from '@/app/lib/season-forecast/season-outlook-reduce'

import type {
  SeasonOutlookProjection,
  SeasonOutlookDetail
} from '@/app/lib/season-forecast/season-outlook-reduce'

const logger = createComponentLogger('season-forecast.outlook')

const OUTLOOK_CACHE_TTL_MS = 15 * 60_000
// Failures are cached briefly so a broken guild does not re-run the planner every render.
const OUTLOOK_NEG_CACHE_TTL_MS = 3 * 60_000

interface OutlookCacheEntry {
  detail: SeasonOutlookDetail | null
}

export interface ComputeSeasonOutlookArgs {
  guildCode: string
  season: string
  skipCache?: boolean
}

/** Null on any failure. PRIVACY: `detail.players` identifies members; member-facing surfaces must
 * scope it via outlook-player-scope before serialization, or use computeSeasonOutlook. */
export async function computeSeasonOutlookDetail(
  args: ComputeSeasonOutlookArgs
): Promise<SeasonOutlookDetail | null> {
  const seasonNumber = Number.parseInt(args.season, 10)
  if (!args.guildCode || !Number.isFinite(seasonNumber) || seasonNumber <= 0) {
    return null
  }

  const fetcher = async (): Promise<SeasonOutlookDetail | null> => {
    try {
      const payload = await generateSeasonPlanForGuild({
        guildCode: args.guildCode,
        season: args.season,
        snapshotAt: new Date().toISOString(),
        lookbackDays: 30,
        // Matches the 12h-regen cadence, so twice-a-day players show no fake waste.
        sessionsPerDay: 2
      })

      return reduceSeasonOutlookDetail(payload, {
        guildCode: args.guildCode,
        seasonNumber,
        nowMs: Date.now()
      })
    } catch (err) {
      logger.warn(
        { err, guildCode: args.guildCode, season: seasonNumber },
        'season-outlook projection failed'
      )
      return null
    }
  }

  if (args.skipCache) return fetcher()

  const cacheKey = `season-outlook:${args.guildCode}:${seasonNumber}`
  const cached = mainCache.get(cacheKey) as OutlookCacheEntry | null
  if (cached) return cached.detail ?? null

  // Single-flight is per pod; cross-pod cost is bounded only by the TTLs.
  const detail = await deduplicateRequest(cacheKey, fetcher, 30_000)
  mainCache.set(cacheKey, { detail } satisfies OutlookCacheEntry, {
    ttl: detail ? OUTLOOK_CACHE_TTL_MS : OUTLOOK_NEG_CACHE_TTL_MS,
    priority: 'medium',
    tags: [
      'season-outlook',
      `guild:${args.guildCode}`,
      `season:${seasonNumber}`
    ]
  })
  return detail
}

export async function computeSeasonOutlook(
  args: ComputeSeasonOutlookArgs
): Promise<SeasonOutlookProjection | null> {
  const detail = await computeSeasonOutlookDetail(args)
  return detail?.projection ?? null
}

// A cache-miss sim run must never hang first paint or an API response.
export const SEASON_OUTLOOK_TIMEOUT_MS = 7000

/** Same privacy contract on `players` as computeSeasonOutlookDetail. */
export async function computeSeasonOutlookDetailWithTimeout(
  args: ComputeSeasonOutlookArgs,
  timeoutMs: number = SEASON_OUTLOOK_TIMEOUT_MS
): Promise<SeasonOutlookDetail | null> {
  return Promise.race([
    computeSeasonOutlookDetail(args).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  ])
}

export async function computeSeasonOutlookWithTimeout(
  args: ComputeSeasonOutlookArgs,
  timeoutMs: number = SEASON_OUTLOOK_TIMEOUT_MS
): Promise<SeasonOutlookProjection | null> {
  const detail = await computeSeasonOutlookDetailWithTimeout(args, timeoutMs)
  return detail?.projection ?? null
}
