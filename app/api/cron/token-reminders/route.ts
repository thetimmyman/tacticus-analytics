import { NextRequest, NextResponse } from 'next/server'
import {
  createDirectClient,
  type DirectClient
} from '@/app/lib/network/direct-supabase'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.cron.token-reminders')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireCronSecret } from '@/app/lib/scheduler/require-cron-secret'
import {
  logDiscordWebhookDelivery,
  postToWebhook
} from '@/app/lib/discord/webhook-service'
import type { WebhookPostResult } from '@/app/lib/discord/types'
import {
  PROACTIVE_TOKEN_MANAGEMENT_FEATURE_KEY,
  PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPE,
  PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPES,
  normalizeProactiveTokenManagementWebhookType
} from '@/app/lib/discord/proactive-token-management'
import { cronGuard } from '@/app/lib/scheduler/cron-guard'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000 // 6 hours
const DEFAULT_NEAR_CAP_WINDOW_SECONDS = 2 * 60 * 60 // 2 hours
const MAX_PLAYERS_IN_MESSAGE = 10

type ReminderConfig = {
  id: string
  guild_code: string
  webhook_url: string
  webhook_type: string
  enabled: boolean
  updated_at: string | null
}

type GuildConfigRecord = {
  guild_code: string
  display_name: string | null
  cluster_code: string | null
}

type PlayerTokenState = {
  player_id: string
  display_name: string
  tokens_available: number
  token_next_in_seconds: number | null
}

type WebhookLogRecord = {
  guild_code: string
  delivered_at: string | null
}

type TokenReminderPreferenceRecord = {
  game_guild_code: string | null
  enabled: boolean | null
}

// Never 400 (payload), 429 or 5xx.
const PERMANENT_WEBHOOK_FAILURE_STATUSES = new Set([401, 403, 404])

type GuildOfficerRecord = {
  guild_code: string | null
  user_id: string | null
}

type FeatureAccessResult = {
  has_access?: boolean
}

function formatPlayerNames(names: string[]): string {
  const normalized = names.filter(Boolean)
  if (normalized.length <= MAX_PLAYERS_IN_MESSAGE) {
    return normalized.join(', ')
  }

  const visible = normalized.slice(0, MAX_PLAYERS_IN_MESSAGE)
  return `${visible.join(', ')} +${normalized.length - visible.length} more`
}

function getReminderScore(reminder: {
  webhook_type: string
  webhook_url: string
  enabled: boolean
  updated_at: string | null
}): { score: number; updatedAt: number } {
  const canonicalType = normalizeProactiveTokenManagementWebhookType(
    reminder.webhook_type
  )
  const score =
    (reminder.webhook_url ? 4 : 0) +
    (reminder.enabled ? 2 : 0) +
    (canonicalType === reminder.webhook_type ? 1 : 0)
  const updatedAt = Date.parse(reminder.updated_at ?? '') || 0

  return { score, updatedAt }
}

function normalizeReminderConfigs(rows: ReminderConfig[]): ReminderConfig[] {
  const byGuild = new Map<
    string,
    { config: ReminderConfig; score: number; updatedAt: number }
  >()

  for (const row of rows) {
    const guildCode = row.guild_code?.trim()
    const webhookUrl = row.webhook_url?.trim()
    if (!guildCode || !webhookUrl) {
      continue
    }

    const normalized: ReminderConfig = {
      ...row,
      guild_code: guildCode,
      webhook_url: webhookUrl,
      webhook_type: normalizeProactiveTokenManagementWebhookType(
        row.webhook_type
      ),
      enabled: Boolean(row.enabled)
    }

    const key = normalized.guild_code
    const { score, updatedAt } = getReminderScore(normalized)
    const current = byGuild.get(key)

    if (
      !current ||
      score > current.score ||
      (score === current.score && updatedAt > current.updatedAt)
    ) {
      byGuild.set(key, { config: normalized, score, updatedAt })
    }
  }

  return Array.from(byGuild.values()).map((entry) => entry.config)
}

