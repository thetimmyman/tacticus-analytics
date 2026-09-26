// Idempotent: the edge function only fills holes and upserts.

import { createDirectClient } from '@/app/lib/network/direct-supabase'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('lib.jobs.guild-historical-backfill')

interface BackfillResponse {
  success?: boolean
  stats?: {
    totalInserted?: number
    seasonsSuccessful?: number
  }
  results?: Array<{ season: number; success: boolean }>
  error?: string
}

const handler: JobHandler = async (payload, ctx) => {
  const guild_code =
    typeof payload.guild_code === 'string' ? payload.guild_code : ''
  if (!guild_code) {
    throw new Error('guild_historical_backfill: payload.guild_code is required')
  }

  const request: {
    guild_code: string
    force_seasons?: number[]
    max_seasons?: number
  } = { guild_code }
  if (payload.force_seasons !== undefined) {
    const seasons = payload.force_seasons
    if (
      !Array.isArray(seasons) ||
      seasons.length === 0 ||
      seasons.length > 20 ||
      seasons.some(
        (season) => !Number.isSafeInteger(season) || (season as number) <= 0
      ) ||
      new Set(seasons).size !== seasons.length
    ) {
      throw new Error(
        'guild_historical_backfill: payload.force_seasons is invalid'
      )
    }
    request.force_seasons = seasons as number[]
  }
  if (payload.max_seasons !== undefined) {
    const maxSeasons = payload.max_seasons
    if (
      !Number.isSafeInteger(maxSeasons) ||
      (maxSeasons as number) < 1 ||
      (maxSeasons as number) > 20
    ) {
      throw new Error(
        'guild_historical_backfill: payload.max_seasons is invalid'
      )
    }
    request.max_seasons = maxSeasons as number
  }

  const db = createDirectClient()
  const { data, error } = await db.invoke<BackfillResponse>(
    'historical-backfill-modular',
    request
  )

  // Invalid API key is permanent: succeed with a skip rather than burn retries.
  if (error && error.includes('API key is invalid')) {
    logger.info(
      { jobId: ctx.jobId, guild_code },
      'guild_historical_backfill: skipped — invalid API key (no retry)'
    )
    return { guild_code, skipped: true, reason: 'invalid_api_key' }
  }

  if (error) {
    throw new Error(`historical-backfill-modular invoke failed: ${error}`)
  }

  if (!data?.success) {
    throw new Error(
      `historical-backfill-modular reported failure for ${guild_code}: ${data?.error ?? 'no detail'}`
    )
  }

  const totalInserted = data.stats?.totalInserted ?? 0
  const seasonsProcessed = (data.results ?? [])
    .filter((result) => result.success)
    .map((result) => result.season)

  logger.info(
    {
      jobId: ctx.jobId,
      guild_code,
      totalInserted,
      seasonsProcessed
    },
    'guild_historical_backfill: complete'
  )

  return {
    guild_code,
    totalInserted,
    seasonsProcessed
  }
}

export function registerGuildHistoricalBackfillHandler(): void {
  registerJobHandler('guild_historical_backfill', handler)
}

export const __internal = { handler }
