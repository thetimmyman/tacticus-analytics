import { NextResponse } from 'next/server'
import { requireAuthForApi } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.strength-overrides')
import playbooks from '@/data/boss-playbooks/playbooks.json'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

type Boss = {
  id: string
  name: string
}

const normalizeKey = normalizeIdentifier

const resolveBossId = (value: string | null) => {
  if (!value) return null
  const normalized = normalizeKey(value)
  const bosses = playbooks.bosses as Boss[]
  const direct = bosses.find((boss) => normalizeKey(boss.id) === normalized)
  if (direct) return direct.id
  const byName = bosses.find((boss) => normalizeKey(boss.name) === normalized)
  return byName?.id ?? null
}

export const GET = withErrorHandler(async (request: Request) => {
  try {
    const { user } = await requireAuthForApi()
    const access = await checkFeatureAccess(user.id, 'boss_playbooks')

    if (!access.has_access) {
      throw Errors.fromResponse(403, {
        error: 'Boss Playbooks requires alpha access',
        stage: access.stage,
        reason: access.reason
      })
    }

    const { searchParams } = new URL(request.url)
    const bossIdParam = searchParams.get('boss_id')
    const bossType = searchParams.get('boss_type')
    const bossName = searchParams.get('boss_name')
    const metaTeamIdParam = searchParams.get('meta_team_id')
    const metaTeamName = searchParams.get('meta_team')
    const difficulty = searchParams.get('difficulty')

    const bossId =
      bossIdParam || resolveBossId(bossType) || resolveBossId(bossName)
    if (!bossId) {
      throw Errors.fromResponse(400, {
        error: 'boss_id or boss_type is required'
      })
    }

    const supabase = await db()
    let metaTeamId = metaTeamIdParam

    if (!metaTeamId && metaTeamName) {
      const { data: metaTeam, error: metaError } = await supabase
        .from('meta_teams')
        .select('id')
        .eq('team_name', metaTeamName)
        .maybeSingle()
      if (metaError) {
        logger.warn(
          { metaTeamName, metaError },
          'Failed to resolve meta team id'
        )
      }
      metaTeamId = metaTeam?.id ?? null
    }

    if (!metaTeamId) {
      return NextResponse.json({ overrides: null })
    }

    let query = supabase
      .from('boss_playbook_team_requirements')
      .select(
        'id, boss_id, difficulty, meta_team_id, team_name, hero_requirements, overall_notes, updated_at'
      )
      .eq('boss_id', bossId)
      .eq('meta_team_id', metaTeamId)
      .order('updated_at', { ascending: false })
      .limit(1)

    if (difficulty) {
      query = query.eq('difficulty', difficulty)
    }

    const { data, error } = await query.maybeSingle()

    if (error) {
      throw Errors.fromResponse(500, { error: error.message })
    }

    return NextResponse.json({ overrides: data || null })
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ error }, 'Strength overrides API error')
    throw Errors.fromResponse(500, {
      error: 'Failed to fetch strength overrides'
    })
  }
})
