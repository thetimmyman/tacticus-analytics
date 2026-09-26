import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { parseTeamComposition } from '@/app/lib/meta/team-coverage'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { appCache } from '@tacticus/app-core/app-cache'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('api.meta.team-heroes')

export const dynamic = 'force-dynamic'

const TEAM_HEROES_TTL_SECONDS = 10 * 60
const MAX_TEAMS = 12
// Top compositions only, keeping rare long-tail heroes out of the filter.
const COMPOSITION_SCAN_LIMIT = 80
const TOP_UNIQUE_COMPOSITIONS = 10
const MIN_ATTACK_COUNT = 5

/** Service role because `meta_atlas_data` is RLS-locked to service_role. */
export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const rawTeams = request.nextUrl.searchParams.get('teams') || ''
    const teams = Array.from(
      new Set(
        rawTeams
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      )
    ).slice(0, MAX_TEAMS)

    if (teams.length === 0) {
      return NextResponse.json({ heroesByTeam: {}, heroes: [] })
    }

    const cacheKey = `meta_team_heroes:v1:${[...teams].sort().join('|')}`
    const cached = await appCache.get<{
      heroesByTeam: Record<string, string[]>
      heroes: string[]
    }>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const supabase = serviceDb()

    // Per team so a high-volume team cannot starve a shared row cap.
    const perTeam = await Promise.all(
      teams.map(async (team) => {
        const { data, error } = await supabase
          .from('meta_atlas_data')
          .select('team_composition, damage_p90')
          .eq('meta_team', team)
          .gte('attack_count', MIN_ATTACK_COUNT)
          .not('team_composition', 'is', null)
          .order('damage_p90', { ascending: false })
          .limit(COMPOSITION_SCAN_LIMIT)

        if (error) {
          throw error
        }

        const seenCompositions = new Set<string>()
        const heroes = new Set<string>()

        for (const row of data || []) {
          const composition = row.team_composition
          if (!composition || seenCompositions.has(composition)) continue
          if (seenCompositions.size >= TOP_UNIQUE_COMPOSITIONS) break
          seenCompositions.add(composition)

          const { heroes: rowHeroes, mow } = parseTeamComposition(composition)
          for (const hero of rowHeroes) {
            const name = hero.trim().toLowerCase()
            if (name) heroes.add(name)
          }
          if (mow) {
            const name = mow.trim().toLowerCase()
            if (name) heroes.add(name)
          }
        }

        return [team, Array.from(heroes)] as const
      })
    )

    const heroesByTeam: Record<string, string[]> = {}
    const union = new Set<string>()
    for (const [team, heroes] of perTeam) {
      heroesByTeam[team] = heroes
      for (const h of heroes) union.add(h)
    }

    const responseBody = { heroesByTeam, heroes: Array.from(union) }
    await appCache.set(cacheKey, responseBody, TEAM_HEROES_TTL_SECONDS)
    return NextResponse.json(responseBody)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Meta team-heroes error')
    throw Errors.fromResponse(500, {
      error: 'Failed to fetch meta team heroes'
    })
  }
})
