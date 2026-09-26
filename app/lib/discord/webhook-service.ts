import { createHash } from 'crypto'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import {
  sleep as delay,
  withResponseBodyTimeout
} from '@/app/lib/utils/async-timeout'

const logger = createComponentLogger('discord-webhooks')
import {
  CircuitBreaker,
  CircuitOpenError,
  DEFAULT_CIRCUIT_CONFIG,
  alertOnStateChange,
  notificationQueue,
  createQueueProcessorCallback
} from '@/app/lib/resilience'
import type {
  DiscordWebhookLogEntry,
  DiscordWebhookPayload,
  WebhookError,
  WebhookPostOptions,
  WebhookPostResult
} from './types'

const queueProcessor = createQueueProcessorCallback()
const handleStateChange = async (
  circuitName: string,
  previousState: 'CLOSED' | 'OPEN' | 'HALF_OPEN',
  newState: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
) => {
  await alertOnStateChange(circuitName, previousState, newState)
  await queueProcessor(circuitName, previousState, newState)
}

const discordCircuit = new CircuitBreaker({
  name: 'discord-webhooks',
  ...DEFAULT_CIRCUIT_CONFIG,
  failureThreshold: 10,
  successThreshold: 2,
  timeout: 30000,
  onStateChange: handleStateChange
})

type RateLimitConfig = {
  requestsPerMinute: number
  burstLimit: number
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  requestsPerMinute: 30,
  burstLimit: 5
}

export class WebhookRateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>()

  constructor(private config: RateLimitConfig) {}

  private refillBucket(bucket: { tokens: number; lastRefill: number }) {
    const now = Date.now()
    const elapsedMs = now - bucket.lastRefill
    if (elapsedMs <= 0) return

    const tokensToAdd = (elapsedMs * this.config.requestsPerMinute) / 60000
    bucket.tokens = Math.min(
      this.config.burstLimit,
      bucket.tokens + tokensToAdd
    )
    bucket.lastRefill = now
  }

  async waitForSlot(key: string): Promise<void> {
    const bucket = this.buckets.get(key) || {
      tokens: this.config.burstLimit,
      lastRefill: Date.now()
    }

    this.refillBucket(bucket)

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      this.buckets.set(key, bucket)
      return
    }

    const tokensNeeded = 1 - bucket.tokens
    const waitMs = Math.ceil(
      (tokensNeeded * 60000) / this.config.requestsPerMinute
    )
    await delay(waitMs)

    this.refillBucket(bucket)
    bucket.tokens = Math.max(bucket.tokens - 1, 0)
    this.buckets.set(key, bucket)
  }
}

const rateLimiter = new WebhookRateLimiter(DEFAULT_RATE_LIMIT_CONFIG)

const DISCORD_WEBHOOK_REGEX =
  /^https:\/\/(ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+(?:\?.*)?$/i

const isValidWebhookUrl = (webhookUrl: string) =>
  DISCORD_WEBHOOK_REGEX.test(webhookUrl)

const buildWebhookUrl = (
  webhookUrl: string,
  waitForResponse?: boolean,
  threadId?: string | null
) => {
  try {
    const url = new URL(webhookUrl)
    if (waitForResponse) url.searchParams.set('wait', 'true')
    if (threadId) url.searchParams.set('thread_id', threadId)
    return url.toString()
  } catch {
    const params: string[] = []
    if (threadId) params.push(`thread_id=${threadId}`)
    if (waitForResponse) params.push('wait=true')
    if (params.length === 0) return webhookUrl
    const separator = webhookUrl.includes('?') ? '&' : '?'
    return `${webhookUrl}${separator}${params.join('&')}`
  }
}

const getPayloadPreview = (payload: DiscordWebhookPayload) => {
  try {
    return JSON.stringify(payload).slice(0, 200)
  } catch {
    return '[unserializable payload]'
  }
}

const hashWebhookUrl = (webhookUrl: string) =>
  createHash('sha256').update(webhookUrl).digest('hex')

const parseRetryAfter = (text: string) => {
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed.retry_after === 'number') {
      return parsed.retry_after
    }
  } catch {
    return null
  }

  return null
}

