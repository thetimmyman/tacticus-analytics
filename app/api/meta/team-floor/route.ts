import { NextResponse } from 'next/server'
import { parseJsonBody } from '@/app/lib/api/parse-json-body'
import { db, serviceDb } from '@/app/lib/db'
import { requireFeatureAccess } from '@/app/lib/services/feature-access-gate'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.team-floor')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { withRetry } from '@/app/lib/resilience/with-retry'
import { RetryConditions } from '@/app/lib/resilience/retry-policy'

interface FloorRow {
  team_hash: string
  unit_id: string
  min_rank_name: string | null
  min_rank_index: number | null
  min_stars: number | null
  sample_hits: number | null
  sample_players: number | null
  p90_damage: number | null
}

export const POST = withErrorHandler(async (request: Request) => {
  const buildFallbackResponse = (
    context: {
      team_hash?: string
      boss_type?: string
      boss_unit_id?: string | null
      encounter_index?: number | null
      rarity_set?: string
      season?: string
    },
    reason = 'team_floor_unavailable'
  ) =>
    NextResponse.json({
      team_hash: context.team_hash ?? '',
      boss_type: context.boss_type ?? '',
      boss_unit_id: context.boss_unit_id ?? null,
      encounter_index:
        typeof context.encounter_index === 'number'
          ? context.encounter_index
          : 0,
      rarity_set: context.rarity_set ?? '',
      season: context.season ?? '',
      p90_damage: null,
      sample_hits: 0,
      sample_players: 0,
      units: [],
      unavailable: true,
      error: reason
    })

  let context: {
    team_hash?: string
    boss_type?: string
    boss_unit_id?: string | null
    encounter_index?: number | null
    rarity_set?: string
    season?: string
  } = {}

  try {
    const body = await parseJsonBody(request, () =>
      Errors.validation('Invalid request body', {
        endpoint: '/api/meta/team-floor'
      })
    )
    const {
      team_hash,
      boss_type,
      boss_unit_id,
      encounter_index,
      rarity_set,
      season
    } = (body || {}) as {
      team_hash?: string
      boss_type?: string
      boss_unit_id?: string | null
      encounter_index?: number | string | null
      rarity_set?: string
      season?: string
    }

    const parsedEncounter =
      typeof encounter_index === 'number'
        ? encounter_index
        : Number.parseInt(String(encounter_index), 10)

    if (
      !team_hash ||
      !boss_type ||
      !rarity_set ||
      !season ||
      !Number.isFinite(parsedEncounter)
    ) {
      throw Errors.fromResponse(400, {
        error:
          'team_hash, boss_type, rarity_set, season, and encounter_index are required'
      })
    }

    context = {
      team_hash,
      boss_type,
      boss_unit_id: boss_unit_id ?? null,
      encounter_index: parsedEncounter,
      rarity_set,
      season
    }

    const authSupabase = await db()
    const user = await requireSessionUser(authSupabase, () =>
      Errors.fromResponse(401, { error: 'Authentication required' })
    )

    await requireFeatureAccess(
      user.id,
      'meta_atlas',
      'Meta Atlas feature access required'
    )

    const supabase = serviceDb()

    const { data, error } = await withRetry(
      async () => {
        const result = await supabase.rpc('get_meta_atlas_team_floor', {
          p_team_hash: team_hash,
          p_boss_type: boss_type,
          p_boss_unit_id: boss_unit_id ?? undefined,
          p_encounter_index: parsedEncounter,
          p_rarity_set: rarity_set,
          p_season: season
        })
        // Throw only transient errors so withRetry retries them.
        if (
          result.error &&
          (result.error.message?.includes('schema cache') ||
            result.error.message?.includes('connection') ||
            result.error.message?.includes('timeout'))
        ) {
          throw new Error(result.error.message)
        }
        return result
      },
      {
        maxAttempts: 3,
        strategy: 'exponential',
        baseDelayMs: 500,
        maxDelayMs: 3000,
        retryOn: RetryConditions.any(
          RetryConditions.networkErrors,
          RetryConditions.serverErrors
        ),
        context: { operationName: 'get_meta_atlas_team_floor' }
      }
    )

    if (error) {
      logger.error({ error }, 'Meta Atlas team floor RPC failed')
      return buildFallbackResponse(context, 'team_floor_unavailable')
    }

    const rows = Array.isArray(data) ? (data as unknown as FloorRow[]) : []
    if (rows.length === 0) {
      return NextResponse.json({
        team_hash,
        boss_type,
        boss_unit_id: boss_unit_id ?? null,
        encounter_index: parsedEncounter,
        rarity_set,
        season,
        p90_damage: null,
        sample_hits: 0,
        sample_players: 0,
        units: []
      })
    }

    const firstRow = rows[0]
    if (!firstRow) {
      return NextResponse.json({
        team_hash,
        boss_type,
        boss_unit_id: boss_unit_id ?? null,
        encounter_index: parsedEncounter,
        rarity_set,
        season,
        p90_damage: null,
        sample_hits: 0,
        sample_players: 0,
        units: []
      })
    }

    const { p90_damage, sample_hits, sample_players } = firstRow
    const units = rows.map((row) => ({
      unit_id: row.unit_id,
      min_rank_name: row.min_rank_name ?? null,
      min_rank_index:
        typeof row.min_rank_index === 'number' ? row.min_rank_index : null,
      min_stars: typeof row.min_stars === 'number' ? row.min_stars : null
    }))

    return NextResponse.json({
      team_hash,
      boss_type,
      boss_unit_id: boss_unit_id ?? null,
      encounter_index: parsedEncounter,
      rarity_set,
      season,
      p90_damage: typeof p90_damage === 'number' ? p90_damage : null,
      sample_hits: typeof sample_hits === 'number' ? sample_hits : 0,
      sample_players: typeof sample_players === 'number' ? sample_players : 0,
      units
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Meta Atlas team floor error')
    return buildFallbackResponse(context, 'team_floor_unavailable')
  }
})
