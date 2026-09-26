import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextRequest, NextResponse } from 'next/server'
import { requireRoleForApi } from '@/app/lib/auth'
import { db, serviceDb } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import {
  findVerifiedDiscordForMapping,
  resolveVerifiedDiscordIdentities
} from '@/app/lib/auth/verified-player-authority'

/** Officer-only. Snowflakes are returned only after proving ownership plus a live provider identity. */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { profile } = await requireRoleForApi('officer')
  const requestedGuild = normalizeGuildIdentifier(
    new URL(request.url).searchParams.get('guild_code')
  )
  const guildCode = normalizeGuildIdentifier(profile.guild_code)
  if (!requestedGuild || !guildCode) {
    throw Errors.forbidden(
      'Verified Discord members are limited to your guild or cluster'
    )
  }

  if (requestedGuild !== guildCode) {
    const callerDb = await db()
    const { data: clusterGuilds, error: clusterScopeError } =
      await callerDb.rpc('_pm_caller_cluster_guild_codes')
    if (clusterScopeError) {
      throw Errors.internal('Unable to verify cluster guild access')
    }
    const canAccessRequestedGuild = (clusterGuilds ?? []).some(
      (candidateGuild) =>
        normalizeGuildIdentifier(candidateGuild) === requestedGuild
    )
    if (!canAccessRequestedGuild) {
      throw Errors.forbidden(
        'Verified Discord members are limited to your guild or cluster'
      )
    }
  }

  const supabase = serviceDb()
  const { data, error } = await guildRosterQuery(
    supabase,
    requestedGuild,
    'id, user_id, player_id, guild_code, display_name, discord_username, discord_user_id'
  ).not('discord_user_id', 'is', null)
  if (error) {
    throw Errors.internal('Unable to resolve verified Discord members')
  }

  const candidates = data ?? []
  const verified = await resolveVerifiedDiscordIdentities(
    supabase,
    candidates
      .map((row) => row.discord_user_id)
      .filter((id): id is string => Boolean(id))
  )
  const members = candidates.flatMap((row) => {
    const identity = findVerifiedDiscordForMapping(verified, {
      mappingId: row.id,
      playerId: row.player_id,
      userId: row.user_id,
      guildCode: row.guild_code,
      discordUserId: row.discord_user_id
    })
    return identity
      ? [
          {
            display_name: row.display_name,
            discord_username: row.discord_username,
            discord_user_id: identity.discordUserId
          }
        ]
      : []
  })

  return NextResponse.json({ members })
})
