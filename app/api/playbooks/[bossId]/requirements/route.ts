import { NextResponse } from 'next/server'
import { requireAuthForApi } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import {
  checkFeatureAccess,
  getUserAccessLevels
} from '@/app/lib/services/feature-release-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.playbooks.bossId.requirements')
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

const normalizeHeroRequirements = (value: unknown) => {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => item && typeof item === 'object')
      }
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item === 'object')
}

export const GET = withErrorHandler(
  async (
    request: Request,
    { params }: { params: Promise<{ bossId: string }> }
  ) => {
    try {
      const { user } = await requireAuthForApi()
      const { bossId } = await params
      const access = await checkFeatureAccess(user.id, 'boss_playbooks')

      if (!access.has_access) {
        throw Errors.fromResponse(403, {
          error: 'Boss Playbooks requires alpha access',
          stage: access.stage,
          reason: access.reason
        })
      }

      const { searchParams } = new URL(request.url)
      const difficulty = searchParams.get('difficulty')
      const metaTeamId = searchParams.get('meta_team_id')
      const includeGuildSpecific =
        searchParams.get('include_guild_specific') !== 'false'

      const supabase = await db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabaseAny = supabase as any

      const accessLevels = await getUserAccessLevels(user.id)
      const userGuildCode = accessLevels.guild_code

      let query = supabaseAny
        .from('boss_playbook_team_requirements')
        .select('*')
        .eq('boss_id', bossId)
        .order('updated_at', { ascending: false })

      if (difficulty) {
        query = query.eq('difficulty', difficulty)
      }
      if (metaTeamId) {
        query = query.eq('meta_team_id', metaTeamId)
      }

      const { data, error } = await query

      if (error) {
        logger.error(
          { error, bossId, difficulty, metaTeamId },
          'Database query error'
        )
        throw Errors.fromResponse(500, { error: error.message })
      }

      const requirements = data || []
      logger.info(
        { count: requirements.length, bossId },
        'Fetched requirements'
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const normalizedRequirements = requirements.map((r: any) => {
        try {
          const normalized = {
            ...r,
            hero_requirements: normalizeHeroRequirements(r.hero_requirements),
            team_name: typeof r.team_name === 'string' ? r.team_name : null
          }
          return normalized
        } catch (err) {
          logger.error(
            {
              error: err,
              requirement_id: r.id,
              team_name_type: typeof r.team_name,
              hero_requirements_type: typeof r.hero_requirements
            },
            'Failed to normalize requirement'
          )
          return {
            ...r,
            hero_requirements: [],
            team_name: null
          }
        }
      })

      const clusterRequirements = normalizedRequirements.filter(
        (r: { guild_code?: string | null }) => !r.guild_code
      )
      const guildRequirements = includeGuildSpecific
        ? normalizedRequirements.filter(
            (r: { guild_code?: string | null }) =>
              r.guild_code === userGuildCode
          )
        : []

      return NextResponse.json({
        requirements: clusterRequirements,
        guild_requirements: guildRequirements,
        user_guild_code: userGuildCode
      })
    } catch (error) {
      rethrowIfAppError(error)
      rethrowIfAuthError(error)
      logger.error({ error }, 'Playbook requirements API error')
      throw Errors.fromResponse(500, { error: 'Failed to fetch requirements' })
    }
  }
)

export const POST = withErrorHandler(
  async (
    request: Request,
    { params }: { params: Promise<{ bossId: string }> }
  ) => {
    try {
      const { user } = await requireAuthForApi()
      const { bossId } = await params
      const supabase = await db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabaseAny = supabase as any
      const permission = await supabase.rpc('can_edit_playbooks', {
        user_id: user.id
      })

      if (!permission.data) {
        throw Errors.fromResponse(403, { error: 'Editor access required' })
      }

      const body = await request.json()
      const heroRequirements = normalizeHeroRequirements(body.hero_requirements)
      if (heroRequirements.length === 0) {
        throw Errors.fromResponse(400, {
          error: 'hero_requirements must be an array'
        })
      }

      const accessLevels = await getUserAccessLevels(user.id)
      const isGuildSpecific = Boolean(body.guild_specific)

      const payload = {
        boss_id: bossId,
        difficulty: body.difficulty ?? null,
        meta_team_id: body.meta_team_id ?? null,
        team_name: typeof body.team_name === 'string' ? body.team_name : null,
        hero_requirements: heroRequirements,
        overall_notes:
          typeof body.overall_notes === 'string' ? body.overall_notes : null,
        contributor_id: user.id,
        is_verified: Boolean(body.is_verified),
        cluster_code: accessLevels.cluster_code ?? null,
        guild_code: isGuildSpecific ? accessLevels.guild_code : null
      }

      const { data, error } = await supabaseAny
        .from('boss_playbook_team_requirements')
        .upsert(payload, {
          onConflict: 'boss_id,meta_team_id,guild_code,cluster_code'
        })
        .select()
        .single()

      if (error) {
        throw Errors.fromResponse(500, { error: error.message })
      }

      return NextResponse.json({ requirement: data })
    } catch (error) {
      rethrowIfAppError(error)
      rethrowIfAuthError(error)
      logger.error({ error }, 'Playbook requirements POST error')
      throw Errors.fromResponse(500, { error: 'Failed to save requirements' })
    }
  }
)
