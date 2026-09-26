import { db } from '@/app/lib/db'
import { logger } from '@/app/lib/war/logger'
import { Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'

type Db = Awaited<ReturnType<typeof db>>

export interface WarAccess {
  guildCode: string
  warId: string
}

export type WarAccessOptions =
  { shape: 'war-first'; endpoint: string } | { shape: 'membership-first' }

type WarRouteParams = { params: Promise<{ warId: string }> }

export async function requireWarFirstRouteContext(
  { params }: WarRouteParams,
  endpoint: string
): Promise<WarAccess & { supabase: Db }> {
  const { warId } = await params
  if (!warId) {
    throw Errors.invalidRequest('warId is required', { endpoint })
  }

  const supabase = await db()
  const access = await requireWarAccess(supabase, warId, {
    shape: 'war-first',
    endpoint
  })
  return { ...access, supabase }
}

/**
 * Two orderings kept on purpose (unifying them changes user-visible errors):
 * `war-first` fetches the war then checks guild, so a foreign war is 403;
 * `membership-first` queries guild-scoped, so a foreign war is 404.
 */
export async function requireWarAccess(
  supabase: Db,
  warId: string,
  opts: WarAccessOptions
): Promise<WarAccess> {
  if (opts.shape === 'war-first') {
    const endpoint = opts.endpoint
    const user = await requireSessionUser(supabase, () =>
      Errors.authenticationRequired('Authentication required', { endpoint })
    )

    const { data: warMatch, error: warError } = await supabase
      .from('guild_war_matches')
      .select('war_id, guild_code')
      .eq('war_id', warId)
      .limit(1)
      .maybeSingle()

    if (warError) {
      logger.error('Failed to fetch war match', { error: warError, warId })
      throw Errors.database('Failed to fetch war data', { endpoint })
    }

    if (!warMatch) {
      throw Errors.notFound('War', 'War not found')
    }

    const { data: profile } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('guild_code')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .single()

    if (!profile || profile.guild_code !== warMatch.guild_code) {
      throw Errors.insufficientPermissions(
        'You do not have access to this war',
        { endpoint }
      )
    }

    return { guildCode: warMatch.guild_code, warId: warMatch.war_id }
  }

  const user = await requireSessionUser(supabase, () =>
    Errors.fromResponse(401, { error: 'Unauthorized' })
  )

  const { data: playerMapping, error: membershipError } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('guild_code')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .maybeSingle()

  if (membershipError || !playerMapping?.guild_code) {
    throw Errors.fromResponse(403, { error: 'No guild membership found' })
  }

  const { data: warMatch } = await supabase
    .from('guild_war_matches')
    .select('guild_code, war_id')
    .eq('war_id', warId)
    .eq('guild_code', playerMapping.guild_code)
    .single()

  if (!warMatch) {
    throw Errors.fromResponse(404, { error: 'War not found' })
  }

  return { guildCode: playerMapping.guild_code, warId: warMatch.war_id }
}
