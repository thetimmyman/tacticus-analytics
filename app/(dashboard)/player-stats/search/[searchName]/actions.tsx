'use server'

import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { db, serviceDb } from '@/app/lib/db'
import { isAppAdminProfile } from '@/app/lib/auth/app-admin'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('player-stats.search.searchName.actions')
import type { ComprehensivePlayerStats } from '@/app/lib/player-stats/comprehensive-stats-types'
import type { PlayerMapping } from '@tacticus/app-core/types'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'

export interface PlayerStatsServerContext {
  resolvedGuild: string
  resolvedGuildName: string
  resolvedClusterCode: string | null
  mapping: PlayerMapping | null
}

export interface PlayerStatsServerResult {
  stats: ComprehensivePlayerStats | null
  context: PlayerStatsServerContext | null
  error: string | null
}

export async function fetchPlayerStats(
  searchName: string,
  guild: string,
  season: string
): Promise<PlayerStatsServerResult> {
  const supabase = await db()

  // Authorization: users may only view guilds in their own cluster.
  try {
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user) {
      return { stats: null, context: null, error: 'Unauthorized' }
    }

    const { data: profile, error: profileError } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('cluster_code, guild_code, role, is_app_admin')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()

    if (profileError) {
      logger.warn(
        { userId: user.id },
        'Current membership lookup failed in fetchPlayerStats'
      )
      return {
        stats: null,
        context: null,
        error: 'Authorization check failed.'
      }
    }

    if (!profile) {
      logger.warn(
        { userId: user.id },
        'Blocked player stats access without a current membership'
      )
      return {
        stats: null,
        context: null,
        error: 'You are not authorized to view stats for this guild.'
      }
    }

    const role = (profile.role || '').toLowerCase()
    // `is_app_admin` is the admin flag; app_role has no 'admin', so never compare role to it.
    if (!isAppAdminProfile(profile)) {
      const userGuild = profile.guild_code

      if (!userGuild) {
        logger.warn(
          { userId: user.id },
          'Blocked player stats access without a current guild membership'
        )
        return {
          stats: null,
          context: null,
          error: 'You are not authorized to view stats for this guild.'
        }
      }

      // Own-guild access comes from the mapping; cluster metadata is only needed for a peer guild.
      if (userGuild === guild) {
        logger.info(
          {
            userId: user.id,
            userGuild,
            requestedGuild: guild,
            role
          },
          'Player stats own-guild auth check'
        )
      } else {
        const guildConfig = await GuildConfigService.getBasic(
          supabase,
          userGuild
        )
        const userCluster = guildConfig?.cluster_code ?? null

        logger.info(
          {
            userId: user.id,
            userGuild,
            userCluster,
            requestedGuild: guild,
            role
          },
          'Player stats cross-guild auth check'
        )

        if (!userCluster) {
          logger.warn(
            {
              userId: user.id,
              userGuild,
              requestedGuild: guild
            },
            'Blocked cross-guild player stats access without a cluster'
          )
          return {
            stats: null,
            context: null,
            error: 'You are not authorized to view stats for this guild.'
          }
        }

        const requestedGuildConfig = await GuildConfigService.getBasic(
          supabase,
          guild
        )
        if (
          !requestedGuildConfig ||
          requestedGuildConfig.cluster_code !== userCluster
        ) {
          logger.warn(
            {
              userId: user.id,
              userCluster,
              requestedGuild: guild
            },
            'Blocked cross-cluster player stats access'
          )
          return {
            stats: null,
            context: null,
            error: 'You are not authorized to view stats for this guild.'
          }
        }
      }
    }
  } catch (authError) {
    logger.warn(
      { authError: authError },
      'Authorization check failed in fetchPlayerStats'
    )
    return { stats: null, context: null, error: 'Authorization check failed.' }
  }

  // Kill switch for the new RPC, which is the primary path.
  const useRpc = process.env.NEXT_PUBLIC_ENABLE_PLAYER_STATS_RPC !== 'false'

  if (!useRpc) {
    logger.warn(
      'Player Stats: New RPC disabled by feature flag. No legacy fallback available.'
    )
    return {
      stats: null,
      context: null,
      error:
        'Legacy player stats calculation is disabled. Please enable the new RPC.'
    }
  }

  try {
    // Checks above use the caller's RLS client; the service-role client is created only after.
    const privilegedSupabase = serviceDb()

    const [statsResult, mappingResult, guildConfigResult] = await Promise.all([
      privilegedSupabase.rpc('get_player_stats_comprehensive', {
        p_guild_code: guild,
        p_season: season,
        p_display_name: searchName
      }),
      guildRosterQuery(
        privilegedSupabase,
        guild,
        'id, user_id, player_id, display_name, guild_code, role, primary_boss, secondary_boss, is_current, is_active, has_duplicate_name, cluster_code, updated_at, created_at, auto_generated'
      )
        .eq('display_name', searchName)
        .maybeSingle(),
      GuildConfigService.getBasic(supabase, guild)
    ])

    if (statsResult.error) {
      throw statsResult.error
    }

    if (!statsResult.data) {
      return { stats: null, context: null, error: 'No data found for player.' }
    }

    return {
      // Untyped JSON: coerce at the boundary.
      stats: statsResult.data as unknown as ComprehensivePlayerStats,
      context: {
        resolvedGuild: guild,
        resolvedGuildName: guildConfigResult?.display_name ?? guild,
        resolvedClusterCode: guildConfigResult?.cluster_code ?? null,
        mapping: mappingResult.data as PlayerMapping | null
      },
      error: null
    }
  } catch (error: unknown) {
    logger.error(
      {
        searchName,
        guild,
        season,
        error
      },
      'Error fetching comprehensive player stats:'
    )
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String(
            (error as { message?: unknown }).message ??
              'Failed to fetch player stats'
          )
        : 'Failed to fetch player stats'

    return {
      stats: null,
      context: null,
      error: message
    }
  }
}
