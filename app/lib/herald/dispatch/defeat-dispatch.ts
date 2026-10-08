import 'server-only'

import type { ServiceSupabaseClient } from '@/app/lib/sync/worker-types'
import {
  postToWebhook,
  logDiscordWebhookDelivery
} from '@/app/lib/discord/webhook-service'
import { fetchDiscordMessageBody } from '@/app/lib/discord/custom-message-fetch'
import type { DiscordWebhookPayload } from '@/app/lib/discord/types'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'
import {
  HERALD_WEBHOOK_TYPE,
  CHANNEL_FANOUT_DELAY_MS,
  type DefeatTransition
} from '@/app/lib/herald/contracts'
import {
  logSuppressedHeraldDispatch,
  type HeraldBossConfigRow,
  type HeraldChannel
} from '@/app/lib/herald/config'
import { formatDefeatEmbed } from '@/app/lib/herald/format'
import {
  logger,
  type PostOutcome
} from '@/app/lib/herald/dispatch/dispatch-shared'

export interface PostHeraldEventParams {
  supabase: ServiceSupabaseClient
  guildCode: string
  transition: DefeatTransition
  invocationId: string
  channels: HeraldChannel[]
  roleIds?: string[]
  bossConfig?: HeraldBossConfigRow | null
  notificationsEnabled?: boolean
}

