import 'server-only'
import { createComponentLogger } from '@/app/lib/logging'
import { sleep } from '@/app/lib/utils/async-timeout'

const logger = createComponentLogger('discord.bot-rest-client')

// Status is preserved so callers can tell a verified absence from an unavailable Discord.

const DISCORD_API_BASE = 'https://discord.com/api/v10'
const DEFAULT_TIMEOUT_MS = 5_000
const MAX_RETRY_ON_429 = 1

interface BucketState {
  remaining: number
  resetAtMs: number
}

const buckets = new Map<string, BucketState>()

interface DiscordGuildMember {
  user?: { id: string; username?: string }
  nick: string | null
  roles: string[]
  joined_at: string | null
}

export interface DiscordChannel {
  id: string
  type: number
  guild_id?: string
  name?: string
  parent_id?: string | null
  thread_metadata?: {
    archived?: boolean
    locked?: boolean
  }
}

export interface DiscordMessagePreview {
  id: string
  channel_id?: string
  attachments?: unknown[]
}

export interface DiscordGuildSummary {
  id: string
  owner_id: string
  name?: string
}

export interface DiscordRole {
  id: string
  name?: string
  /** Decimal string: the bitfield can exceed 2^53. */
  permissions: string
}

export interface DiscordRestReadResult<T> {
  ok: boolean
  status: number
  body: T | null
}

type DiscordRestJson = unknown

const extractDiscordErrorCode = (body: DiscordRestJson): number | null => {
  if (body && typeof body === 'object' && 'code' in body) {
    const code = (body as { code?: number }).code
    if (typeof code === 'number') return code
  }
  return null
}

interface FetchOptions {
  method: 'GET' | 'PUT' | 'DELETE' | 'POST' | 'PATCH'
  bucketKey: string
  jsonBody?: DiscordRestJson
  auditLogReason?: string
  maxRateLimitWaitMs?: number
  rateLimitWaitedMs?: number
  nowMs?: number
  attempt?: number
}

const callDiscord = async (
  path: string,
  opts: FetchOptions
): Promise<{ ok: boolean; status: number; body: unknown }> => {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    logger.warn(
      { path, reason: 'no_bot_token' },
      'discord.bot_rest_client.skip'
    )
    return { ok: false, status: 0, body: null }
  }

  const nowMs = opts.nowMs ?? Date.now()
  let rateLimitWaitedMs = opts.rateLimitWaitedMs ?? 0
  const maxRateLimitWaitMs = opts.maxRateLimitWaitMs ?? Number.POSITIVE_INFINITY
  const bucket = buckets.get(opts.bucketKey)
  if (bucket && bucket.remaining <= 0 && nowMs < bucket.resetAtMs) {
    const wait = Math.max(0, bucket.resetAtMs - nowMs)
    if (wait > 0) {
      if (wait > maxRateLimitWaitMs - rateLimitWaitedMs) {
        logger.warn(
          { path, bucketKey: opts.bucketKey, waitMs: wait },
          'discord.bot_rest_client.rate_limit_wait_budget_exhausted'
        )
        return { ok: false, status: 429, body: null }
      }
      logger.debug(
        { path, bucketKey: opts.bucketKey, waitMs: wait },
        'discord.bot_rest_client.bucket_wait'
      )
      await sleep(wait)
      rateLimitWaitedMs += wait
    }
  }

  let response: Response
  try {
    response = await fetch(`${DISCORD_API_BASE}${path}`, {
      method: opts.method,
      headers: {
        Authorization: `Bot ${token}`,
        'User-Agent': 'TacticusAnalytics (https://tacticusanalytics.com, 1.0)',
        'Content-Type': 'application/json',
        ...(opts.auditLogReason
          ? {
              'X-Audit-Log-Reason': encodeURIComponent(opts.auditLogReason)
            }
          : {})
      },
      ...(opts.jsonBody !== undefined
        ? { body: JSON.stringify(opts.jsonBody) }
        : {}),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    })
  } catch (err) {
    logger.warn(
      {
        path,
        method: opts.method,
        error: err instanceof Error ? err.message : String(err)
      },
      'discord.bot_rest_client.fetch_exception'
    )
    return { ok: false, status: 0, body: null }
  }

  const remainingHeader = response.headers.get('X-RateLimit-Remaining')
  const resetAfterHeader = response.headers.get('X-RateLimit-Reset-After')
  if (remainingHeader !== null && resetAfterHeader !== null) {
    const remaining = parseInt(remainingHeader, 10)
    const resetAfterMs = parseFloat(resetAfterHeader) * 1000
    if (Number.isFinite(remaining) && Number.isFinite(resetAfterMs)) {
      buckets.set(opts.bucketKey, {
        remaining,
        resetAtMs: nowMs + resetAfterMs
      })
    }
  }

  if (response.status === 429) {
    const attempt = opts.attempt ?? 0
    const body = (await response.json().catch(() => null)) as {
      retry_after?: number
    } | null
    const retryAfterSec = body?.retry_after ?? 1
    const retryMs = Math.max(100, Math.floor(retryAfterSec * 1000))
    if (
      attempt < MAX_RETRY_ON_429 &&
      retryMs <= maxRateLimitWaitMs - rateLimitWaitedMs
    ) {
      logger.warn(
        { path, retryMs, attempt },
        'discord.bot_rest_client.rate_limited_retry'
      )
      await sleep(retryMs)
      return callDiscord(path, {
        ...opts,
        attempt: attempt + 1,
        rateLimitWaitedMs: rateLimitWaitedMs + retryMs
      })
    }
    logger.warn(
      { path, retryMs, attempt },
      'discord.bot_rest_client.rate_limited_giveup'
    )
    return { ok: false, status: 429, body }
  }

  if (response.status === 204) {
    return { ok: true, status: 204, body: null }
  }

  const body = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, body }
}

