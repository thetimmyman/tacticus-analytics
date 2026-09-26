import { NextResponse } from 'next/server'
import { requireAuthForApi } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.strength-overrides.batch')
import type { Database } from '@tacticus/app-core/types'
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

type BatchRequest = {
  bossType?: string | null
  bossName?: string | null
  metaTeam: string
}

type StrengthOverrideRow = Pick<
  Database['public']['Tables']['boss_playbook_team_requirements']['Row'],
  | 'id'
  | 'boss_id'
  | 'difficulty'
  | 'meta_team_id'
  | 'team_name'
  | 'hero_requirements'
  | 'overall_notes'
  | 'updated_at'
>

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

export const POST = withErrorHandler(async (request: Request) => {
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

    const body = await request.json()
    const requests = body.requests as BatchRequest[] | undefined

    if (!Array.isArray(requests) || requests.length === 0) {
      throw Errors.fromResponse(400, { error: 'requests array is required' })
    }

    if (requests.length > 50) {
      throw Errors.fromResponse(400, { error: 'Maximum 50 requests per batch' })
    }

    const supabase = await db()

    const uniqueMetaTeams = [
      ...new Set(requests.map((r) => r.metaTeam).filter(Boolean))
    ]
    const { data: metaTeams, error: metaError } = await supabase
      .from('meta_teams')
      .select('id, team_name')
      .in('team_name', uniqueMetaTeams)

    if (metaError) {
      logger.warn({ metaError }, 'Failed to resolve meta team ids')
    }

    const metaTeamIdMap = new Map<string, string>()
    metaTeams?.forEach((mt) => {
      if (mt.team_name && mt.id) {
        metaTeamIdMap.set(mt.team_name, mt.id)
      }
    })

    const resolvedRequests = requests.map((req) => {
      const bossId =
        resolveBossId(req.bossType ?? null) ||
        resolveBossId(req.bossName ?? null)
      const metaTeamId = req.metaTeam ? metaTeamIdMap.get(req.metaTeam) : null
      return {
        originalBossType: req.bossType,
        originalBossName: req.bossName,
        originalMetaTeam: req.metaTeam,
        bossId,
        metaTeamId
      }
    })

    const validRequests = resolvedRequests.filter(
      (r) => r.bossId && r.metaTeamId
    )

    if (validRequests.length === 0) {
      return NextResponse.json({ results: {} })
    }

    const bossIds = [...new Set(validRequests.map((r) => r.bossId!))]
    const metaTeamIds = [...new Set(validRequests.map((r) => r.metaTeamId!))]

    const { data, error } = await supabase
      .from('boss_playbook_team_requirements')
      .select(
        'id, boss_id, difficulty, meta_team_id, team_name, hero_requirements, overall_notes, updated_at'
      )
      .in('boss_id', bossIds)
      .in('meta_team_id', metaTeamIds)
      .order('updated_at', { ascending: false })

    if (error) {
      throw Errors.fromResponse(500, { error: error.message })
    }

    const rows = (data ?? []) as StrengthOverrideRow[]

    const overrideLookup = new Map<string, StrengthOverrideRow>()
    rows.forEach((row) => {
      const key = `${row.boss_id}:${row.meta_team_id}`
      if (!overrideLookup.has(key)) {
        overrideLookup.set(key, row)
      }
    })

    const results: Record<string, StrengthOverrideRow | null> = {}
    resolvedRequests.forEach((req) => {
      const requestKey = `${req.originalBossType || req.originalBossName}:${req.originalMetaTeam}`
      if (req.bossId && req.metaTeamId) {
        const lookupKey = `${req.bossId}:${req.metaTeamId}`
        results[requestKey] = overrideLookup.get(lookupKey) ?? null
      } else {
        results[requestKey] = null
      }
    })

    return NextResponse.json({ results })
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ error }, 'Batch strength overrides API error')
    throw Errors.fromResponse(500, {
      error: 'Failed to fetch strength overrides'
    })
  }
})
