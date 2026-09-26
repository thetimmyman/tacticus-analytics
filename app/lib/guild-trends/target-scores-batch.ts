import 'server-only'

import { appCache } from '@tacticus/app-core/app-cache'
import { getGuildTokenPerformance } from '@/app/lib/data/guild-token-performance'
import { aggregateByPlayer } from '@/app/lib/boss-assignments/performance-leaderboard-aggregate'
import { getLatestSeason } from '@/app/lib/utils/season'
import { createComponentLogger } from '@/app/lib/logging'
import {
  CLOSED_SEASON_TTL_SECONDS,
  CURRENT_SEASON_TTL_SECONDS
} from '@/app/lib/season-date/ttl'
import type { TargetScoreRow } from '@/app/lib/calculations/experimental/player-season-rankings'
import { sleep } from '@/app/lib/utils/async-timeout'

/** Computed in TS because boss HP is a TS constant; an in-flight sentinel coalesces cold misses. */

const logger = createComponentLogger('lib.guild-trends.target-scores-batch')

const MAX_SEASONS = 5
const INFLIGHT_TTL_SECONDS = 30
const INFLIGHT_POLL_ATTEMPTS = 10
const INFLIGHT_POLL_INTERVAL_MS = 500

const RESULT_KEY_PREFIX = 'gtrends:target:season'
const INFLIGHT_KEY_PREFIX = 'gtrends:target:inflight'

const resultKey = (guildCode: string, season: string) =>
  `${RESULT_KEY_PREFIX}:${guildCode}:${season}`
const inflightKey = (guildCode: string, season: string) =>
  `${INFLIGHT_KEY_PREFIX}:${guildCode}:${season}`

async function computeSeason(
  guildCode: string,
  season: string
): Promise<TargetScoreRow[]> {
  const data = await getGuildTokenPerformance(guildCode, {
    seasonOverride: season,
    includeHistoricalPlayers: true
  })
  const out: TargetScoreRow[] = []
  for (const row of aggregateByPlayer(data)) {
    // Must be the Tacticus player id so the client name-join lines up.
    const userId = (row.playerId ?? row.playerKey ?? '').trim()
    if (!userId) continue
    out.push({ season, user_id: userId, weighted_score: row.weightedScore })
  }
  return out
}

async function getSeasonScores(
  guildCode: string,
  season: string,
  latestSeason: string | null
): Promise<TargetScoreRow[]> {
  const rKey = resultKey(guildCode, season)

  try {
    const hit = await appCache.get<TargetScoreRow[]>(rKey)
    if (hit) return hit
  } catch (err) {
    logger.warn(
      { guildCode, season, err: err instanceof Error ? err.message : err },
      'target cache get failed; treating as miss'
    )
  }

  // Poll while another request holds the slot, then compute anyway so a dead holder can't deadlock us.
  const iKey = inflightKey(guildCode, season)
  let acquired = true
  try {
    acquired = await appCache.setNx(iKey, '1', INFLIGHT_TTL_SECONDS)
  } catch {
    acquired = true
  }

  if (!acquired) {
    for (let i = 0; i < INFLIGHT_POLL_ATTEMPTS; i++) {
      await sleep(INFLIGHT_POLL_INTERVAL_MS)
      try {
        const hit = await appCache.get<TargetScoreRow[]>(rKey)
        if (hit) return hit
      } catch {
        // keep polling
      }
    }
  }

  try {
    const rows = await computeSeason(guildCode, season)
    const ttl =
      season === latestSeason
        ? CURRENT_SEASON_TTL_SECONDS
        : CLOSED_SEASON_TTL_SECONDS
    try {
      await appCache.set(rKey, rows, ttl)
    } catch (err) {
      logger.warn(
        { guildCode, season, err: err instanceof Error ? err.message : err },
        'target cache set failed; rows served uncached'
      )
    }
    return rows
  } finally {
    try {
      await appCache.del(iKey)
    } catch {
      // The sentinel expires on its own.
    }
  }
}

export async function getTargetScoresBatch(
  guildCode: string,
  seasons: string[]
): Promise<TargetScoreRow[]> {
  if (!guildCode || seasons.length === 0) return []

  let effectiveSeasons = seasons
  if (seasons.length > MAX_SEASONS) {
    logger.warn(
      { guildCode, requested: seasons.length, cap: MAX_SEASONS },
      'target-scores-batch: capping seasons to bound server scans'
    )
    effectiveSeasons = seasons.slice(0, MAX_SEASONS)
  }

  const latestSeason = await getLatestSeason()
  const perSeason = await Promise.all(
    effectiveSeasons.map((season) =>
      getSeasonScores(guildCode, season, latestSeason)
    )
  )
  return perSeason.flat()
}
