import { NextRequest, NextResponse } from 'next/server'
import { requireRoleForApi } from '@/app/lib/auth'
import { isAppAdminProfile } from '@/app/lib/auth/app-admin'
import { serviceDb } from '@/app/lib/db'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.cluster.discord-links')
import type { Database } from '@tacticus/app-core/types'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

/** Cross-cluster access is gated on profile.is_app_admin, never role === 'admin': inferRole() can fall
 * back to client-writable user_metadata.role. */

const normalize = (value: string | null | undefined) =>
  value ? value.trim().toUpperCase() : null

type ServiceClient = TypedSupabaseClient
type DiscordServerGuildRow =
  Database['public']['Tables']['discord_server_guilds']['Row']
type DiscordInviteRow =
  Database['public']['Tables']['discord_invite_codes']['Row']
type DiscordServerGuildSummary = Pick<
  DiscordServerGuildRow,
  | 'game_guild_code'
  | 'discord_guild_id'
  | 'invited_with_code'
  | 'linked_at'
  | 'linked_by_user_id'
>
type DiscordInviteSummary = Pick<
  DiscordInviteRow,
  | 'id'
  | 'guild_code'
  | 'invite_code'
  | 'created_at'
  | 'expires_at'
  | 'is_active'
  | 'max_uses'
  | 'current_uses'
>

