import { createComponentLogger } from '@/app/lib/logging'
import { sleep } from '@/app/lib/utils/async-timeout'
import type { APIInteractionResponseCallbackData } from 'discord-api-types/v10'

const logger = createComponentLogger('discord.followup-message')

export interface DiscordFollowupMessagePayload {
  content?: string
  embeds?: APIInteractionResponseCallbackData['embeds']
  components?: APIInteractionResponseCallbackData['components']
  flags?: number
}

interface FollowupLogger {
  warn: (context: Record<string, unknown>, message: string) => void
  error: (context: Record<string, unknown>, message: string) => void
}

interface SendDiscordFollowupMessageOptions {
  applicationId?: string
  backoffMs?: readonly number[]
  fetchImpl?: typeof fetch
  logger?: FollowupLogger
  maxAttempts?: number
  maxElapsedMs?: number
  sleepFn?: (ms: number) => Promise<void>
  timeoutMs?: number
}

const DEFAULT_DISCORD_APPLICATION_ID =
  process.env.DISCORD_APPLICATION_ID || '1362473802243637389'

const DEFAULT_FOLLOWUP_TIMEOUT_MS = 8_000
const DEFAULT_FOLLOWUP_MAX_ATTEMPTS = 3
const DEFAULT_FOLLOWUP_MAX_ELAPSED_MS = 14 * 60 * 1000
const DEFAULT_FOLLOWUP_BACKOFF_MS = [500, 1_000, 2_000] as const

const parseDelaySeconds = (raw: string | null): number | null => {
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const parseDiscordRetryAfterMs = (
  response: Response,
  body: string
): number | null => {
  const retryAfterSeconds =
    parseDelaySeconds(response.headers.get('retry-after')) ??
    parseDelaySeconds(response.headers.get('x-ratelimit-reset-after'))

  if (retryAfterSeconds !== null) {
    return Math.ceil(retryAfterSeconds * 1000)
  }

  const retryAfterDate = response.headers.get('retry-after')
  if (retryAfterDate) {
    const resetAt = Date.parse(retryAfterDate)
    if (Number.isFinite(resetAt)) {
      return Math.max(0, resetAt - Date.now())
    }
  }

  try {
    const parsed = JSON.parse(body) as { retry_after?: unknown }
    const bodyDelay =
      typeof parsed.retry_after === 'number'
        ? parsed.retry_after
        : typeof parsed.retry_after === 'string'
          ? Number(parsed.retry_after)
          : null

    return bodyDelay !== null && Number.isFinite(bodyDelay) && bodyDelay >= 0
      ? Math.ceil(bodyDelay * 1000)
      : null
  } catch {
    return null
  }
}

export async function sendDiscordFollowupMessage(
  interactionToken: string,
  data: DiscordFollowupMessagePayload,
  options: SendDiscordFollowupMessageOptions = {}
): Promise<void> {
  const applicationId = options.applicationId ?? DEFAULT_DISCORD_APPLICATION_ID
  const backoffMs = options.backoffMs ?? DEFAULT_FOLLOWUP_BACKOFF_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const followupLogger = options.logger ?? logger
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? DEFAULT_FOLLOWUP_MAX_ATTEMPTS
  )
  const maxElapsedMs = Math.max(
    0,
    options.maxElapsedMs ?? DEFAULT_FOLLOWUP_MAX_ELAPSED_MS
  )
  const sleepFn = options.sleepFn ?? sleep
  const timeoutMs = options.timeoutMs ?? DEFAULT_FOLLOWUP_TIMEOUT_MS
  const startedAt = Date.now()

  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`
  const body: Record<string, unknown> = {}
  if (data.content !== undefined) body.content = data.content
  if (data.embeds !== undefined) body.embeds = data.embeds
  if (data.components !== undefined) body.components = data.components
  if (data.flags !== undefined) body.flags = data.flags
  const payload = JSON.stringify(body)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let retryDelayMs: number | null = null

    try {
      const res = await fetchImpl(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (res.ok) return
      if (res.status < 500 && res.status !== 429) {
        const text = await res.text()
        followupLogger.error(
          { status: res.status, body: text },
          'Discord follow-up failed (non-retryable)'
        )
        return
      }
      const text = await res.text()
      if (res.status === 429) {
        retryDelayMs = parseDiscordRetryAfterMs(res, text)
      }
      followupLogger.warn(
        { status: res.status, body: text, attempt, retryDelayMs },
        'Discord follow-up transient HTTP failure, will retry'
      )
    } catch (err) {
      followupLogger.warn(
        { attempt, error: err instanceof Error ? err.message : String(err) },
        'Discord follow-up network error, will retry'
      )
    }

    if (attempt < maxAttempts - 1) {
      const delayMs = retryDelayMs ?? backoffMs[attempt] ?? 0
      const remainingRetryBudgetMs = maxElapsedMs - (Date.now() - startedAt)
      if (delayMs >= remainingRetryBudgetMs) {
        followupLogger.error(
          {
            attempt,
            retryDelayMs: delayMs,
            remainingRetryBudgetMs: Math.max(0, remainingRetryBudgetMs)
          },
          'Discord follow-up retry delay exceeds interaction token budget'
        )
        return
      }
      await sleepFn(delayMs)
    }
  }

  followupLogger.error(
    { attempts: maxAttempts },
    'Discord follow-up failed after all retries'
  )
}
