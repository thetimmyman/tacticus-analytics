import { guildRosterQuery } from '@/app/lib/data/guild-roster'

import 'server-only'

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  postToWebhook,
  logDiscordWebhookDelivery
} from '@/app/lib/discord/webhook-service'
import type { DiscordWebhookPayload } from '@/app/lib/discord/types'
import {
  HERALD_WEBHOOK_TYPE,
  DISCORD_SNOWFLAKE_REGEX,
  type BombRangeTransition
} from '@/app/lib/herald/contracts'
import { formatBombRangeEmbed } from '@/app/lib/herald/format'
import {
  logger,
  type PostOutcome
} from '@/app/lib/herald/dispatch/dispatch-shared'
import {
  findVerifiedDiscordForMapping,
  resolveVerifiedDiscordIdentities
} from '@/app/lib/auth/verified-player-authority'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

// Pings `bomb_alert_role_id` or @everyone. Dedup claims a herald_posted_events row via the
// bomb_range_breach partial unique index.
export interface PostHeraldBombRangeParams {
  supabase: SupabaseClient
  guildCode: string
  transition: BombRangeTransition
  invocationId: string
  webhookUrl: string
  roleId: string | null
  notificationsEnabled?: boolean
  // Mention linked holders; falls back to the role/@everyone ping so the alert is never silent.
  pingHolders?: boolean
  bombHolderMemberIds?: string[]
}

const DISCORD_MAX_MENTIONS = 100

const resolveBombHolderDiscordIds = async (
  supabase: SupabaseClient,
  guildCode: string,
  memberIds: string[]
): Promise<{ ids: string[]; truncated: boolean }> => {
  if (memberIds.length === 0) return { ids: [], truncated: false }
  const uniqueMemberIds = Array.from(new Set(memberIds))
  const { data, error } = await guildRosterQuery(
    supabase,
    guildCode,
    'id, user_id, player_id, guild_code, discord_user_id'
  )
    .in('player_id', uniqueMemberIds)
    .not('discord_user_id', 'is', null)
  if (error || !data) return { ids: [], truncated: false }
  const verified = await resolveVerifiedDiscordIdentities(
    supabase as unknown as TypedSupabaseClient,
    data
      .map((row) => row.discord_user_id)
      .filter((id): id is string => Boolean(id))
  )
  const seen = new Set<string>()
  const ids: string[] = []
  for (const row of data) {
    const discordId = findVerifiedDiscordForMapping(verified, {
      mappingId: row.id,
      playerId: row.player_id,
      userId: row.user_id,
      guildCode: row.guild_code,
      discordUserId: row.discord_user_id
    })?.discordUserId
    if (typeof discordId !== 'string' || discordId.length === 0) continue
    if (!DISCORD_SNOWFLAKE_REGEX.test(discordId)) continue
    if (seen.has(discordId)) continue
    seen.add(discordId)
    ids.push(discordId)
  }
  const truncated = ids.length > DISCORD_MAX_MENTIONS
  return {
    ids: truncated ? ids.slice(0, DISCORD_MAX_MENTIONS) : ids,
    truncated
  }
}