export const logDiscordWebhookDelivery = async (
  entry: DiscordWebhookLogEntry
) => {
  try {
    const supabase = serviceDb()

    const { error } = await supabase.from('discord_webhook_logs').insert({
      guild_code: entry.guildCode,
      webhook_type: entry.webhookType,
      webhook_url_hash: entry.webhookUrlHash,
      payload_preview: entry.payloadPreview,
      mentioned_roles: entry.mentionedRoles ?? null,
      status: entry.status,
      error_message: entry.errorMessage,
      retry_count: entry.retryCount,
      delivered_at: entry.deliveredAt || null
    })
    if (error) {
      // PostgREST returns failures instead of throwing; surface them so the audit trail is never silently empty.
      logger.warn(
        {
          error: error.message,
          guildCode: entry.guildCode,
          webhookType: entry.webhookType,
          status: entry.status
        },
        'discord_webhook_logs insert REJECTED — delivery audit row lost'
      )
    }
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        guildCode: entry.guildCode,
        webhookType: entry.webhookType
      },
      'Failed to log Discord webhook delivery'
    )
  }
}

export const postToWebhook = async (
  webhookUrl: string,
  payload: DiscordWebhookPayload,
  options: WebhookPostOptions = {}
): Promise<WebhookPostResult> => {
  if (!isValidWebhookUrl(webhookUrl)) {
    const error: WebhookError = {
      type: 'invalid_webhook',
      message: 'Invalid Discord webhook URL'
    }

    await maybeLogDelivery(webhookUrl, payload, options, {
      ok: false,
      status: null,
      attempts: 0,
      error
    })

    return {
      ok: false,
      status: null,
      attempts: 0,
      error
    }
  }

  try {
    return await discordCircuit.execute(async () => {
      return await executeWebhookRequest(webhookUrl, payload, options)
    })
  } catch (error) {
    if (error instanceof CircuitOpenError) {
      logger.warn(
        {
          timeUntilRetry: error.timeUntilHalfOpen,
          webhookUrlHash: hashWebhookUrl(webhookUrl)
        },
        'Discord webhook circuit is open, queueing notification'
      )

      if (options.queueOnCircuitOpen !== false) {
        notificationQueue.enqueue(
          'discord-webhooks',
          buildWebhookUrl(
            webhookUrl,
            options.waitForResponse,
            options.threadId
          ),
          payload,
          `Circuit open - queued for retry`
        )
      }

      const circuitOpenError: WebhookError = {
        type: 'server_error',
        message: `Discord service temporarily unavailable. Notification queued for retry.`
      }

      const result: WebhookPostResult = {
        ok: false,
        status: null,
        attempts: 0,
        error: circuitOpenError
      }

      await maybeLogDelivery(webhookUrl, payload, options, result)
      return result
    }
    throw error
  }
}

