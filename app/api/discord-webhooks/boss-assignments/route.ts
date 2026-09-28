import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { formatBossAssignmentEmbed } from '@/app/lib/discord/formatters'
import {
  logDiscordWebhookDelivery,
  postToWebhook
} from '@/app/lib/discord/webhook-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.discord-webhooks.boss-assignments')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  canManageHeraldRole,
  isClusterLeaderRole
} from '@/app/lib/auth/role-predicates'
import { loadWebhookCallerProfile } from '@/app/api/discord-webhooks/_shared/caller-profile'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'
import { loadWebhookUrlById } from '@/app/lib/webhooks/webhook-url-lookup'

type BossAssignment = {
  tier: string
  boss_name: string
  boss_code: string
  flex_mode?: boolean
  primary_tokens?: number
  secondary_tokens?: number
  assigned_players?: string[]
}

type BossAssignmentSource = 'manual' | 'auto' | string

type BossAssignmentsRequest = {
  guild_code?: string
  cluster_code?: string
  assignments: BossAssignment[]
  season?: string
  source?: BossAssignmentSource
}

type WebhookTarget = {
  url: string
  type: 'guild' | 'cluster'
  code: string
  name?: string | null
  clusterId?: string | null
}

type WebhookPostResult = {
  type: WebhookTarget['type']
  code: string
  success: boolean
  error?: string
}

const WEBHOOK_DELIVERY_FAILED_MESSAGE =
  'Boss assignment webhook delivery failed'