const resolveUserCluster = async (
  supabase: ServiceClient,
  profile: { cluster_code?: string | null; guild_code?: string | null }
) => {
  const derived = normalize(profile.cluster_code)
  if (derived) {
    return derived
  }

  const guildCode = normalize(profile.guild_code)
  if (!guildCode) {
    return null
  }

  const guildRow = await GuildConfigService.getBasic(supabase, guildCode)

  if (!guildRow) {
    logger.warn(
      {
        guildCode
      },
      'Failed to resolve user cluster from guild_config'
    )
  }

  return normalize(guildRow?.cluster_code)
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const auth = await requireRoleForApi('officer')
    const supabase = serviceDb()
    const derivedCluster = await resolveUserCluster(supabase, auth.profile)

    const requestedCluster = normalize(
      request.nextUrl.searchParams.get('cluster')
    )
    const targetCluster = requestedCluster ?? derivedCluster

    if (!targetCluster) {
      throw Errors.fromResponse(400, {
        success: false,
        error: 'Cluster code is required.'
      })
    }

    const isAppAdmin = isAppAdminProfile(auth.profile)
    const hasMatchingCluster =
      derivedCluster !== null && derivedCluster === targetCluster

    if (!hasMatchingCluster && !isAppAdmin) {
      throw Errors.fromResponse(403, {
        success: false,
        error: 'Access denied for this cluster.'
      })
    }

    let guilds = [] as Array<{
      guild_code: string
      display_name: string | null
      cluster_code: string | null
    }>
    try {
      guilds = await GuildConfigService.getClusterGuilds(
        supabase,
        targetCluster,
        {
          includeDisabled: true,
          orderBy: 'guild_code',
          throwOnError: true
        }
      )
    } catch (error) {
      rethrowIfAppError(error)
      logger.error(
        {
          cluster: targetCluster,
          error: error instanceof Error ? error.message : String(error)
        },
        'Failed to load guilds for cluster discord links'
      )
      throw Errors.fromResponse(500, {
        success: false,
        error: 'Unable to load guild directory.'
      })
    }

    const guildCodes = (guilds ?? []).map((g) => g.guild_code)

    let linkRows: DiscordServerGuildSummary[] = []
    let inviteRows: DiscordInviteSummary[] = []

    if (guildCodes.length > 0) {
      const { data: linksData, error: linksError } = await supabase
        .from('discord_server_guilds')
        .select(
          'game_guild_code, discord_guild_id, invited_with_code, linked_at, linked_by_user_id'
        )
        .in('game_guild_code', guildCodes)
        .eq('is_active', true)

      if (linksError) {
        logger.error(
          {
            cluster: targetCluster,
            error: linksError.message
          },
          'Failed to load discord server mappings for cluster'
        )
        throw Errors.fromResponse(500, {
          success: false,
          error: 'Unable to load Discord link data.'
        })
      }

      linkRows = linksData ?? []

      const { data: invitesData, error: invitesError } = await supabase
        .from('discord_invite_codes')
        .select(
          'id, guild_code, invite_code, created_at, expires_at, is_active, max_uses, current_uses'
        )
        .in('guild_code', guildCodes)
        .order('created_at', { ascending: false })

      if (invitesError) {
        logger.error(
          {
            cluster: targetCluster,
            error: invitesError.message
          },
          'Failed to load discord invite codes for cluster'
        )
        throw Errors.fromResponse(500, {
          success: false,
          error: 'Unable to load invite codes.'
        })
      }

      inviteRows = (invitesData ?? []).filter((invite) => invite.is_active)
    }

    const linkByGuild = new Map(
      linkRows.map((link) => [link.game_guild_code, link])
    )

    const invitesByGuild = new Map<
      string,
      Array<{
        id: number
        invite_code: string
        created_at: string | null
        expires_at: string | null
        is_active: boolean
        max_uses: number | null
        current_uses: number | null
      }>
    >()

    inviteRows.forEach((invite) => {
      const key = invite.guild_code
      if (!key) return
      if (!invitesByGuild.has(key)) {
        invitesByGuild.set(key, [])
      }
      invitesByGuild.get(key)!.push({
        id: invite.id,
        invite_code: invite.invite_code,
        created_at: invite.created_at,
        expires_at: invite.expires_at,
        is_active: Boolean(invite.is_active),
        max_uses: invite.max_uses,
        current_uses: invite.current_uses
      })
    })

    const payload = (guilds ?? []).map((guild) => ({
      guildCode: guild.guild_code,
      displayName: guild.display_name,
      discordLink: linkByGuild.get(guild.guild_code) ?? null,
      invites: invitesByGuild.get(guild.guild_code) ?? []
    }))

    const clusterInvites: Array<{
      id: number
      inviteCode: string
      createdAt: string | null
      expiresAt: string | null
      maxUses: number | null
      currentUses: number | null
      isActive: boolean | null
    }> = []

    return NextResponse.json(
      {
        success: true,
        data: {
          clusterCode: targetCluster,
          guilds: payload,
          clusterInvites
        }
      },
      { status: 200 }
    )
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error, { successFalseEnvelope: true })
    logger.error(
      {
        error
      },
      'Unexpected error in cluster discord-links route'
    )
    throw Errors.fromResponse(500, {
      success: false,
      error: 'Unexpected server error.'
    })
  }
})

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const auth = await requireRoleForApi('officer')
    const supabase = serviceDb()
    const derivedCluster = await resolveUserCluster(supabase, auth.profile)
    const isAppAdmin = isAppAdminProfile(auth.profile)

    let body: {
      guildCode?: string
      scope?: string
      maxUses?: number
      expiresInDays?: number
    } | null = null
    try {
      body = (await request.json()) as {
        guildCode?: string
        scope?: string
        maxUses?: number
        expiresInDays?: number
      } | null
    } catch {
      throw Errors.validation('Invalid request body', {
        endpoint: '/api/cluster/discord-links'
      })
    }

    const scope = body?.scope === 'cluster' ? 'cluster' : 'guild'
    if (scope === 'cluster') {
      throw Errors.fromResponse(400, {
        success: false,
        error: 'Cluster invites are not supported.'
      })
    }
    const guildCodeInput =
      typeof body?.guildCode === 'string' ? body.guildCode : null

    const targetGuildCode = normalize(guildCodeInput)
    if (!targetGuildCode) {
      throw Errors.fromResponse(400, {
        success: false,
        error: 'Guild code is required.'
      })
    }

    let resolvedGuildCluster: string | null = null
    if (scope === 'guild' && targetGuildCode) {
      const guildConfig = await GuildConfigService.getBasic(
        supabase,
        targetGuildCode
      )

      if (!guildConfig) {
        throw Errors.fromResponse(404, {
          success: false,
          error: `Guild ${targetGuildCode} was not found.`
        })
      }

      resolvedGuildCluster = normalize(guildConfig.cluster_code)
      if (resolvedGuildCluster !== derivedCluster) {
        throw Errors.fromResponse(403, {
          success: false,
          error: 'You can only manage guilds within your cluster.'
        })
      }
    }

    if (!resolvedGuildCluster) {
      throw Errors.fromResponse(403, {
        success: false,
        error: 'Cluster access is required.'
      })
    }

    const clusterTarget = resolvedGuildCluster

    if (!clusterTarget || (!isAppAdmin && clusterTarget !== derivedCluster)) {
      throw Errors.fromResponse(403, {
        success: false,
        error: 'Cluster access is required.'
      })
    }

    const maxUsesInput = typeof body?.maxUses === 'number' ? body.maxUses : null
    const expiresInDaysInput =
      typeof body?.expiresInDays === 'number' ? body.expiresInDays : null

    const safeMaxUses =
      Number.isFinite(maxUsesInput) && maxUsesInput && maxUsesInput > 0
        ? Math.min(Math.floor(maxUsesInput), 50)
        : 1
    const expiresInMs =
      (Number.isFinite(expiresInDaysInput) && expiresInDaysInput
        ? Math.max(1, Math.min(90, Math.floor(expiresInDaysInput)))
        : 30) *
      24 *
      60 *
      60 *
      1000
    const expiresAt = new Date(Date.now() + expiresInMs).toISOString()

    const inviteInsert: Database['public']['Tables']['discord_invite_codes']['Insert'] =
      {
        guild_code: targetGuildCode,
        max_uses: safeMaxUses,
        expires_at: expiresAt,
        created_by: auth.user.id ?? null,
        is_active: true
      }

    const { data: newInvite, error: inviteError } = await supabase
      .from('discord_invite_codes')
      .insert(inviteInsert)
      .select(
        'id, guild_code, invite_code, created_at, expires_at, max_uses, current_uses, is_active'
      )
      .single()

    if (inviteError || !newInvite) {
      logger.error(
        {
          guild: targetGuildCode,
          error: inviteError?.message
        },
        'Failed to create discord invite for cluster management'
      )
      throw Errors.fromResponse(500, {
        success: false,
        error: 'Unable to create invite code.'
      })
    }

    return NextResponse.json(
      { success: true, data: newInvite },
      { status: 201 }
    )
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error, { successFalseEnvelope: true })
    logger.error({ error }, 'Unexpected error creating cluster invite code')
    throw Errors.fromResponse(500, {
      success: false,
      error: 'Unexpected server error.'
    })
  }
})

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  try {
    const auth = await requireRoleForApi('officer')
    const supabase = serviceDb()
    const derivedCluster = await resolveUserCluster(supabase, auth.profile)
    const isAppAdmin = isAppAdminProfile(auth.profile)

    let body: { inviteId?: number } | null = null
    try {
      body = (await request.json()) as { inviteId?: number } | null
    } catch {
      throw Errors.validation('Invalid request body', {
        endpoint: '/api/cluster/discord-links'
      })
    }
    const inviteId =
      body && typeof body.inviteId === 'number' ? body.inviteId : null

    if (!inviteId) {
      throw Errors.fromResponse(400, {
        success: false,
        error: 'Invite ID is required.'
      })
    }

    const { data: inviteRow, error: inviteError } = await supabase
      .from('discord_invite_codes')
      .select('id, guild_code, is_active')
      .eq('id', inviteId)
      .maybeSingle()

    if (inviteError || !inviteRow) {
      throw Errors.fromResponse(404, {
        success: false,
        error: 'Invite not found.'
      })
    }

    let inviteCluster: string | null = null
    if (inviteRow.guild_code) {
      const guildRow = await GuildConfigService.getBasic(
        supabase,
        inviteRow.guild_code
      )
      inviteCluster = normalize(guildRow?.cluster_code)
    }

    if (!inviteCluster || (!isAppAdmin && inviteCluster !== derivedCluster)) {
      throw Errors.fromResponse(403, {
        success: false,
        error: 'Access denied for this invite.'
      })
    }

    const { error: updateError } = await supabase
      .from('discord_invite_codes')
      .update({ is_active: false })
      .eq('id', inviteId)

    if (updateError) {
      logger.error(
        {
          inviteId,
          error: updateError.message
        },
        'Failed to deactivate invite'
      )
      throw Errors.fromResponse(500, {
        success: false,
        error: 'Unable to deactivate invite.'
      })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error, { successFalseEnvelope: true })
    logger.error({ error }, 'Unexpected error deleting invite')
    throw Errors.fromResponse(500, {
      success: false,
      error: 'Unexpected server error.'
    })
  }
})