async function getGuildFeatureAccess(
  db: DirectClient,
  guildCodes: string[]
): Promise<Map<string, boolean>> {
  const byGuild = new Map<string, boolean>(
    guildCodes.map((guildCode) => [guildCode, false])
  )
  if (guildCodes.length === 0) {
    return byGuild
  }

  const inGuildList = guildCodes.map((c) => `"${c}"`).join(',')
  const { data: officers, error: officersError } = await db.query<
    GuildOfficerRecord[]
  >(
    `player_mapping?select=guild_code,user_id&guild_code=in.(${inGuildList})&is_current=eq.true&role=in.(leader,officer)`
  )

  if (officersError) {
    logger.warn(
      {
        error: officersError
      },
      '[Token Reminders] Failed to load guild officers for feature access'
    )
    return byGuild
  }

  const officerRecords = officers ?? []
  const userIds = Array.from(
    new Set(
      officerRecords
        .map((officer) => officer.user_id)
        .filter(
          (userId): userId is string =>
            typeof userId === 'string' && userId.trim().length > 0
        )
    )
  )

  const userAccessEntries = await Promise.all(
    userIds.map(async (userId) => {
      const { data, error } = await db.rpc('check_feature_access', {
        p_user_id: userId,
        p_feature_key: PROACTIVE_TOKEN_MANAGEMENT_FEATURE_KEY
      })

      if (error) {
        logger.warn(
          {
            userId,
            error
          },
          '[Token Reminders] Failed to evaluate proactive token access for user'
        )
        return [userId, false] as const
      }

      return [
        userId,
        Boolean((data as FeatureAccessResult | null)?.has_access)
      ] as const
    })
  )

  const accessByUserId = new Map<string, boolean>(userAccessEntries)

  const usersByGuild = new Map<string, Set<string>>()
  for (const officer of officerRecords) {
    if (!officer.guild_code || !officer.user_id) {
      continue
    }

    if (!usersByGuild.has(officer.guild_code)) {
      usersByGuild.set(officer.guild_code, new Set())
    }
    usersByGuild.get(officer.guild_code)?.add(officer.user_id)
  }

  for (const [guildCode, members] of usersByGuild) {
    const hasAccess = Array.from(members).some(
      (userId) => accessByUserId.get(userId) === true
    )
    byGuild.set(guildCode, hasAccess)
  }

  return byGuild
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    requireCronSecret(request)

    // Active-passive failover: secondaries defer to the primary.
    const guard = await cronGuard()
    if (!guard.shouldExecute) {
      return NextResponse.json({ skipped: true, reason: guard.reason })
    }

    // Avoids the Supabase SDK promise-chain hang.
    const db = createDirectClient()

    const webhookTypes = [...PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPES].join(',')
    const { data: reminderRows, error: reminderError } = await db.query<
      ReminderConfig[]
    >(
      `webhook_config?select=id,guild_code,webhook_url,webhook_type,enabled,updated_at&enabled=eq.true&guild_code=not.is.null&webhook_url=not.is.null&webhook_type=in.(${webhookTypes})&limit=200`
    )

    if (reminderError) {
      logger.error(
        { err: reminderError },
        '[Token Reminders] Failed to load webhook settings'
      )
      throw Errors.fromResponse(500, { error: 'Failed to load reminders' })
    }

    const reminderConfigs = normalizeReminderConfigs(reminderRows ?? [])

    if (reminderConfigs.length === 0) {
      return NextResponse.json({
        success: true,
        processed: 0,
        message: 'No enabled reminders configured'
      })
    }

    const guildCodes = Array.from(
      new Set(reminderConfigs.map((reminder) => reminder.guild_code))
    )

    const featureAccessByGuild = await getGuildFeatureAccess(db, guildCodes)

    const { data: latestSeasonData, error: latestSeasonError } =
      await db.rpc('get_latest_season')
    if (latestSeasonError) {
      logger.warn(
        { latestSeasonError: latestSeasonError },
        '[Token Reminders] Failed to load latest season, falling back to default'
      )
    }
    const latestSeasonRaw = latestSeasonData as string | null
    const latestSeason =
      typeof latestSeasonRaw === 'string' && latestSeasonRaw.trim().length > 0
        ? latestSeasonRaw
        : '83'

    const inGuildList = guildCodes.map((c) => `"${c}"`).join(',')
    const { data: guildConfigsData } = await db.query<GuildConfigRecord[]>(
      `guild_config?select=guild_code,display_name,cluster_code&guild_code=in.(${inGuildList})`
    )

    const guildConfigs = guildConfigsData ?? []
    const guildLabelByCode = new Map(
      guildConfigs.map((config) => [
        config.guild_code,
        config.display_name ?? config.guild_code
      ])
    )
    const guildClusterByCode = new Map(
      guildConfigs.map((config) => [
        config.guild_code,
        config.cluster_code ?? undefined
      ])
    )

    // Skip a guild only when it has /token-reminder rows and all are disabled.
    const { data: reminderPrefs, error: reminderPrefsError } = await db.query<
      TokenReminderPreferenceRecord[]
    >(
      `discord_token_reminders?select=game_guild_code,enabled&game_guild_code=in.(${inGuildList})`
    )
    if (reminderPrefsError) {
      logger.warn(
        { reminderPrefsError: reminderPrefsError },
        '[Token Reminders] Failed to load /token-reminder preferences; proceeding without them'
      )
    }
    const reminderPrefsByGuild = new Map<string, boolean[]>()
    for (const pref of reminderPrefs ?? []) {
      if (!pref.game_guild_code) continue
      const list = reminderPrefsByGuild.get(pref.game_guild_code) ?? []
      list.push(Boolean(pref.enabled))
      reminderPrefsByGuild.set(pref.game_guild_code, list)
    }

    const tokenStateByGuildCode = new Map<string, PlayerTokenState[]>()
    for (const guildCode of guildCodes) {
      const clusterCode = guildClusterByCode.get(guildCode)
      const { data: tokenData, error: tokenError } = await db.rpc(
        'get_player_token_state',
        {
          p_guild_code: guildCode,
          p_cluster_code: clusterCode ?? null,
          p_season: latestSeason
        }
      )

      if (tokenError) {
        logger.warn(
          {
            guildCode,
            error: tokenError
          },
          '[Token Reminders] Failed to load token state for guild'
        )
        tokenStateByGuildCode.set(guildCode, [])
        continue
      }

      tokenStateByGuildCode.set(
        guildCode,
        (tokenData ?? []) as PlayerTokenState[]
      )
    }

    const { data: reminderLogs, error: reminderLogsError } = await db.query<
      WebhookLogRecord[]
    >(
      `discord_webhook_logs?select=guild_code,delivered_at&webhook_type=eq.${PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPE}&status=eq.delivered&guild_code=in.(${inGuildList})&order=delivered_at.desc&limit=1000`
    )

    if (reminderLogsError) {
      logger.warn(
        { reminderLogsError: reminderLogsError },
        '[Token Reminders] Failed to load reminder cooldown logs'
      )
    }

    const latestDeliveredByGuild = new Map<string, number>()
    for (const log of reminderLogs ?? []) {
      if (
        !log.guild_code ||
        !log.delivered_at ||
        latestDeliveredByGuild.has(log.guild_code)
      ) {
        continue
      }
      const deliveredAt = Date.parse(log.delivered_at)
      if (!Number.isNaN(deliveredAt)) {
        latestDeliveredByGuild.set(log.guild_code, deliveredAt)
      }
    }

    const results: Array<{ id: string; status: string; reason?: string }> = []
    const now = Date.now()

    // Relabels are for the Discord message only; raw display_name stays the join key.
    const memberLabels = await getMemberLabelMap()

    for (const reminder of reminderConfigs) {
      const guildCode = reminder.guild_code
      const webhookUrl = reminder.webhook_url

      if (!guildCode) {
        results.push({
          id: reminder.id,
          status: 'skipped',
          reason: 'missing_guild'
        })
        continue
      }
      if (!webhookUrl) {
        results.push({
          id: reminder.id,
          status: 'skipped',
          reason: 'missing_webhook_url'
        })
        continue
      }

      const guildPrefs = reminderPrefsByGuild.get(guildCode)
      if (guildPrefs && guildPrefs.length > 0 && guildPrefs.every((e) => !e)) {
        results.push({
          id: reminder.id,
          status: 'skipped_disabled',
          reason: 'all_token_reminder_preferences_disabled'
        })
        continue
      }

      if (featureAccessByGuild.get(guildCode) !== true) {
        results.push({
          id: reminder.id,
          status: 'skipped',
          reason: 'feature_locked'
        })
        continue
      }

      const lastDelivered = latestDeliveredByGuild.get(guildCode)
      if (
        typeof lastDelivered === 'number' &&
        now - lastDelivered < REMINDER_COOLDOWN_MS
      ) {
        results.push({ id: reminder.id, status: 'skipped', reason: 'cooldown' })
        continue
      }

      const tokenStates = tokenStateByGuildCode.get(guildCode) ?? []
      const cappedPlayers: string[] = []
      const nearCapPlayers: string[] = []

      for (const player of tokenStates) {
        // Never fall back to player_id: the UUID would post to a public channel.
        const rawName = player.display_name
        if (!rawName?.trim()) continue
        // Look up the EXACT stored name; trim only the output.
        const playerName = resolveMemberLabel(rawName, memberLabels).trim()
        if (player.tokens_available >= 3) {
          cappedPlayers.push(playerName)
          continue
        }

        if (
          player.tokens_available === 2 &&
          typeof player.token_next_in_seconds === 'number' &&
          player.token_next_in_seconds >= 0 &&
          player.token_next_in_seconds <= DEFAULT_NEAR_CAP_WINDOW_SECONDS
        ) {
          nearCapPlayers.push(playerName)
        }
      }

      if (cappedPlayers.length === 0 && nearCapPlayers.length === 0) {
        results.push({
          id: reminder.id,
          status: 'skipped',
          reason: 'no_targets'
        })
        continue
      }

      const guildLabel =
        guildLabelByCode.get(guildCode) ??
        formatGuildDisplayLabel(null, guildCode)
      const contentLines = [
        `\u26a0\ufe0f **${guildLabel} Proactive Token Management**`,
        ''
      ]

      if (cappedPlayers.length > 0) {
        contentLines.push(
          `**Capped now (3/3):** ${formatPlayerNames(cappedPlayers)}`
        )
      }
      if (nearCapPlayers.length > 0) {
        contentLines.push(
          '**Near cap (<= 2h):** ' + formatPlayerNames(nearCapPlayers)
        )
      }
      contentLines.push(
        '',
        'Run `/tokens` or `/bombs` for live readiness and coordinate attacks before regen is wasted.'
      )

      let postResult: WebhookPostResult
      try {
        postResult = await postToWebhook(
          webhookUrl,
          {
            content: contentLines.join('\n'),
            // Names are attacker-controlled; parse: [] stops "@everyone" from pinging.
            allowed_mentions: { parse: [] }
          },
          {
            guildCode,
            webhookType: PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPE,
            logDelivery: logDiscordWebhookDelivery
          }
        )
      } catch (postError) {
        // One dead guild must not 500 the batch.
        const message =
          postError instanceof Error ? postError.message : String(postError)
        logger.warn(
          { guildCode, reminderId: reminder.id, error: message },
          '[Token Reminders] Webhook post threw; continuing with next guild'
        )
        results.push({
          id: reminder.id,
          status: 'failed',
          reason: `discord_exception:${message}`
        })
        continue
      }

      if (!postResult.ok) {
        // Never on 429/5xx/network.
        if (
          postResult.error?.type === 'invalid_webhook' &&
          postResult.status !== null &&
          PERMANENT_WEBHOOK_FAILURE_STATUSES.has(postResult.status)
        ) {
          const { error: disableError } = await db.mutate(
            `webhook_config?id=eq.${encodeURIComponent(reminder.id)}`,
            'PATCH',
            { enabled: false }
          )
          if (disableError) {
            logger.warn(
              {
                guildCode,
                reminderId: reminder.id,
                status: postResult.status,
                error: disableError
              },
              '[Token Reminders] Failed to disable dead webhook config'
            )
          } else {
            logger.warn(
              {
                guildCode,
                reminderId: reminder.id,
                status: postResult.status
              },
              '[Token Reminders] Disabled webhook config after permanent Discord failure'
            )
          }
        }
        results.push({
          id: reminder.id,
          status: 'failed',
          reason: `discord_${postResult.status ?? 'error'}`
        })
        continue
      }

      latestDeliveredByGuild.set(guildCode, now)
      results.push({ id: reminder.id, status: 'sent' })
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      results,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, '[Token Reminders] Cron job error')
    throw Errors.fromResponse(500, {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})