export const postHeraldBombRangeEvent = async (
  params: PostHeraldBombRangeParams
): Promise<PostOutcome> => {
  const {
    supabase,
    guildCode,
    transition,
    invocationId,
    webhookUrl,
    roleId,
    notificationsEnabled = true,
    pingHolders = false,
    bombHolderMemberIds = []
  } = params

  if (!webhookUrl || webhookUrl.length === 0) {
    return { outcome: 'skipped', reason: 'no_webhook_url' }
  }

  if (notificationsEnabled === false) {
    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        boss_id: transition.boss_id
      },
      'herald.bomb_range.skip.master_toggle_off'
    )
    return { outcome: 'skipped', reason: 'master_toggle_off' }
  }

  // Fill every partial-index column (`completed_on` only satisfies NOT NULL). A
  // 23505 from either unique constraint is a correct dedup hit.
  const dedupRow = {
    guild_code: guildCode,
    season: transition.season,
    boss_id: transition.boss_id,
    transition_type: 'bomb_range_breach' as const,
    completed_on: transition.observed_at,
    loop_index: transition.loop_index,
    encounter_index: transition.encounter_index
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
          loop_index: transition.loop_index,
          encounter_index: transition.encounter_index
        },
        'herald.bomb_range.dedup.hit'
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
      'herald.bomb_range.insert.error'
    )
    return {
      outcome: 'failed',
      reason: `insert:${insertError.message}`,
      status: null
    }
  }
  if (!inserted) {
    return { outcome: 'dedup' }
  }

  // Embed mentions never ping, so mentions go in `content`.
  const embed = formatBombRangeEmbed(transition)

  let holderMentions: { ids: string[]; truncated: boolean } | null = null
  if (pingHolders && bombHolderMemberIds.length > 0) {
    holderMentions = await resolveBombHolderDiscordIds(
      supabase,
      guildCode,
      bombHolderMemberIds
    )
  }

  let mention: string
  let allowedMentions: DiscordWebhookPayload['allowed_mentions']
  if (holderMentions && holderMentions.ids.length > 0) {
    mention = holderMentions.ids.map((id) => `<@${id}>`).join(' ')
    allowedMentions = { parse: [], users: holderMentions.ids }
    if (holderMentions.truncated) {
      logger.warn(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: transition.boss_id,
          mention_cap: DISCORD_MAX_MENTIONS,
          requested: bombHolderMemberIds.length
        },
        'herald.bomb_range.mention_truncated'
      )
    }
  } else {
    mention = roleId ? `<@&${roleId}>` : '@everyone'
    allowedMentions = roleId
      ? { parse: [], roles: [roleId] }
      : { parse: ['everyone' as const] }
    if (pingHolders && bombHolderMemberIds.length > 0) {
      logger.info(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: transition.boss_id,
          unresolved_holders: bombHolderMemberIds.length
        },
        'herald.bomb_range.holder_mentions_fell_back'
      )
    }
  }
  const bombPreviewLine = embed.title ?? ''
  const payload: DiscordWebhookPayload = {
    content:
      bombPreviewLine.length > 0 ? `${bombPreviewLine}\n${mention}` : mention,
    embeds: [embed],
    allowed_mentions: allowedMentions
  }

  let status: number | null = null
  let failReason: string | null = null
  try {
    const result = await postToWebhook(webhookUrl, payload, {
      guildCode,
      webhookType: HERALD_WEBHOOK_TYPE,
      retries: 2,
      logDelivery: logDiscordWebhookDelivery
    })
    status = result.status
    if (!result.ok) {
      failReason = result.error?.message ?? 'webhook_post_failed'
    }
  } catch (err) {
    failReason = err instanceof Error ? err.message : String(err)
  }

  if (failReason !== null) {
    // Single channel: any failure is total, so release the claim to retry.
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
          'herald.bomb_range.dedup_rollback.fail'
        )
      } else {
        logger.info(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            boss_id: transition.boss_id,
            dedup_row_id: inserted.id
          },
          'herald.bomb_range.dedup_rollback.ok'
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
        'herald.bomb_range.dedup_rollback.exception'
      )
    }
    return {
      outcome: 'failed',
      reason: failReason,
      status
    }
  }

  // Best-effort, but log failures: PostgREST resolves with { error } instead of throwing.
  try {
    const hash = createHash('sha256').update(webhookUrl).digest('hex')
    const { error: auditError } = await supabase
      .from('discord_webhook_logs')
      .insert({
        guild_code: guildCode,
        webhook_type: HERALD_WEBHOOK_TYPE,
        webhook_url_hash: hash,
        status: 'delivered',
        payload_preview: `[bomb_range_breach] ${transition.boss_display_name} hp=${transition.remaining_hp} bombs=${transition.bombs_available}/${transition.bombs_needed}`
      })
    if (auditError) {
      logger.warn(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          err: auditError.message
        },
        'herald.bomb_range.audit_write_failed'
      )
    }
  } catch (auditErr) {
    logger.warn(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        err: auditErr instanceof Error ? auditErr.message : String(auditErr)
      },
      'herald.bomb_range.audit_write_failed'
    )
  }

  return {
    outcome: 'posted',
    status,
    postedChannels: 1,
    failedChannels: 0
  }
}