export const postHeraldEvent = async (
  params: PostHeraldEventParams
): Promise<PostOutcome> => {
  const {
    supabase,
    guildCode,
    transition,
    invocationId,
    channels,
    roleIds = [],
    bossConfig = null,
    notificationsEnabled = true
  } = params

  if (channels.length === 0) {
    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        boss_id: transition.boss_id
      },
      'herald.skip.no_valid_channels'
    )
    return { outcome: 'skipped', reason: 'no_valid_channels' }
  }

  // Dedup row deliberately NOT claimed so re-enabling still fires this defeat later.
  if (notificationsEnabled === false) {
    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        boss_id: transition.boss_id
      },
      'herald.skip.master_toggle_off'
    )
    await logSuppressedHeraldDispatch(supabase, {
      guildCode,
      channels,
      transitionLabel: `defeat:${transition.boss_id}`,
      mentionedRoleIds: roleIds
    })
    return { outcome: 'skipped', reason: 'master_toggle_off' }
  }

  const dedupRow = {
    guild_code: guildCode,
    season: transition.season,
    boss_id: transition.boss_id,
    transition_type: 'boss_defeated' as const,
    completed_on: transition.completed_on
  }

  const { data: inserted, error: insertError } = await supabase
    .from('herald_posted_events')
    .insert(dedupRow)
    .select('id')
    .maybeSingle()

  if (insertError) {
    const code = (insertError as { code?: string }).code
    if (code === '23505') {
      logger.info(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: transition.boss_id,
          completed_on: transition.completed_on
        },
        'herald.dedup.hit'
      )
      return { outcome: 'dedup' }
    }
    logger.error(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        boss_id: transition.boss_id,
        error: insertError.message
      },
      'herald.insert.error'
    )
    return {
      outcome: 'failed',
      reason: `insert:${insertError.message}`,
      status: null
    }
  }

  if (!inserted) {
    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        boss_id: transition.boss_id,
        completed_on: transition.completed_on
      },
      'herald.dedup.hit'
    )
    return { outcome: 'dedup' }
  }

  void roleIds
  const customDescription = bossConfig?.custom_message_url
    ? await fetchDiscordMessageBody(bossConfig.custom_message_url)
    : null
  // Display-only relabel; dedup and logging keep the raw name (may carry the sync dedup suffix).
  const memberLabels = await getMemberLabelMap()
  const displayTransition = transition.killer_display_name
    ? {
        ...transition,
        killer_display_name: resolveMemberLabel(
          transition.killer_display_name,
          memberLabels
        )
      }
    : transition
  const embed = formatDefeatEmbed(displayTransition, { customDescription })
  const payload: DiscordWebhookPayload = {
    embeds: [embed],
    allowed_mentions: { parse: [] }
  }

  logger.info(
    {
      herald_invocation_id: invocationId,
      guild_code: guildCode,
      boss_id: transition.boss_id,
      channel_count: channels.length
    },
    'herald.post.start'
  )

  let postedChannels = 0
  let failedChannels = 0
  const failedChannelWebhookIds: Array<string | null> = []
  const statuses: number[] = []
  let lastError: string | undefined

  for (let i = 0; i < channels.length; i += 1) {
    const channel = channels[i]
    if (!channel) continue
    try {
      const result = await postToWebhook(channel.webhookUrl, payload, {
        guildCode,
        webhookType: HERALD_WEBHOOK_TYPE,
        threadId: channel.threadId,
        retries: 2,
        logDelivery: logDiscordWebhookDelivery
      })
      if (result.status !== null) statuses.push(result.status)
      if (result.ok) {
        postedChannels += 1
        logger.info(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            boss_id: transition.boss_id,
            webhook_id: channel.webhookId,
            status: result.status
          },
          'herald.post.ok'
        )
      } else {
        failedChannels += 1
        failedChannelWebhookIds.push(channel.webhookId)
        lastError = result.error?.message ?? 'unknown_post_failure'
        logger.warn(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            boss_id: transition.boss_id,
            webhook_id: channel.webhookId,
            status: result.status,
            error: lastError
          },
          'herald.post.fail'
        )
      }
    } catch (err) {
      failedChannels += 1
      failedChannelWebhookIds.push(channel.webhookId)
      lastError = err instanceof Error ? err.message : String(err)
      logger.error(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: transition.boss_id,
          webhook_id: channel.webhookId,
          error: lastError
        },
        'herald.post.exception'
      )
    }

    if (i < channels.length - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, CHANNEL_FANOUT_DELAY_MS)
      )
    }
  }

  const statusForDb = statuses[0] ?? null
  try {
    const { error: updateError } = await supabase
      .from('herald_posted_events')
      .update({ webhook_response_status: statusForDb })
      .eq('id', inserted.id)
    if (updateError) {
      logger.warn(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: transition.boss_id,
          error: updateError.message
        },
        'herald.status_writeback.fail'
      )
    }
  } catch (writebackErr) {
    logger.warn(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        boss_id: transition.boss_id,
        error:
          writebackErr instanceof Error
            ? writebackErr.message
            : String(writebackErr)
      },
      'herald.status_writeback.exception'
    )
  }

  if (postedChannels === 0) {
    // Total failure: release the dedup claim or this defeat is never announced.
    try {
      const { error: rollbackError } = await supabase
        .from('herald_posted_events')
        .delete()
        .eq('id', inserted.id)
      if (rollbackError) {
        logger.error(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            boss_id: transition.boss_id,
            dedup_row_id: inserted.id,
            error: rollbackError.message
          },
          'herald.dedup_rollback.fail'
        )
      } else {
        logger.info(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            boss_id: transition.boss_id,
            dedup_row_id: inserted.id
          },
          'herald.dedup_rollback.ok'
        )
      }
    } catch (rollbackErr) {
      logger.error(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: transition.boss_id,
          dedup_row_id: inserted.id,
          error:
            rollbackErr instanceof Error
              ? rollbackErr.message
              : String(rollbackErr)
        },
        'herald.dedup_rollback.exception'
      )
    }
    return {
      outcome: 'failed',
      reason: lastError ?? 'all_channels_failed',
      status: statusForDb
    }
  }
  // Partial failure keeps the claim to avoid duplicates; failed channels miss this event.
  if (failedChannels > 0) {
    logger.warn(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        boss_id: transition.boss_id,
        posted_channels: postedChannels,
        failed_channels: failedChannels,
        failed_channel_webhook_ids: failedChannelWebhookIds,
        last_error: lastError
      },
      'herald.post.partial_fanout_loss'
    )
  }
  return {
    outcome: 'posted',
    status: statusForDb,
    postedChannels,
    failedChannels
  }
}
