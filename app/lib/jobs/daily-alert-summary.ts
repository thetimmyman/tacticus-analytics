// pg_cron enqueues with `dedupe_key='alert-summary:<yyyy-mm-dd>'`.

import {
  sendDailySummary,
  getAlertSummary,
  addSyncAlert,
  addApiKeyAlert
} from '@tacticus/app-core/daily-alert-summary'
import { serviceDb } from '@/app/lib/db'
import { runAllHealthChecks } from '@/app/lib/health'
import { sendApiKeyIncidentNotifications } from '@/app/lib/services/api-key-incident-notifications'
import { sendApiKeyIncidentOpsAlert } from '@/app/lib/services/api-key-incident-ops'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { createComponentLogger } from '@/app/lib/logging'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'
import type { Json } from '@tacticus/app-core/database.generated'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

const logger = createComponentLogger('lib.jobs.daily-alert-summary')

// A failed read would otherwise just drop its alerts from the summary.
function logQueryError(query: string, error: { message: string } | null): void {
  if (error) {
    logger.warn({ query, err: error.message }, 'Sync health alert query failed')
  }
}

// This runs in workers-hooks with no user session: a cookie-scoped client is
// anon there, and anon cannot read these guild_config columns.
async function collectSyncHealthAlerts(): Promise<void> {
  try {
    const supabase = serviceDb()

    const { data: failedGuilds, error: failedError } = await supabase
      .from('guild_config')
      .select(
        'guild_code, display_name, consecutive_sync_failures, auto_sync_enabled, last_successful_sync'
      )
      .eq('enabled', true)
      .gte('consecutive_sync_failures', 3)
      .order('consecutive_sync_failures', { ascending: false })
      .limit(50)

    logQueryError('failed-guilds', failedError)
    if (failedGuilds) {
      for (const guild of failedGuilds) {
        const failureCount = guild.consecutive_sync_failures ?? 0
        const guildLabel = formatGuildDisplayLabel(guild)
        addSyncAlert(
          'Guild Sync Failures',
          `${guildLabel} has ${failureCount} consecutive sync failures`,
          failureCount >= 5 ? 'error' : 'warning',
          {
            guildCode: guild.guild_code,
            failures: failureCount,
            autoSyncEnabled: guild.auto_sync_enabled,
            lastSuccessfulSync: guild.last_successful_sync
          }
        )
      }
    }

    const staleThreshold = new Date()
    staleThreshold.setHours(staleThreshold.getHours() - 24)

    const { data: staleGuilds, error: staleError } = await supabase
      .from('guild_config')
      .select(
        'guild_code, display_name, last_successful_sync, auto_sync_enabled'
      )
      .eq('enabled', true)
      .eq('auto_sync_enabled', true)
      // `NULL < ts` is NULL, so a bare .lt() would drop never-synced guilds.
      .or(
        `last_successful_sync.is.null,last_successful_sync.lt.${staleThreshold.toISOString()}`
      )
      .limit(20)

    logQueryError('stale-guilds', staleError)
    if (staleGuilds) {
      for (const guild of staleGuilds) {
        const lastSync = guild.last_successful_sync
          ? new Date(guild.last_successful_sync).toLocaleString()
          : 'Never'
        const guildLabel = formatGuildDisplayLabel(guild)
        addSyncAlert(
          'Stale Guild Data',
          `${guildLabel} hasn't synced in 24+ hours (last: ${lastSync})`,
          'warning',
          {
            guildCode: guild.guild_code,
            lastSuccessfulSync: guild.last_successful_sync
          }
        )
      }
    }

    const { data: disabledGuilds, error: disabledError } = await supabase
      .from('guild_config')
      .select('guild_code, display_name, consecutive_sync_failures')
      .eq('enabled', true)
      .eq('auto_sync_enabled', false)
      .gte('consecutive_sync_failures', 3)
      .order('consecutive_sync_failures', { ascending: false })
      .limit(50)

    logQueryError('auto-sync-disabled', disabledError)
    if (disabledGuilds) {
      for (const guild of disabledGuilds) {
        const failureCount = guild.consecutive_sync_failures ?? 0
        const guildLabel = formatGuildDisplayLabel(guild)
        addSyncAlert(
          'Auto-Sync Disabled',
          `${guildLabel} - auto-sync disabled after ${failureCount} failures`,
          'error',
          {
            guildCode: guild.guild_code,
            failures: failureCount
          }
        )
      }
    }

    const { data: invalidKeyGuilds, error: invalidKeyError } = await supabase
      .from('guild_config')
      .select('guild_code, display_name, api_key_is_valid')
      .eq('enabled', true)
      .eq('api_key_is_valid', false)
      .limit(20)

    logQueryError('invalid-api-keys', invalidKeyError)
    if (invalidKeyGuilds) {
      for (const guild of invalidKeyGuilds) {
        const guildLabel = formatGuildDisplayLabel(guild)
        addApiKeyAlert(
          'Invalid API Key',
          `${guildLabel} has an invalid or expired API key`,
          'error',
          {
            guildCode: guild.guild_code,
            errorMessage: 'API key marked invalid'
          }
        )
      }
    }
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error collecting sync health alerts')
  }
}