const executeWebhookRequest = async (
  webhookUrl: string,
  payload: DiscordWebhookPayload,
  options: WebhookPostOptions
): Promise<WebhookPostResult> => {
  const waitForResponse = options.waitForResponse ?? false
  const rateLimitEnabled = options.rateLimit ?? true
  const maxRetries = options.retries ?? 3
  const retryDelayMs = options.retryDelayMs ?? 1000
  const timeoutMs = options.timeoutMs ?? 10000

  let lastError: WebhookError | undefined
  let responseStatus: number | null = null
  let responseBody: string | undefined
  let attempts = 0

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const attemptNumber = attempt + 1
    attempts = attemptNumber
    const url = buildWebhookUrl(webhookUrl, waitForResponse, options.threadId)

    if (rateLimitEnabled) {
      await rateLimiter.waitForSlot(hashWebhookUrl(webhookUrl))
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      const response = withResponseBodyTimeout(
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        }),
        timeoutMs,
        'Discord webhook response',
        { onTimeout: () => controller.abort() }
      )

      clearTimeout(timeoutId)
      responseStatus = response.status

      if (response.ok) {
        let data: unknown = undefined
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          try {
            data = await response.json()
          } catch {
            data = undefined
          }
        }

        const result: WebhookPostResult = {
          ok: true,
          status: response.status,
          attempts,
          data
        }

        await maybeLogDelivery(webhookUrl, payload, options, result)
        return result
      }

      responseBody = await response.text().catch(() => '')
      const retryAfter =
        response.status === 429 ? parseRetryAfter(responseBody) : null

      lastError = buildWebhookError(response.status, responseBody, retryAfter)

      if (!shouldRetry(lastError)) {
        break
      }

      if (attempt < maxRetries) {
        const backoffDelay = retryDelayMs * Math.pow(2, attempt)
        const waitTime =
          lastError.type === 'rate_limited' && retryAfter
            ? Math.max(backoffDelay, retryAfter * 1000)
            : backoffDelay
        await delay(waitTime)
      }
    } catch (error) {
      lastError = {
        type: 'network_error',
        message: error instanceof Error ? error.message : 'Network error'
      }

      if (attempt < maxRetries) {
        const backoffDelay = retryDelayMs * Math.pow(2, attempt)
        await delay(backoffDelay)
        continue
      }
    }
  }

  const finalResult: WebhookPostResult = {
    ok: false,
    status: responseStatus,
    attempts,
    error: lastError,
    responseBody
  }

  if (
    !finalResult.ok &&
    lastError &&
    (lastError.type === 'server_error' || lastError.type === 'network_error')
  ) {
    await maybeLogDelivery(webhookUrl, payload, options, finalResult)
    throw new Error(`Discord webhook failed: ${lastError.message}`)
  }

  await maybeLogDelivery(webhookUrl, payload, options, finalResult)
  return finalResult
}

const buildWebhookError = (
  status: number,
  body: string,
  retryAfter?: number | null
): WebhookError => {
  if (status === 429) {
    return {
      type: 'rate_limited',
      message: 'Discord rate limit reached',
      status,
      retryAfter: retryAfter ?? undefined
    }
  }

  if (status === 401 || status === 403 || status === 404 || status === 400) {
    return {
      type: 'invalid_webhook',
      message: body || 'Discord rejected the webhook request',
      status
    }
  }

  if (status >= 500) {
    return {
      type: 'server_error',
      message: body || 'Discord server error',
      status
    }
  }

  return {
    type: 'server_error',
    message: body || `Discord error (${status})`,
    status
  }
}

const shouldRetry = (error: WebhookError) =>
  error.type === 'rate_limited' ||
  error.type === 'server_error' ||
  error.type === 'network_error'

const maybeLogDelivery = async (
  webhookUrl: string,
  payload: DiscordWebhookPayload,
  options: WebhookPostOptions,
  result: WebhookPostResult
) => {
  if (!options.logDelivery || !options.guildCode || !options.webhookType) {
    return
  }

  const status = result.ok
    ? 'delivered'
    : result.error?.type === 'rate_limited'
      ? 'rate_limited'
      : 'failed'
  const mentionedRoles =
    result.ok && payload.allowed_mentions?.roles?.length
      ? Array.from(new Set(payload.allowed_mentions.roles))
      : undefined

  const entry: DiscordWebhookLogEntry = {
    guildCode: options.guildCode,
    webhookType: options.webhookType,
    webhookUrlHash: hashWebhookUrl(webhookUrl),
    payloadPreview: getPayloadPreview(payload),
    mentionedRoles,
    status,
    errorMessage: result.error?.message,
    retryCount: Math.max(result.attempts - 1, 0),
    deliveredAt: result.ok ? new Date().toISOString() : null
  }

  await options.logDelivery(entry)
}

export { discordCircuit }

notificationQueue.setSendFunction(
  async (webhookUrl: string, payload: unknown) => {
    const result = await postToWebhook(
      webhookUrl,
      payload as DiscordWebhookPayload,
      { queueOnCircuitOpen: false } // Don't re-queue on failure
    )
    return result.ok
  }
)
