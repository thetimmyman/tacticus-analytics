import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  postToWebhook,
  logDiscordWebhookDelivery
} from '@/app/lib/discord/webhook-service'
import { fetchDiscordMessageBody } from '@/app/lib/discord/custom-message-fetch'
import type { DiscordWebhookPayload } from '@/app/lib/discord/types'
import { appendRolePings } from '@/app/lib/discord/role-mentions'
import { buildAllowedMentions } from '@/app/lib/discord/allowed-mentions'
import {
  type EmojiResolver,
  buildEmojiResolver,
  loadHeroEmojiMap
} from '@/app/lib/discord/emoji-resolver'
import {
  HERALD_WEBHOOK_TYPE,
  CHANNEL_FANOUT_DELAY_MS,
  type AvailabilityTransition
} from '@/app/lib/herald/contracts'
import {
  sanitizeRoleId,
  logSuppressedHeraldDispatch,
  type HeraldBossConfigRow,
  type HeraldChannel
} from '@/app/lib/herald/config'
import {
  formatAvailabilityEmbed,
  formatAvailabilityCompactMessage
} from '@/app/lib/herald/format'
import {
  logger,
  type PostOutcome
} from '@/app/lib/herald/dispatch/dispatch-shared'

export interface PostHeraldAvailabilityParams {
  supabase: SupabaseClient
  guildCode: string
  transition: AvailabilityTransition
  invocationId: string
  channels: HeraldChannel[]
  roleIds?: string[]
  bossConfig?: HeraldBossConfigRow | null
  notificationsEnabled?: boolean
  mentionRolesAsText?: boolean
  roleLabels?: Map<string, string>
  note?: string | null
  compactAvailabilityPosts?: boolean
}

