import {
  SERVICE_TIMEOUTS,
  withResponseBodyTimeout
} from '@/app/lib/utils/async-timeout'

export async function postDiscordWebhookWithTimeout(
  webhookUrl: string,
  payload: unknown,
  timeoutMs = SERVICE_TIMEOUTS.DISCORD_WEBHOOK
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    return withResponseBodyTimeout(
      response,
      timeoutMs,
      'Discord webhook response',
      {
        onTimeout: () => controller.abort()
      }
    )
  } finally {
    clearTimeout(timeoutId)
  }
}
