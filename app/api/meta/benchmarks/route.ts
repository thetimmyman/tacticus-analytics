import { NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.benchmarks')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export interface MetaBenchmark {
  team_hash: string
  team_composition: string
  meta_team: string | null
  boss_type: string
  sub_boss_name: string
  encounter_type: string
  rarity: string
  season: string
  attack_count: number
  damage_max: number
  damage_p90: number
  damage_p75: number
  damage_avg: number
}

export interface BenchmarkComparison {
  benchmark: MetaBenchmark | null
  user_damage?: number
  percentile?: number
  vs_avg?: number
  vs_p75?: number
  vs_p90?: number
}

export const GET = withErrorHandler(async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const teamHash = searchParams.get('team_hash')
  const bossType = searchParams.get('boss_type')
  const rarity = searchParams.get('rarity')
  const season = searchParams.get('season')
  const userDamage = searchParams.get('user_damage')

  if (!teamHash || !bossType) {
    throw Errors.fromResponse(400, {
      error: 'team_hash and boss_type are required'
    })
  }

  let damage: number | null = null
  if (userDamage !== null && userDamage !== '') {
    damage = Number(userDamage)
    if (!Number.isFinite(damage) || damage < 0) {
      throw Errors.fromResponse(400, {
        error: 'user_damage must be a non-negative number'
      })
    }
  }

  try {
    const supabase = serviceDb()

    let query = supabase
      .from('meta_atlas_data')
      .select('*')
      .eq('team_hash', teamHash)
      .eq('boss_type', bossType)

    if (rarity) query = query.eq('rarity', rarity)
    if (season) query = query.eq('season', season)

    const { data, error } = await query
      .order('attack_count', { ascending: false })
      .limit(1)

    if (error) throw error

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const benchmark: MetaBenchmark | null = (data as any)?.[0] ?? null

    const response: BenchmarkComparison = { benchmark }

    if (benchmark && damage !== null) {
      response.user_damage = damage

      // Omitted for zero/negative baselines rather than NaN/Infinity.
      const pctDelta = (base: number): number | undefined =>
        base > 0 ? Math.round(((damage - base) / base) * 100) : undefined
      response.vs_avg = pctDelta(benchmark.damage_avg)
      response.vs_p75 = pctDelta(benchmark.damage_p75)
      response.vs_p90 = pctDelta(benchmark.damage_p90)

      let percentile: number
      if (damage >= benchmark.damage_max) {
        percentile = 100
      } else if (damage >= benchmark.damage_p90) {
        percentile =
          90 +
          ((damage - benchmark.damage_p90) /
            (benchmark.damage_max - benchmark.damage_p90)) *
            10
      } else if (damage >= benchmark.damage_p75) {
        percentile =
          75 +
          ((damage - benchmark.damage_p75) /
            (benchmark.damage_p90 - benchmark.damage_p75)) *
            15
      } else if (damage >= benchmark.damage_avg) {
        percentile =
          50 +
          ((damage - benchmark.damage_avg) /
            (benchmark.damage_p75 - benchmark.damage_avg)) *
            25
      } else if (benchmark.damage_avg > 0) {
        percentile = (damage / benchmark.damage_avg) * 50
      } else {
        percentile = 0
      }
      if (Number.isFinite(percentile)) {
        response.percentile = Math.round(Math.min(100, Math.max(0, percentile)))
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Meta benchmarks error')
    throw Errors.fromResponse(500, { error: 'Failed to fetch benchmarks' })
  }
})