/** The `herald_boss_availability` INSERT claims the event; a conflict = posted. */
export const postHeraldAvailabilityEvent = async (
  params: PostHeraldAvailabilityParams
): Promise<PostOutcome> => {
  const {
    supabase,
    guildCode,
    transition,
    invocationId,
    channels,
    roleIds = [],
    bossConfig = null,
    notificationsEnabled = true,
    mentionRolesAsText = false,
    roleLabels,
    note = null,
    compactAvailabilityPosts = false
  } = params

  if (channels.length === 0) {
    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        boss_id: transition.boss_id
      },
      'herald.available.skip.no_valid_channels'
    )
    return { outcome: 'skipped', reason: 'no_valid_channels' }
  }

  // Master toggle off: skip without claiming dedup.
  if (notificationsEnabled === false) {
    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        boss_id: transition.boss_id
      },
      'herald.available.skip.master_toggle_off'
    )
    await logSuppressedHeraldDispatch(supabase, {
      guildCode,
      channels,
      transitionLabel: `availability:${transition.boss_id}`,
      mentionedRoleIds: roleIds
    })
    return { outcome: 'skipped', reason: 'master_toggle_off' }
  }

  // rarity + set_num are in the unique key so one boss_type can sit at an L and an M stage per loop.
  const snapshotRow = {
    guild_code: guildCode,
    season: transition.season,
    boss_id: transition.boss_id,
    boss_type: transition.boss_type,
    encounter_index: transition.encounter_index,
    rarity: transition.rarity,
    tier: transition.tier,
    set_num: transition.set,
    loop_index: transition.loop_index
  }

  const { data: inserted, error: insertError } = await supabase
    .from('herald_boss_availability')
    .insert(snapshotRow)
    .select('id, first_seen_at')
    .maybeSingle()

  if (insertError) {
    const code = (insertError as { code?: string }).code
    if (code === '23505') {
      logger.info(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: transition.boss_id,
          season: transition.season
        },
        'herald.available.dedup.hit'
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
      'herald.available.insert.error'
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
        season: transition.season
      },
      'herald.available.dedup.hit'
    )
    return { outcome: 'dedup' }
  }

  try {
    await supabase.from('herald_posted_events').insert({
      guild_code: guildCode,
      season: transition.season,
      boss_id: transition.boss_id,
      transition_type: 'boss_available',
      completed_on: null
    })
  } catch (auditErr) {
    logger.warn(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        boss_id: transition.boss_id,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr)
      },
      'herald.available.audit_insert_failed'
    )
  }

  const customDescription = bossConfig?.custom_message_url
    ? await fetchDiscordMessageBody(bossConfig.custom_message_url)
    : null

  // Webhooks don't resolve `:emoji:` shortcodes, so substitute them here.
  const hasResolvableBody =
    (note?.trim().length ?? 0) > 0 ||
    (customDescription?.trim().length ?? 0) > 0
  const resolveEmoji: EmojiResolver = hasResolvableBody
    ? buildEmojiResolver(await loadHeroEmojiMap(supabase))
    : (s) => s

  const effectiveRoleLabels = new Map(roleLabels)
  if (bossConfig && bossConfig.discord_role_ids.length > 0) {
    const configuredRoleIds = new Set(
      bossConfig.discord_role_ids
        .map((roleId) => sanitizeRoleId(roleId))
        .filter((roleId): roleId is string => roleId !== null)
    )
    for (const roleId of roleIds) {
      if (!configuredRoleIds.has(roleId)) continue
      const label = bossConfig.discord_role_labels[roleId]
      if (label) effectiveRoleLabels.set(roleId, label)
    }
  }

  logger.info(
    {
      herald_invocation_id: invocationId,
      guild_code: guildCode,
      boss_id: transition.boss_id,
      compact_availability_posts: compactAvailabilityPosts,
      emoji_resolution_active: hasResolvableBody
    },
    'herald.available.render_mode'
  )

  let payload: DiscordWebhookPayload
  if (compactAvailabilityPosts) {
    const body = formatAvailabilityCompactMessage(transition, {
      extraLinks: bossConfig?.extra_links ?? [],
      extraVideos: bossConfig?.extra_videos ?? [],
      customDescription,
      note,
      resolveEmoji
    })
    if (mentionRolesAsText && roleIds.length > 0) {
      const textPings = roleIds
        .map((id) => `@${effectiveRoleLabels.get(id) ?? id}`)
        .join(' ')
      payload = {
        content: appendRolePings(roleIds, body, textPings),
        allowed_mentions: { parse: [] }
      }
    } else {
      const content = appendRolePings(roleIds, body)
      payload = {
        content: content.length > 0 ? content : undefined,
        allowed_mentions: buildAllowedMentions(roleIds)
      }
    }
  } else {
    const embed = formatAvailabilityEmbed(transition, {
      extraLinks: bossConfig?.extra_links ?? [],
      extraVideos: bossConfig?.extra_videos ?? [],
      customDescription,
      note,
      resolveEmoji
    })
    const previewLine = embed.title ?? ''
    if (mentionRolesAsText && roleIds.length > 0) {
      const textPings = roleIds
        .map((id) => `@${effectiveRoleLabels.get(id) ?? id}`)
        .join(' ')
      payload = {
        content: appendRolePings(roleIds, previewLine, textPings),
        embeds: [embed],
        allowed_mentions: { parse: [] }
      }
    } else {
      const content = appendRolePings(roleIds, previewLine)
      payload = {
        content: content.length > 0 ? content : undefined,
        embeds: [embed],
        allowed_mentions: buildAllowedMentions(roleIds)
      }
    }
  }

  logger.info(
    {
      herald_invocation_id: invocationId,
      guild_code: guildCode,
      boss_id: transition.boss_id,
      role_ping_count: roleIds.length,
      channel_count: channels.length
    },
    'herald.available.post.start'
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
          'herald.available.post.ok'
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
          'herald.available.post.fail'
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
        'herald.available.post.exception'
      )
    }
    if (i < channels.length - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, CHANNEL_FANOUT_DELAY_MS)
      )
    }
  }

  const statusForDb = statuses[0] ?? null
  if (postedChannels === 0) {
    // Total failure: release the claim so the next sync retries.
    try {
      const { error: rollbackError } = await supabase
        .from('herald_boss_availability')
        .delete()
        .eq('id', inserted.id)
      if (rollbackError) {
        logger.error(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            boss_id: transition.boss_id,
            snapshot_row_id: inserted.id,
            error: rollbackError.message
          },
          'herald.available.snapshot_rollback.fail'
        )
      } else {
        logger.info(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            boss_id: transition.boss_id,
            snapshot_row_id: inserted.id
          },
          'herald.available.snapshot_rollback.ok'
        )
      }
    } catch (rollbackErr) {
      logger.error(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: transition.boss_id,
          snapshot_row_id: inserted.id,
          error:
            rollbackErr instanceof Error
              ? rollbackErr.message
              : String(rollbackErr)
        },
        'herald.available.snapshot_rollback.exception'
      )
    }
    return {
      outcome: 'failed',
      reason: lastError ?? 'all_channels_failed',
      status: statusForDb
    }
  }
  // Partial failure keeps the claim to avoid duplicates; failed channels miss it.
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
      'herald.available.post.partial_fanout_loss'
    )
  }
  return {
    outcome: 'posted',
    status: statusForDb,
    postedChannels,
    failedChannels
  }
}
