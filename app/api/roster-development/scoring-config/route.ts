import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.roster-development.scoring-config')
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  requireSessionUser,
  resolveCurrentMembership
} from '@/app/lib/api/session-user'
import { isOfficerLeaderOrAdminRole } from '@/app/lib/auth/role-predicates'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
export const dynamic = 'force-dynamic'

type PrimarySource = 'playbook' | 'global_thresholds'

const DEFAULT_TIERS = { optimal: 100, strong: 80, suitable: 60 }
const DEFAULT_RARITY_SETS = ['M1', 'L5']

const isPrimarySource = (value: unknown): value is PrimarySource =>
  value === 'playbook' || value === 'global_thresholds'

const rankRaritySet = (value: string) => {
  const match = value.match(/^([LM])(\d+)$/i)
  if (!match) return -1
  const prefix = match[1]?.toUpperCase()
  const setNumber = Number.parseInt(match[2] ?? '', 10)
  if (!prefix || !Number.isFinite(setNumber)) return -1
  return (prefix === 'M' ? 100 : 0) + setNumber
}

const parseTierValue = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

const fetchAvailableRaritySets = async (supabase: TypedSupabaseClient) => {
  const { data, error } = (await supabase.rpc(
    'get_meta_atlas_distinct_rarity_sets'
  )) as unknown as {
    data: Array<{ rarity_set?: string | null }> | null
    error: unknown
  }

  if (!error && Array.isArray(data)) {
    const sorted = data
      .map((row) => row.rarity_set ?? null)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => rankRaritySet(b) - rankRaritySet(a))
    if (sorted.length > 0) return sorted
  }

  return DEFAULT_RARITY_SETS
}

const loadConfigRow = async (
  supabase: TypedSupabaseClient,
  guildCode: string
) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('guild_roster_scoring_config')
    .select(
      'primary_source, strength_target_rarity_set, tier_optimal_pct, tier_strong_pct, tier_suitable_pct'
    )
    .eq('guild_code', guildCode)
    .maybeSingle()

  if (error) {
    logger.warn(
      { error, guildCode },
      'Failed to load guild_roster_scoring_config'
    )
  }

  return data ?? null
}

const buildConfigResponse = (
  guildCode: string,
  configRow: Record<string, unknown> | null,
  availableRaritySets: string[],
  canEdit: boolean
) => {
  const defaultRaritySet = availableRaritySets[0] ?? null

  const primarySource = isPrimarySource(configRow?.primary_source)
    ? (configRow?.primary_source as PrimarySource)
    : 'playbook'

  const rawRaritySet = configRow?.strength_target_rarity_set
  const strengthTargetRaritySet =
    typeof rawRaritySet === 'string' &&
    availableRaritySets.includes(rawRaritySet)
      ? rawRaritySet
      : defaultRaritySet

  const tierOptimal = parseTierValue(
    configRow?.tier_optimal_pct,
    DEFAULT_TIERS.optimal
  )
  const tierStrong = parseTierValue(
    configRow?.tier_strong_pct,
    DEFAULT_TIERS.strong
  )
  const tierSuitable = parseTierValue(
    configRow?.tier_suitable_pct,
    DEFAULT_TIERS.suitable
  )

  return {
    guild_code: guildCode,
    config: {
      primary_source: primarySource,
      strength_target_rarity_set: strengthTargetRaritySet,
      tier_optimal_pct: tierOptimal,
      tier_strong_pct: tierStrong,
      tier_suitable_pct: tierSuitable
    },
    available_rarity_sets: availableRaritySets,
    default_rarity_set: defaultRaritySet,
    can_edit: canEdit
  }
}

export const GET = withErrorHandler(async (_request: NextRequest) => {
  try {
    const supabase = await db()
    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, { error: 'Authentication required' })
    )

    const access = await checkFeatureAccess(user.id, 'roster_development')
    if (!access.has_access) {
      throw Errors.fromResponse(403, {
        error: 'Roster development access required'
      })
    }

    const profile = await resolveCurrentMembership(supabase, user.id)

    if (!profile?.guild_code) {
      throw Errors.fromResponse(403, {
        error: 'Profile not found or access denied'
      })
    }

    const serviceClient = serviceDb()
    const [configRow, availableRaritySets] = await Promise.all([
      loadConfigRow(serviceClient, profile.guild_code),
      fetchAvailableRaritySets(serviceClient)
    ])

    return NextResponse.json(
      buildConfigResponse(
        profile.guild_code,
        configRow,
        availableRaritySets,
        isOfficerLeaderOrAdminRole(profile.role)
      )
    )
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'scoring-config GET error')
    throw Errors.fromResponse(500, { error: 'Failed to load scoring settings' })
  }
})

export const PUT = withErrorHandler(async (request: NextRequest) => {
  try {
    const supabase = await db()
    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, { error: 'Authentication required' })
    )

    const access = await checkFeatureAccess(user.id, 'roster_development')
    if (!access.has_access) {
      throw Errors.fromResponse(403, {
        error: 'Roster development access required'
      })
    }

    const profile = await resolveCurrentMembership(supabase, user.id)

    if (!profile?.guild_code) {
      throw Errors.fromResponse(403, {
        error: 'Profile not found or access denied'
      })
    }

    if (!isOfficerLeaderOrAdminRole(profile.role)) {
      throw Errors.fromResponse(403, { error: 'Insufficient permissions' })
    }

    const body = await request.json()

    if (!isPrimarySource(body?.primary_source)) {
      throw Errors.fromResponse(400, { error: 'Invalid primary_source value' })
    }

    const tierOptimal = parseTierValue(
      body?.tier_optimal_pct,
      DEFAULT_TIERS.optimal
    )
    const tierStrong = parseTierValue(
      body?.tier_strong_pct,
      DEFAULT_TIERS.strong
    )
    const tierSuitable = parseTierValue(
      body?.tier_suitable_pct,
      DEFAULT_TIERS.suitable
    )

    if (tierOptimal < tierStrong || tierStrong < tierSuitable) {
      throw Errors.fromResponse(400, {
        error: 'Tier thresholds must satisfy: optimal >= strong >= suitable'
      })
    }

    const serviceClient = serviceDb()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upsertError } = await (serviceClient as any)
      .from('guild_roster_scoring_config')
      .upsert(
        {
          guild_code: profile.guild_code,
          primary_source: body.primary_source,
          strength_target_rarity_set: body.strength_target_rarity_set ?? null,
          tier_optimal_pct: tierOptimal,
          tier_strong_pct: tierStrong,
          tier_suitable_pct: tierSuitable,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'guild_code' }
      )

    if (upsertError) {
      logger.error(
        { error: upsertError, guildCode: profile.guild_code },
        'scoring-config PUT upsert failed'
      )
      throw Errors.fromResponse(500, {
        error: 'Failed to save scoring settings'
      })
    }

    const [configRow, availableRaritySets] = await Promise.all([
      loadConfigRow(serviceClient, profile.guild_code),
      fetchAvailableRaritySets(serviceClient)
    ])

    return NextResponse.json(
      buildConfigResponse(
        profile.guild_code,
        configRow,
        availableRaritySets,
        true
      )
    )
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'scoring-config PUT error')
    throw Errors.fromResponse(500, { error: 'Failed to save scoring settings' })
  }
})
