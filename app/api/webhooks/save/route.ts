import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.webhooks.save')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import { isClusterLeaderRole } from '@/app/lib/auth/role-predicates'
import {
  DIAGNOSTIC_WEBHOOK_TYPE,
  LEGACY_TOKEN_CAP_ALERTS_WEBHOOK_TYPE,
  isProactiveTokenManagementWebhookType,
  normalizeProactiveTokenManagementWebhookType,
  requireProactiveTokenManagementAccess,
  findExistingWebhook,
  normalizeWebhookRows,
  normalizeError,
  validateDiscordWebhookUrl,
  type WebhookRow
} from '@/app/lib/webhooks'

type WebhookAccessProfile = {
  role: string | null
  guild_code: string | null
}

type ExistingWebhook = {
  id: string
  webhook_type: string
}

async function loadWebhookAccessProfile(
  supabase: Awaited<ReturnType<typeof db>>,
  userId: string
): Promise<WebhookAccessProfile | null> {
  const { data, error } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('role, guild_code')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle()

  if (error) {
    logger.error({ err: error }, 'Error fetching user profile:')
    throw Errors.internal('Failed to verify permissions', {
      endpoint: '/api/webhooks/save',
      details: error.message
    })
  }

  return (data as WebhookAccessProfile | null) ?? null
}