export interface DiscordGuildMemberRoleSnapshot {
  roles: string[]
  nick: string | null
}

export interface DiscordGuildMemberRoleReadResult extends DiscordRestReadResult<DiscordGuildMemberRoleSnapshot> {
  errorCode: number | null
}

/** Role cleanup treats 404 as proof of no roles, so other failures must stay distinct. */
export const getGuildMemberRoleSnapshot = async (
  guildId: string,
  userId: string,
  options?: { nowMs?: number; maxRateLimitWaitMs?: number }
): Promise<DiscordGuildMemberRoleReadResult> => {
  if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(userId)) {
    return { ok: false, status: 0, body: null, errorCode: null }
  }
  const result = await callDiscord(`/guilds/${guildId}/members/${userId}`, {
    method: 'GET',
    bucketKey: `members_get:${guildId}`,
    nowMs: options?.nowMs,
    maxRateLimitWaitMs: options?.maxRateLimitWaitMs
  })
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      body: null,
      errorCode: extractDiscordErrorCode(result.body)
    }
  }
  const member = result.body as DiscordGuildMember | null
  if (
    !member ||
    !Array.isArray(member.roles) ||
    !member.roles.every((roleId) => /^\d{17,20}$/.test(roleId))
  ) {
    return {
      ok: false,
      status: result.status,
      body: null,
      errorCode: null
    }
  }
  return {
    ok: true,
    status: result.status,
    body: { roles: member.roles, nick: member.nick },
    errorCode: null
  }
}

export const getGuildMember = async (
  guildId: string,
  userId: string,
  options?: { nowMs?: number }
): Promise<DiscordGuildMemberRoleSnapshot | null> => {
  const result = await getGuildMemberRoleSnapshot(guildId, userId, options)
  return result.ok ? result.body : null
}

export const getGuild = async (
  guildId: string,
  options?: { nowMs?: number }
): Promise<DiscordRestReadResult<DiscordGuildSummary>> => {
  if (!/^\d{17,20}$/.test(guildId)) {
    return { ok: false, status: 0, body: null }
  }

  const result = await callDiscord(`/guilds/${guildId}`, {
    method: 'GET',
    bucketKey: `guild_get:${guildId}`,
    nowMs: options?.nowMs
  })

  return {
    ok: result.ok,
    status: result.status,
    body: result.ok ? (result.body as DiscordGuildSummary) : null
  }
}

export const getGuildRoles = async (
  guildId: string,
  options?: { nowMs?: number }
): Promise<DiscordRestReadResult<DiscordRole[]>> => {
  if (!/^\d{17,20}$/.test(guildId)) {
    return { ok: false, status: 0, body: null }
  }

  const result = await callDiscord(`/guilds/${guildId}/roles`, {
    method: 'GET',
    bucketKey: `roles_get:${guildId}`,
    nowMs: options?.nowMs
  })

  return {
    ok: result.ok,
    status: result.status,
    body:
      result.ok && Array.isArray(result.body)
        ? (result.body as DiscordRole[])
        : null
  }
}

export const getDiscordChannel = async (
  channelId: string,
  options?: { nowMs?: number }
): Promise<DiscordRestReadResult<DiscordChannel>> => {
  if (!/^\d{17,20}$/.test(channelId)) {
    return { ok: false, status: 0, body: null }
  }

  const result = await callDiscord(`/channels/${channelId}`, {
    method: 'GET',
    bucketKey: `channels_get:${channelId}`,
    nowMs: options?.nowMs
  })

  return {
    ok: result.ok,
    status: result.status,
    body: result.ok ? (result.body as DiscordChannel) : null
  }
}

