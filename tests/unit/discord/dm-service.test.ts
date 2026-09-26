import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendDiscordDirectMessage } from '@/app/lib/discord/dm-service'

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  })
}))

const CHANNELS_URL = 'https://discord.com/api/v10/users/@me/channels'
const messagesUrl = (channelId: string) =>
  `https://discord.com/api/v10/channels/${channelId}/messages`

let mockFetch: ReturnType<typeof vi.fn>
const originalEnv = process.env

const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  headers: {
    get: (name: string) =>
      headers[name] ??
      headers[
        Object.keys(headers).find(
          (k) => k.toLowerCase() === name.toLowerCase()
        ) ?? ''
      ] ??
      null
  }
})

const nonJsonResponse = (status: number) => ({
  ok: false,
  status,
  json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
  headers: { get: () => null }
})

const requestInit = (call: number): RequestInit =>
  mockFetch.mock.calls[call][1] as RequestInit

const requestBody = (call: number): Record<string, unknown> =>
  JSON.parse(String(requestInit(call).body))

const authHeader = (call: number): string =>
  (requestInit(call).headers as Record<string, string>).Authorization

describe('sendDiscordDirectMessage', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, DISCORD_BOT_TOKEN: 'test-bot-token' }
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    process.env = originalEnv
  })

  describe('configuration', () => {
    it('fails with no_bot_token and never calls Discord when the token is missing', async () => {
      delete process.env.DISCORD_BOT_TOKEN

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(result).toEqual({ ok: false, reason: 'no_bot_token' })
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('happy path', () => {
    it('creates a DM channel then posts the message', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { id: 'dm-channel-1' }))
        .mockResolvedValueOnce(jsonResponse(200, { id: 'message-1' }))

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'Your tokens are full'
      })

      expect(result).toEqual({ ok: true, channelId: 'dm-channel-1' })
      expect(mockFetch).toHaveBeenCalledTimes(2)

      expect(mockFetch.mock.calls[0][0]).toBe(CHANNELS_URL)
      expect(requestInit(0).method).toBe('POST')
      expect(requestBody(0)).toEqual({ recipient_id: 'discord-1' })

      expect(mockFetch.mock.calls[1][0]).toBe(messagesUrl('dm-channel-1'))
      expect(requestInit(1).method).toBe('POST')
      expect(requestBody(1)).toEqual({
        content: 'Your tokens are full',
        allowed_mentions: { parse: [] }
      })
    })

    it('suppresses all mentions on the send', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { id: 'dm-channel-1' }))
        .mockResolvedValueOnce(jsonResponse(200, { id: 'message-1' }))

      await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: '@everyone tokens up'
      })

      expect(requestBody(1).allowed_mentions).toEqual({ parse: [] })
    })

    it('authorizes both calls with the bot token', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { id: 'dm-channel-1' }))
        .mockResolvedValueOnce(jsonResponse(200, { id: 'message-1' }))

      await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(authHeader(0)).toBe('Bot test-bot-token')
      expect(authHeader(1)).toBe('Bot test-bot-token')
    })
  })

  describe('cached channel reuse', () => {
    it('skips channel creation when a cached channel id is supplied', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { id: 'message-1' }))

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello',
        cachedChannelId: 'cached-channel'
      })

      expect(result).toEqual({ ok: true, channelId: 'cached-channel' })
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0][0]).toBe(messagesUrl('cached-channel'))
    })

    it('re-creates the channel once and retries when the cached channel 404s', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(404, { message: 'Unknown Channel' })
        )
        .mockResolvedValueOnce(jsonResponse(200, { id: 'fresh-channel' }))
        .mockResolvedValueOnce(jsonResponse(200, { id: 'message-1' }))

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello',
        cachedChannelId: 'stale-channel'
      })

      expect(result).toEqual({ ok: true, channelId: 'fresh-channel' })
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(mockFetch.mock.calls[0][0]).toBe(messagesUrl('stale-channel'))
      expect(mockFetch.mock.calls[1][0]).toBe(CHANNELS_URL)
      expect(mockFetch.mock.calls[2][0]).toBe(messagesUrl('fresh-channel'))
    })

    it('does not retry a 404 on a freshly created (non-cached) channel', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { id: 'dm-channel-1' }))
        .mockResolvedValueOnce(
          jsonResponse(404, { message: 'Unknown Channel' })
        )

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(result).toMatchObject({
        ok: false,
        reason: 'error',
        step: 'message',
        status: 404
      })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('failure classification', () => {
    // A codeless 403 may be a bot fault; dm_blocked strikes the recipient, so only
    // recipient-specific evidence may produce it or one fault silences the cohort.
    it('classifies a codeless 403 on channel creation as retryable error, NOT dm_blocked', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(403, { message: 'Missing Access' })
      )

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(result).toMatchObject({
        ok: false,
        reason: 'error',
        step: 'channel',
        status: 403
      })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('classifies a 403 on message send as dm_blocked at the message step', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { id: 'dm-channel-1' }))
        .mockResolvedValueOnce(jsonResponse(403, { message: 'Forbidden' }))

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(result).toMatchObject({
        ok: false,
        reason: 'dm_blocked',
        step: 'message'
      })
    })

    it('classifies Discord code 50007 as dm_blocked even on a non-403 status', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(400, {
          code: 50007,
          message: 'Cannot send messages to this user'
        })
      )

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(result).toMatchObject({
        ok: false,
        reason: 'dm_blocked',
        step: 'channel',
        status: 400
      })
    })

    it('classifies a codeless 403 on the MESSAGE step as dm_blocked', async () => {
      // The channel opened, so a 403 on send is the recipient's DM privacy setting.
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { id: 'dm-channel-1' }))
        .mockResolvedValueOnce(jsonResponse(403, { message: 'Forbidden' }))

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(result).toMatchObject({
        ok: false,
        reason: 'dm_blocked',
        step: 'message',
        status: 403
      })
    })

    it('does NOT treat a bot-side 403 (code 50001) on the message step as dm_blocked', async () => {
      // A non-50007 code is not recipient-specific, so it stays retryable.
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { id: 'dm-channel-1' }))
        .mockResolvedValueOnce(
          jsonResponse(403, { code: 50001, message: 'Missing Access' })
        )

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(result).toMatchObject({ ok: false, reason: 'error', status: 403 })
    })

    it('classifies a 500 on message send as a generic error', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { id: 'dm-channel-1' }))
        .mockResolvedValueOnce(jsonResponse(500, { message: 'server error' }))

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(result).toMatchObject({
        ok: false,
        reason: 'error',
        step: 'message',
        status: 500
      })
    })

    it('classifies on status alone when the error body is not JSON', async () => {
      mockFetch.mockResolvedValueOnce(nonJsonResponse(502))

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(result).toMatchObject({
        ok: false,
        reason: 'error',
        step: 'channel',
        status: 502
      })
    })
  })

  describe('rate limiting', () => {
    it('parses retry_after (fractional seconds) from the JSON body', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(429, {
          retry_after: 1.5,
          message: 'You are being rate limited.'
        })
      )

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(result).toMatchObject({
        ok: false,
        reason: 'rate_limited',
        retryAfterMs: 1500
      })
    })

    it('falls back to the Retry-After header when the body has no retry_after', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(
          429,
          { message: 'You are being rate limited.' },
          {
            'Retry-After': '2'
          }
        )
      )

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(result).toMatchObject({
        ok: false,
        reason: 'rate_limited',
        retryAfterMs: 2000
      })
    })

    it('rate-limits the message step too', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { id: 'dm-channel-1' }))
        .mockResolvedValueOnce(jsonResponse(429, { retry_after: 0.25 }))

      const result = await sendDiscordDirectMessage({
        discordUserId: 'discord-1',
        content: 'hello'
      })

      expect(result).toMatchObject({
        ok: false,
        reason: 'rate_limited',
        step: 'message',
        retryAfterMs: 250
      })
    })
  })

  describe('transport failures', () => {
    it('rethrows when the underlying fetch rejects', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network down'))

      await expect(
        sendDiscordDirectMessage({
          discordUserId: 'discord-1',
          content: 'hello'
        })
      ).rejects.toThrow('network down')
    })

    it('rethrows an abort on the message send', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { id: 'dm-channel-1' }))
        .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))

      await expect(
        sendDiscordDirectMessage({
          discordUserId: 'discord-1',
          content: 'hello'
        })
      ).rejects.toThrow('Aborted')
    })
  })
})
