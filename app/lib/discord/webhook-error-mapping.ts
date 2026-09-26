import { Errors } from '@/app/lib/errors/AppError'
import type { createComponentLogger } from '@/app/lib/logging'

type ComponentLogger = ReturnType<typeof createComponentLogger>

/** Mapping only: no retry or breaker, unlike postToWebhook. */
export async function throwDiscordWebhookError(
  response: Response,
  opts: {
    endpoint: string
    logger: ComponentLogger
    logMessage: string
    logContext?: Record<string, unknown>
    genericStatus?: number
    notFoundMessage?: string
    extraMeta?: Record<string, unknown>
  }
): Promise<never> {
  let errorText = ''
  try {
    errorText = await response.text()
  } catch {
    errorText = 'Could not parse error response'
  }

  opts.logger.error(
    {
      status: response.status,
      statusText: response.statusText,
      error: errorText,
      ...opts.logContext
    },
    opts.logMessage
  )

  let discordErrorMessage: string | null = null
  try {
    const parsed = JSON.parse(errorText)
    if (parsed && typeof parsed.message === 'string') {
      discordErrorMessage = parsed.message
    }
  } catch {
    // Not JSON; use the raw text.
  }

  const meta = { endpoint: opts.endpoint, ...opts.extraMeta }

  if (response.status === 404) {
    throw Errors.discordWebhookInvalid(
      opts.notFoundMessage ??
        'Discord webhook not found. Please check the webhook URL is correct.',
      {
        ...meta,
        details: 'Webhook URL may be incorrect or webhook may have been deleted'
      }
    )
  } else if (response.status === 401 || response.status === 403) {
    throw Errors.discordWebhookInvalid(
      'Discord webhook authentication failed. The webhook may have been deleted or regenerated.',
      { ...meta, details: 'Webhook authentication failed' }
    )
  } else if (response.status === 400) {
    const message = discordErrorMessage || 'Invalid message format'
    throw Errors.external(`Discord rejected the message: ${message}`, 400, {
      ...meta,
      details: 'Discord API rejected the message format'
    })
  } else if (response.status === 429) {
    throw Errors.rateLimit()
  }

  throw Errors.external(
    `Discord API error (${response.status}): ${discordErrorMessage || errorText || 'Unknown error'}`,
    opts.genericStatus ?? response.status,
    {
      ...meta,
      details: `Discord API returned status ${response.status}`
    }
  )
}