export const getDiscordChannelMessages = async (
  channelId: string,
  options?: { limit?: number; nowMs?: number }
): Promise<DiscordRestReadResult<DiscordMessagePreview[]>> => {
  if (!/^\d{17,20}$/.test(channelId)) {
    return { ok: false, status: 0, body: null }
  }

  const limit = Math.min(10, Math.max(1, Math.trunc(options?.limit ?? 1)))
  const result = await callDiscord(
    `/channels/${channelId}/messages?limit=${limit}`,
    {
      method: 'GET',
      bucketKey: `messages_get:${channelId}`,
      nowMs: options?.nowMs
    }
  )

  return {
    ok: result.ok,
    status: result.status,
    body:
      result.ok && Array.isArray(result.body)
        ? (result.body as DiscordMessagePreview[])
        : null
  }
}

export const addGuildMemberRole = async (
  guildId: string,
  userId: string,
  roleId: string,
  options?: { nowMs?: number; reason?: string }
): Promise<{ ok: boolean; status: number }> => {
  if (
    !/^\d{17,20}$/.test(guildId) ||
    !/^\d{17,20}$/.test(userId) ||
    !/^\d{17,20}$/.test(roleId)
  ) {
    return { ok: false, status: 0 }
  }
  const result = await callDiscord(
    `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    {
      method: 'PUT',
      bucketKey: `roles_put:${guildId}`,
      nowMs: options?.nowMs,
      auditLogReason: options?.reason
    }
  )
  return { ok: result.ok, status: result.status }
}

/** Success is never proof of absence: read the member's roles back before trusting cleanup. */
export const removeGuildMemberRole = async (
  guildId: string,
  userId: string,
  roleId: string,
  options?: {
    nowMs?: number
    reason?: string
    maxRateLimitWaitMs?: number
  }
): Promise<{ ok: boolean; status: number; errorCode: number | null }> => {
  if (
    !/^\d{17,20}$/.test(guildId) ||
    !/^\d{17,20}$/.test(userId) ||
    !/^\d{17,20}$/.test(roleId)
  ) {
    return { ok: false, status: 0, errorCode: null }
  }
  const result = await callDiscord(
    `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    {
      method: 'DELETE',
      bucketKey: `roles_delete:${guildId}`,
      nowMs: options?.nowMs,
      auditLogReason: options?.reason,
      maxRateLimitWaitMs: options?.maxRateLimitWaitMs
    }
  )
  return {
    ok: result.ok,
    status: result.status,
    errorCode: result.ok ? null : extractDiscordErrorCode(result.body)
  }
}

// Webhooks strip message components, so interactive messages are bot-authored.

export interface DiscordRestWriteResult {
  ok: boolean
  status: number
  errorCode: number | null
  message: DiscordMessagePreview | null
}

const toWriteResult = (result: {
  ok: boolean
  status: number
  body: DiscordRestJson
}): DiscordRestWriteResult => ({
  ok: result.ok,
  status: result.status,
  errorCode: result.ok ? null : extractDiscordErrorCode(result.body),
  message:
    result.ok && result.body && typeof result.body === 'object'
      ? (result.body as DiscordMessagePreview)
      : null
})

export const createChannelMessage = async (
  channelId: string,
  payload: DiscordRestJson,
  options?: { nowMs?: number }
): Promise<DiscordRestWriteResult> => {
  if (!/^\d{17,20}$/.test(channelId)) {
    return { ok: false, status: 0, errorCode: null, message: null }
  }
  const result = await callDiscord(`/channels/${channelId}/messages`, {
    method: 'POST',
    bucketKey: `messages_post:${channelId}`,
    jsonBody: payload,
    nowMs: options?.nowMs
  })
  return toWriteResult(result)
}

/** Webhook-authored messages fail with 50005. */
export const editChannelMessage = async (
  channelId: string,
  messageId: string,
  payload: DiscordRestJson,
  options?: { nowMs?: number }
): Promise<DiscordRestWriteResult> => {
  if (!/^\d{17,20}$/.test(channelId) || !/^\d{17,20}$/.test(messageId)) {
    return { ok: false, status: 0, errorCode: null, message: null }
  }
  const result = await callDiscord(
    `/channels/${channelId}/messages/${messageId}`,
    {
      method: 'PATCH',
      bucketKey: `messages_patch:${channelId}`,
      jsonBody: payload,
      nowMs: options?.nowMs
    }
  )
  return toWriteResult(result)
}

export const deleteChannelMessage = async (
  channelId: string,
  messageId: string,
  options?: { nowMs?: number }
): Promise<{ ok: boolean; status: number; errorCode: number | null }> => {
  if (!/^\d{17,20}$/.test(channelId) || !/^\d{17,20}$/.test(messageId)) {
    return { ok: false, status: 0, errorCode: null }
  }
  const result = await callDiscord(
    `/channels/${channelId}/messages/${messageId}`,
    {
      method: 'DELETE',
      bucketKey: `messages_delete:${channelId}`,
      nowMs: options?.nowMs
    }
  )
  return {
    ok: result.ok,
    status: result.status,
    errorCode: result.ok ? null : extractDiscordErrorCode(result.body)
  }
}

export const __clearBotRestBuckets = () => {
  buckets.clear()
}
