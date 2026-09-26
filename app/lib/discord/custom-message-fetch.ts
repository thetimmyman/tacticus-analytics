import 'server-only'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('discord.custom-message-fetch')

// Short TTL so officer edits show on the next dispatch; any failure falls back to the default body.

const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  body: string
  fetchedAtMs: number
}

const cache = new Map<string, CacheEntry>()

const DISCORD_MESSAGE_URL_REGEX =
  /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})$/

export interface ParsedDiscordMessageUrl {
  guildId: string
  channelId: string
  messageId: string
}

export const parseDiscordMessageUrl = (
  url: string
): ParsedDiscordMessageUrl | null => {
  if (typeof url !== 'string') return null
  const match = url.trim().match(DISCORD_MESSAGE_URL_REGEX)
  if (!match) return null
  const guildId = match[1]
  const channelId = match[2]
  const messageId = match[3]
  if (!guildId || !channelId || !messageId) return null
  return { guildId, channelId, messageId }
}

export const fetchDiscordMessageBody = async (
  url: string,
  options?: { nowMs?: number }
): Promise<string | null> => {
  const parsed = parseDiscordMessageUrl(url)
  if (!parsed) return null

  const cacheKey = `${parsed.channelId}|${parsed.messageId}`
  const nowMs = options?.nowMs ?? Date.now()
  const cached = cache.get(cacheKey)
  if (cached && nowMs - cached.fetchedAtMs <= CACHE_TTL_MS) {
    return cached.body
  }

  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    logger.warn({ reason: 'no_bot_token' }, 'discord.custom_message_fetch.skip')
    return null
  }

  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${parsed.channelId}/messages/${parsed.messageId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bot ${token}`,
          'User-Agent': 'TacticusAnalytics (https://tacticusanalytics.com, 1.0)'
        },
        signal: AbortSignal.timeout(5_000)
      }
    )

    if (!response.ok) {
      const status = response.status
      logger.warn(
        {
          status,
          channelId: parsed.channelId,
          messageId: parsed.messageId
        },
        'discord.custom_message_fetch.error'
      )
      return null
    }

    const payload = (await response.json().catch(() => null)) as {
      content?: unknown
    } | null
    const content =
      payload && typeof payload.content === 'string' ? payload.content : null

    if (content === null) return null

    cache.set(cacheKey, { body: content, fetchedAtMs: nowMs })
    return content
  } catch (err) {
    logger.warn(
      {
        channelId: parsed.channelId,
        messageId: parsed.messageId,
        error: err instanceof Error ? err.message : String(err)
      },
      'discord.custom_message_fetch.exception'
    )
    return null
  }
}

export const __clearCustomMessageCache = () => {
  cache.clear()
}
