// pg_cron enqueues with `dedupe_key='alert-summary:<yyyy-mm-dd>'`, so at most one is sent per day.

import {
  sendDailySummary,
  getAlertSummary,
  addSyncAlert,
  addApiKeyAlert
} from '@tacticus/app-core/daily-alert-summary'
import { db } from '@/app/lib/db'
import { runAllHealthChecks } from '@/app/lib/health'
import { sendApiKeyIncidentNotifications } from '@/app/lib/services/api-key-incident-notifications'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { createComponentLogger } from '@/app/lib/logging'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

const logger = createComponentLogger('lib.jobs.daily-alert-summary')

async function collectSyncHealthAlerts(): Promise<void> {
  try {
    const supabase = await db()

    const { data: failedGuilds } = await supabase
      .from('guild_config')
      .select(
        'guild_code, display_name, consecutive_sync_failures, auto_sync_enabled, last_successful_sync'
      )
      .gte('consecutive_sync_failures', 3)
      .order('consecutive_sync_failures', { ascending: false })
      .limit(50)

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

    const { data: staleGuilds } = await supabase
      .from('guild_config')
      .select(
        'guild_code, display_name, last_successful_sync, auto_sync_enabled'
      )
      .eq('auto_sync_enabled', true)
      // `NULL < ts` is NULL, so a bare .lt() would drop never-synced guilds.
      .or(
        `last_successful_sync.is.null,last_successful_sync.lt.${staleThreshold.toISOString()}`
      )
      .limit(20)

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

    const { data: disabledGuilds } = await supabase
      .from('guild_config')
      .select('guild_code, display_name, consecutive_sync_failures')
      .eq('auto_sync_enabled', false)
      .gte('consecutive_sync_failures', 3)
      .order('consecutive_sync_failures', { ascending: false })
      .limit(50)

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

    const { data: invalidKeyGuilds } = await supabase
      .from('guild_config')
      .select('guild_code, display_name, api_key_is_valid')
      .eq('api_key_is_valid', false)
      .limit(20)

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

const dailyAlertSummaryHandler: JobHandler = async (_payload, ctx) => {
  const healthResults = await runAllHealthChecks({ emitAlerts: true })
  await collectSyncHealthAlerts()

  const apiKeyIncidentNotifications = await sendApiKeyIncidentNotifications({
    source: 'work-queue-daily-alert-summary'
  })

  const { alerts, stats } = getAlertSummary()

  if (alerts.length === 0) {
    logger.info({ jobId: ctx.jobId }, 'No alerts to send')
    return {
      status: 'no-alerts',
      alertCount: 0,
      healthSummary: healthResults.summary,
      apiKeyIncidentNotifications
    }
  }

  const result = await sendDailySummary()

  return {
    status: result.sent ? 'sent' : 'send-failed',
    alertCount: result.alertCount,
    stats,
    healthSummary: healthResults.summary,
    apiKeyIncidentNotifications,
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