const isBossAssignmentsRequest = (
  value: unknown
): value is BossAssignmentsRequest => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const payload = value as Record<string, unknown>
  if (!Array.isArray(payload.assignments)) {
    return false
  }

  return true
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  try {
    const supabase = await db()

    const user = await requireSessionUser(supabase, () =>
      Errors.authenticationRequired(
        'Authentication required to post boss assignments',
        { endpoint: '/api/discord-webhooks/boss-assignments' }
      )
    )

    const profile = await loadWebhookCallerProfile(
      supabase,
      user.id,
      '/api/discord-webhooks/boss-assignments'
    )

    if (!profile || !canManageHeraldRole(profile.role)) {
      logger.warn(
        {
          user_id: user.id,
          role: profile?.role,
          guild: profile?.guild_code
        },
        'Insufficient permissions for boss assignments'
      )
      throw Errors.insufficientPermissions(
        'Only officers and leaders can post boss assignments',
        { endpoint: '/api/discord-webhooks/boss-assignments' }
      )
    }

    const payload = (await req.json()) as unknown
    if (!isBossAssignmentsRequest(payload)) {
      throw Errors.invalidRequest('Invalid boss assignment payload.', {
        endpoint: '/api/discord-webhooks/boss-assignments'
      })
    }

    const {
      guild_code,
      cluster_code,
      assignments,
      season,
      source = 'manual'
    } = payload

    if (!assignments || assignments.length === 0) {
      throw Errors.invalidRequest('No assignments provided', {
        component: 'boss-assignments',
        action: 'validate_assignments'
      })
    }

    // Officers post to their own guild only; leaders to guilds in their cluster.
    if (
      guild_code &&
      guild_code.toUpperCase() !== (profile.guild_code ?? '').toUpperCase()
    ) {
      if (!isClusterLeaderRole(profile.role)) {
        throw Errors.insufficientPermissions(
          'Officers can only post assignments for their own guild',
          { endpoint: '/api/discord-webhooks/boss-assignments' }
        )
      }
      if (cluster_code) {
        const { data: targetMembership } = await guildRosterQuery(
          supabase,
          guild_code,
          'guild_code'
        ).limit(1)

        const { data: callerCluster } = await supabase
          .from('clusters')
          .select('id')
          .eq('cluster_code', cluster_code)
          .single()

        if (!targetMembership?.length || !callerCluster) {
          throw Errors.insufficientPermissions(
            'Target guild is not in your cluster',
            { endpoint: '/api/discord-webhooks/boss-assignments' }
          )
        }
      } else {
        throw Errors.insufficientPermissions(
          'Cross-guild posting requires a cluster context',
          { endpoint: '/api/discord-webhooks/boss-assignments' }
        )
      }
    }

    const webhooksToSend: WebhookTarget[] = []

    if (guild_code) {
      const { data: guildWebhook } = await supabase
        .from('webhook_config')
        .select('id')
        .eq('guild_code', guild_code)
        .eq('webhook_type', 'boss_assignments')
        .eq('enabled', true)
        .single()

      const guildWebhookUrl = guildWebhook?.id
        ? await loadWebhookUrlById(guildWebhook.id)
        : null
      if (guildWebhookUrl) {
        webhooksToSend.push({
          url: guildWebhookUrl,
          type: 'guild',
          code: guild_code
        })
      }
    }

    if (cluster_code) {
      const { data: clusterData } = await supabase
        .from('clusters')
        .select('id, display_name')
        .eq('cluster_code', cluster_code)
        .single()

      if (clusterData) {
        const { data: clusterWebhook } = await supabase
          .from('webhook_config')
          .select('id')
          .eq('cluster_id', clusterData.id)
          // Guild-scoped rows would post cluster assignments into a guild channel.
          .is('guild_code', null)
          .eq('webhook_type', 'boss_assignments')
          .eq('enabled', true)
          .single()

        const clusterWebhookUrl = clusterWebhook?.id
          ? await loadWebhookUrlById(clusterWebhook.id)
          : null
        if (clusterWebhookUrl) {
          webhooksToSend.push({
            url: clusterWebhookUrl,
            type: 'cluster',
            code: cluster_code,
            name: clusterData.display_name,
            clusterId: String(clusterData.id)
          })
        }
      }
    }

    if (webhooksToSend.length === 0) {
      throw Errors.invalidRequest('No boss assignments webhooks configured', {
        guild_code,
        cluster_code
      })
    }

    // Relabel for the embed only.
    const memberLabels = await getMemberLabelMap()
    const relabelledAssignments = assignments.map((assignment) => ({
      ...assignment,
      assigned_players: assignment.assigned_players?.map((name) =>
        resolveMemberLabel(name, memberLabels)
      )
    }))

    const results: WebhookPostResult[] = []
    for (const webhook of webhooksToSend) {
      try {
        const payload = formatBossAssignmentEmbed(relabelledAssignments, {
          season,
          source,
          contextLabel:
            webhook.type === 'cluster'
              ? `${webhook.name || webhook.code} Cluster`
              : webhook.code
        })

        const postResult = await postToWebhook(
          webhook.url,
          { ...payload, username: 'Boss Assignments Bot' },
          {
            guildCode:
              webhook.type === 'cluster'
                ? `CLUSTER_${webhook.code}`
                : webhook.code,
            webhookType: 'boss_assignments',
            logDelivery: logDiscordWebhookDelivery
          }
        )

        if (!postResult.ok) {
          logger.error(
            {
              error: postResult.error,
              status: postResult.status
            },
            `Discord webhook error for ${webhook.type} ${webhook.code}:`
          )
          results.push({
            type: webhook.type,
            code: webhook.code,
            success: false,
            error: WEBHOOK_DELIVERY_FAILED_MESSAGE
          })
        } else {
          if (webhook.type === 'guild') {
            await supabase
              .from('webhook_config')
              .update({ last_tested: new Date().toISOString() })
              .eq('guild_code', webhook.code)
              .eq('webhook_type', 'boss_assignments')
          } else {
            if (webhook.clusterId) {
              await supabase
                .from('webhook_config')
                .update({ last_tested: new Date().toISOString() })
                .eq('cluster_id', webhook.clusterId)
                .eq('webhook_type', 'boss_assignments')
            }
          }

          results.push({
            type: webhook.type,
            code: webhook.code,
            success: true
          })
        }
      } catch (error) {
        rethrowIfAppError(error)
        logger.error(
          { err: error },
          `Error sending to ${webhook.type} ${webhook.code}:`
        )
        results.push({
          type: webhook.type,
          code: webhook.code,
          success: false,
          error: WEBHOOK_DELIVERY_FAILED_MESSAGE
        })
      }
    }

    const allSuccess = results.every((r) => r.success)
    return NextResponse.json(
      {
        success: allSuccess,
        results,
        webhooks_sent: results.filter((r) => r.success).length,
        webhooks_failed: results.filter((r) => !r.success).length
      },
      {
        status: allSuccess ? 200 : 207 // 207 for partial success
      }
    )
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error in boss-assignments webhook:')
    throw Errors.internal('Failed to send boss assignments', {
      endpoint: '/api/discord-webhooks/boss-assignments'
    })
  }
})
