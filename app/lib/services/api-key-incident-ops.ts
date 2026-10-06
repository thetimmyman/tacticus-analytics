import 'server-only'
import { postDiscordWebhookWithTimeout } from '@/app/lib/discord/webhook-fetch'
import { createComponentLogger } from '@/app/lib/logging'
import type { ApiKeyIncidentNotificationResult } from './api-key-incident-notifications'

const logger = createComponentLogger('lib.services.api-key-incident-ops')

type IncidentRollup = Pick<
  ApiKeyIncidentNotificationResult,
  | 'noRecipientEscalationDays'
  | 'staleInvalidKeyIncidentsWithoutRecipients'
  | 'oldestStaleInvalidKeyIncidentDays'
>

// The daily work-queue job supplies the persisted daily dedupe boundary.
// A failed delivery throws so the job retries instead of acknowledging the alert.
export async function sendApiKeyIncidentOpsAlert(rollup: IncidentRollup) {
  const incidentCount = rollup.staleInvalidKeyIncidentsWithoutRecipients
  if (incidentCount === 0) return { status: 'not-needed' as const }

  const webhook = process.env.MONITORING_WEBHOOK_URL?.trim()
  if (
    !webhook ||
    process.env.DISCORD_ALERTS_ENABLED?.toLowerCase() !== 'true'
  ) {
    throw new Error(
      'API key incident operations webhook is not enabled/configured'
    )
  }

  try {
    const url = new URL(webhook)
    // Discord confirms the saved message and returns its ID when wait=true.
    url.searchParams.set('wait', 'true')
    const response = await postDiscordWebhookWithTimeout(url.toString(), {
      username: 'Tacticus Analytics Monitor',
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: 'Invalid API keys without notification recipients',
          description:
            `${incidentCount} invalid API key incident(s) have been open for more than ` +
            `${rollup.noRecipientEscalationDays} days with no eligible email recipients. ` +
            'Operations must arrange guild reauthentication or link a leadership account.',
          color: 0xffaa00,
          fields: [
            { name: 'Incidents', value: String(incidentCount), inline: true },
            {
              name: 'Oldest incident (days)',
              value: String(rollup.oldestStaleInvalidKeyIncidentDays),
              inline: true
            }
          ]
        }
      ]
    })
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        '[api-key-notifications] Operations webhook rejected the rollup'
      )
      throw new Error(`Operations webhook returned HTTP ${response.status}`)
    }
    const message: unknown = await response.json()
    if (
      !message ||
      typeof message !== 'object' ||
      !('id' in message) ||
      typeof message.id !== 'string' ||
      !message.id
    ) {
      throw new Error('Operations webhook did not confirm a saved message')
    }
    logger.info(
      { incidentCount, messageId: message.id },
      '[api-key-notifications] Operations rollup delivered'
    )
    return { status: 'delivered' as const, messageId: message.id }
  } catch {
    // Fetch/URL errors can include the webhook credential; keep them out of logs.
    throw new Error('API key incident operations delivery failed')
  }
}
