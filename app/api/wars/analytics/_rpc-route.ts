import { NextRequest, NextResponse } from 'next/server'
import type { requireActiveMembershipForApi } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { parseGuildWarAnalyticsQuery } from './_query-helpers'

interface GuildWarAnalyticsRouteConfig {
  component: string
  defaultLimit: number
  failureMessage: string
  responseKey: 'heroes'
  rpc: 'get_hero_performance'
  requireMembership: typeof requireActiveMembershipForApi
}

export function createGuildWarAnalyticsRoute({
  component,
  defaultLimit,
  failureMessage,
  responseKey,
  rpc,
  requireMembership
}: GuildWarAnalyticsRouteConfig) {
  const logger = createComponentLogger(component)

  return withErrorHandler(async (request: NextRequest) => {
    const { profile } = await requireMembership()

    try {
      const guildCode = profile.guild_code
      if (!guildCode) {
        throw Errors.fromResponse(400, {
          error: 'No guild associated with user'
        })
      }

      const { side, limit, seasonCount } = parseGuildWarAnalyticsQuery(
        new URL(request.url).searchParams,
        { limit: defaultLimit }
      )
      const rpcArgs = {
        p_guild_code: guildCode,
        p_side: side,
        p_limit: limit,
        p_season_count: seasonCount
      }
      const supabase = serviceDb()
      const result = await supabase.rpc(rpc, rpcArgs)

      if (result.error) {
        logger.error({ error: result.error, guildCode, side }, failureMessage)
        throw Errors.fromResponse(500, { error: failureMessage })
      }

      return NextResponse.json({ [responseKey]: result.data || [] })
    } catch (error) {
      rethrowIfAppError(error)
      logger.error({ error }, `${component} API error`)
      throw Errors.fromResponse(500, { error: 'Internal server error' })
    }
  })
}