async function requireWebhookScopeAccess(
  supabase: Awaited<ReturnType<typeof db>>,
  userId: string,
  {
    guildCode,
    clusterId,
    webhookType: _webhookType
  }: {
    guildCode?: string | null
    clusterId?: string | null
    webhookType?: string | null
  }
): Promise<void> {
  if (guildCode) {
    await requireGuildOfficerOrClusterLeader(
      supabase,
      userId,
      guildCode,
      '/api/webhooks/save'
    )
    return
  }

  if (clusterId) {
    const profile = await loadWebhookAccessProfile(supabase, userId)
    const isLeader = isClusterLeaderRole(profile?.role)
    if (!isLeader || !profile?.guild_code) {
      throw Errors.forbidden(
        'Only cluster leaders can manage cluster webhooks',
        {
          endpoint: '/api/webhooks/save',
          cluster_id: clusterId,
          webhook_type: _webhookType ?? null
        }
      )
    }

    const guild = await GuildConfigService.getBasic(
      supabase,
      profile.guild_code
    )
    const { data: cluster } = await supabase
      .from('clusters')
      .select('cluster_code')
      .eq('id', clusterId)
      .single()

    if (!guild || !cluster || guild.cluster_code !== cluster.cluster_code) {
      throw Errors.forbidden(
        'You can only manage webhooks for your own cluster',
        {
          endpoint: '/api/webhooks/save',
          cluster_id: clusterId
        }
      )
    }

    return
  }

  return
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  try {
    logger.debug('=== WEBHOOK SAVE REQUEST ===')
    const supabase = await db()

    const user = await requireSessionUser(supabase, () =>
      Errors.authenticationRequired(
        'Authentication required to manage webhooks',
        {
          endpoint: '/api/webhooks/save'
        }
      )
    )

    const body = await req.json()
    const {
      webhook_type,
      webhook_url,
      enabled,
      guild_code,
      cluster_id,
      thread_id
    } = body

    if (!webhook_type || typeof webhook_type !== 'string') {
      throw Errors.validation('webhook_type is required', {
        endpoint: '/api/webhooks/save',
        user_id: user.id
      })
    }

    const normalizedWebhookType =
      normalizeProactiveTokenManagementWebhookType(webhook_type)

    logger.debug(
      {
        webhook_type: normalizedWebhookType,
        webhook_url: webhook_url ? 'URL provided' : 'No URL',
        enabled,
        guild_code,
        cluster_id
      },
      'Parsed values:'
    )

    // guild_code wins when both are given, matching the persistence branch below.
    if (guild_code || cluster_id) {
      await requireWebhookScopeAccess(supabase, user.id, {
        guildCode: guild_code || null,
        clusterId: guild_code ? null : cluster_id || null,
        webhookType: normalizedWebhookType
      })
    } else {
      throw Errors.validation(
        'Either guild_code or cluster_id must be provided',
        {
          endpoint: '/api/webhooks/save'
        }
      )
    }

    if (isProactiveTokenManagementWebhookType(normalizedWebhookType)) {
      await requireProactiveTokenManagementAccess(
        supabase,
        user.id,
        '/api/webhooks/save'
      )
    }

    const persistenceDb = supabase
    const existing: ExistingWebhook | null = await findExistingWebhook(
      persistenceDb,
      normalizedWebhookType,
      guild_code ?? null,
      cluster_id ?? null
    )

    const normalizedEnabled =
      typeof enabled === 'boolean'
        ? enabled
        : normalizedWebhookType === DIAGNOSTIC_WEBHOOK_TYPE
          ? false
          : true

    let normalizedUrl =
      typeof webhook_url === 'string' && webhook_url.trim().length > 0
        ? webhook_url.trim()
        : null

    // Reject channel URLs: Discord's SPA returns 2xx for them but never delivers.
    if (normalizedUrl !== null) {
      const urlValidation = validateDiscordWebhookUrl(normalizedUrl)
      if (!urlValidation.ok) {
        const body: Record<string, unknown> = {
          success: false,
          error: urlValidation.message,
          error_kind: urlValidation.kind
        }
        if ('hint' in urlValidation) body.hint = urlValidation.hint
        throw Errors.fromResponse(400, body)
      }
      normalizedUrl = urlValidation.url
    }

    const normalizedThreadId =
      typeof thread_id === 'string' && thread_id.trim().length > 0
        ? thread_id.trim()
        : null

    let result
    if (existing) {
      logger.info(
        {
          id: existing.id,
          webhook_type: normalizedWebhookType,
          guild_code,
          enabled
        },
        'Updating existing webhook'
      )

      const typeUpdateNeeded =
        existing.webhook_type === LEGACY_TOKEN_CAP_ALERTS_WEBHOOK_TYPE
      const updateQuery = persistenceDb
        .from('webhook_config')
        .update({
          webhook_url: normalizedUrl,
          enabled: normalizedEnabled,
          thread_id: normalizedThreadId,
          ...(typeUpdateNeeded ? { webhook_type: normalizedWebhookType } : {}),
          updated_at: new Date().toISOString(),
          updated_by: user.id
        })
        .eq('id', existing.id)

      const { data, error } = await updateQuery.select().single()

      if (error) {
        logger.error(
          {
            error,
            id: existing.id,
            webhook_type: normalizedWebhookType,
            guild_code
          },
          'Error updating webhook:'
        )
        throw error
      }
      result = data
      logger.info(
        {
          id: data?.id ?? null,
          webhook_type: normalizedWebhookType,
          guild_code: guild_code ?? null,
          cluster_id: cluster_id ?? null,
          enabled: normalizedEnabled
        },
        'Webhook updated successfully'
      )
    } else {
      logger.info(
        {
          webhook_type: normalizedWebhookType,
          guild_code,
          enabled
        },
        'Creating new webhook'
      )
      const { data, error } = await persistenceDb
        .from('webhook_config')
        .insert({
          webhook_type: normalizedWebhookType,
          webhook_url: normalizedUrl,
          enabled: normalizedEnabled,
          guild_code: guild_code || null,
          cluster_id: cluster_id || null,
          thread_id: normalizedThreadId,
          updated_by: user.id
        })
        .select()
        .single()
      if (error) {
        logger.error(
          {
            error,
            webhook_type: normalizedWebhookType,
            guild_code
          },
          'Error creating webhook:'
        )
        throw error
      }
      result = data
      logger.info(
        {
          id: data?.id ?? null,
          webhook_type: normalizedWebhookType,
          guild_code: guild_code ?? null,
          cluster_id: cluster_id ?? null,
          enabled: normalizedEnabled
        },
        'Webhook created successfully'
      )
    }

    if (guild_code) {
      try {
        logger.debug(
          { guild_code: guild_code },
          'Syncing guild_config.discord_webhook_enabled for guild:'
        )

        const { data: enabledWebhooks, error: webhookCheckError } =
          await supabase
            .from('webhook_config')
            .select('id')
            .eq('guild_code', guild_code)
            .eq('enabled', true)
            .limit(1)

        if (webhookCheckError) {
          logger.error(
            { err: webhookCheckError },
            'Error checking enabled webhooks:'
          )
        } else {
          const hasEnabledWebhooks =
            enabledWebhooks && enabledWebhooks.length > 0

          logger.debug(
            {
              guild_code,
              hasEnabledWebhooks,
              enabledCount: enabledWebhooks?.length || 0
            },
            'Guild webhook status check:'
          )

          const { error: guildUpdateError } = await supabase
            .from('guild_config')
            .update({
              discord_webhook_enabled: hasEnabledWebhooks,
              updated_at: new Date().toISOString()
            })
            .eq('guild_code', guild_code)

          if (guildUpdateError) {
            logger.error(
              { err: guildUpdateError },
              'Error updating guild_config.discord_webhook_enabled:'
            )
          } else {
            logger.info(
              {
                guild_code,
                discord_webhook_enabled: hasEnabledWebhooks
              },
              'Successfully synced guild_config.discord_webhook_enabled'
            )
          }
        }
      } catch (error) {
        rethrowIfAppError(error)
        logger.error({ err: error }, 'Error syncing guild webhook status:')
      }
    }

    logger.info(
      {
        webhook_type: normalizedWebhookType,
        guild_code,
        cluster_id,
        user_id: user.id
      },
      'Webhook saved successfully'
    )

    return NextResponse.json({
      success: true,
      webhook: result,
      message: 'Webhook configuration saved successfully'
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error('=== WEBHOOK SAVE ERROR ===')
    logger.error({ err: typeof error }, 'Error type:')
    const normalizedError = normalizeError(error)
    logger.error({ err: normalizedError.message }, 'Error message:')
    logger.error({ err: error }, 'Full error:')
    logger.error(
      { err: normalizedError.stack || 'No stack trace' },
      'Stack trace:'
    )
    logger.error({ err: error }, 'Error saving webhook:')
    throw Errors.updateFailed('Failed to save webhook configuration', {
      endpoint: '/api/webhooks/save',
      details: normalizedError.message
    })
  }
})

export const GET = withErrorHandler(async (req: NextRequest) => {
  try {
    const supabase = await db()

    const user = await requireSessionUser(supabase, () =>
      Errors.authenticationRequired(
        'Authentication required to access webhook configurations',
        {
          endpoint: '/api/webhooks/save'
        }
      )
    )

    const url = new URL(req.url)
    const guild_code = url.searchParams.get('guild_code')
    const cluster_id = url.searchParams.get('cluster_id')
    const requestedWebhookType = url.searchParams.get('webhook_type')
    const normalizedWebhookType = requestedWebhookType
      ? normalizeProactiveTokenManagementWebhookType(requestedWebhookType)
      : null

    if (!guild_code && !cluster_id) {
      throw Errors.validation(
        'Either guild_code or cluster_id must be provided',
        { endpoint: '/api/webhooks/save' }
      )
    }

    await requireWebhookScopeAccess(supabase, user.id, {
      guildCode: guild_code,
      clusterId: guild_code ? null : cluster_id,
      webhookType: normalizedWebhookType
    })

    let query = supabase
      .from('webhook_config')
      .select('*')
      .order('webhook_type')

    if (guild_code) {
      query = query.eq('guild_code', guild_code)
    } else {
      if (!cluster_id) {
        throw Errors.validation('cluster_id is required for this operation', {
          endpoint: '/api/webhooks/save'
        })
      }
      query = query.eq('cluster_id', cluster_id)
    }

    if (normalizedWebhookType) {
      query = query.eq('webhook_type', normalizedWebhookType)
    }

    const { data: webhooks, error } = await query

    if (error) {
      logger.error({ err: error }, 'Error fetching webhooks:')
      throw error
    }

    const normalizedWebhooks = normalizeWebhookRows(
      (webhooks ?? []) as WebhookRow[]
    )

    logger.info(
      {
        count: normalizedWebhooks.length,
        guild_code,
        cluster_id,
        webhook_type: normalizedWebhookType
      },
      'Fetched webhooks'
    )

    return NextResponse.json({
      success: true,
      webhooks: normalizedWebhooks
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error fetching webhooks:')
    const normalizedError = normalizeError(error)
    throw Errors.fetchFailed('Failed to fetch webhook configurations', {
      endpoint: '/api/webhooks/save',
      details: normalizedError.message
    })
  }
})