function savedOperationsDelivery(payload: Record<string, unknown>) {
  const saved = payload.apiKeyIncidentOps
  if (
    saved &&
    typeof saved === 'object' &&
    'status' in saved &&
    saved.status === 'delivered' &&
    'messageId' in saved &&
    typeof saved.messageId === 'string' &&
    saved.messageId.length > 0
  ) {
    return { status: 'delivered' as const, messageId: saved.messageId }
  }
  return null
}

const dailyAlertSummaryHandler: JobHandler = async (payload, ctx) => {
  const healthResults = await runAllHealthChecks({ emitAlerts: true })
  await collectSyncHealthAlerts()

  const apiKeyIncidentNotifications = await sendApiKeyIncidentNotifications({
    source: 'work-queue-daily-alert-summary'
  })
  let apiKeyIncidentOps: Awaited<
    ReturnType<typeof sendApiKeyIncidentOpsAlert>
  > | null = savedOperationsDelivery(payload)
  if (!apiKeyIncidentOps) {
    const delivery = await sendApiKeyIncidentOpsAlert(
      apiKeyIncidentNotifications
    )
    if (delivery.status === 'delivered') {
      // Save before the email summary and final queue settlement. A later retry
      // receives this payload and reuses the confirmed Discord message.
      const { data, error } = await serviceDb()
        .from('work_queue')
        .update({
          payload: { ...payload, apiKeyIncidentOps: delivery } as Json
        })
        .eq('id', ctx.jobId)
        .eq('claimed_by', ctx.workerId)
        .eq('status', 'processing')
        .select('id')
        .single()
      if (error || !data) {
        throw new Error('API key incident operations checkpoint failed')
      }
    }
    apiKeyIncidentOps = delivery
  }

  const { alerts, stats } = getAlertSummary()

  if (alerts.length === 0) {
    logger.info({ jobId: ctx.jobId }, 'No alerts to send')
    return {
      status: 'no-alerts',
      alertCount: 0,
      healthSummary: healthResults.summary,
      apiKeyIncidentNotifications,
      apiKeyIncidentOps
    }
  }

  const result = await sendDailySummary()

  return {
    status: result.sent ? 'sent' : 'send-failed',
    alertCount: result.alertCount,
    stats,
    healthSummary: healthResults.summary,
    apiKeyIncidentNotifications,
    apiKeyIncidentOps,
    error: result.error
  }
}

export function registerDailyAlertSummaryHandler(): void {
  registerJobHandler('daily-alert-summary', dailyAlertSummaryHandler)
}

export const __internal = {
  dailyAlertSummaryHandler,
  collectSyncHealthAlerts
}
