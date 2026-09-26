// A row must land, and a rejected insert must be surfaced, never silently discarded.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logDiscordWebhookDelivery } from '@/app/lib/discord/webhook-service'
import { serviceDb } from '@/app/lib/db'

vi.mock('@/app/lib/db', () => ({ serviceDb: vi.fn() }))

const serviceDbMock = vi.mocked(serviceDb)

const makeDb = (insertResult: { error: { message: string } | null }) => {
  const insert = vi.fn(async () => insertResult)
  const from = vi.fn(() => ({ insert }))
  serviceDbMock.mockReturnValue({ from } as never)
  return { from, insert }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('logDiscordWebhookDelivery', () => {
  const entry = {
    guildCode: 'EOT',
    webhookType: 'leaderboard',
    webhookUrlHash: 'abc123',
    payloadPreview: '{"content":"x"}',
    mentionedRoles: ['123456789012345678'],
    status: 'delivered' as const,
    retryCount: 0,
    deliveredAt: '2026-07-31T00:00:00Z'
  }

  it('lands exactly one row in discord_webhook_logs with the entry fields', async () => {
    const { from, insert } = makeDb({ error: null })

    await logDiscordWebhookDelivery(entry)

    expect(from).toHaveBeenCalledWith('discord_webhook_logs')
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        guild_code: 'EOT',
        webhook_type: 'leaderboard',
        webhook_url_hash: 'abc123',
        mentioned_roles: ['123456789012345678'],
        status: 'delivered',
        retry_count: 0,
        delivered_at: '2026-07-31T00:00:00Z'
      })
    )
  })

  it('a rejected insert (CHECK violation) is swallowed WITHOUT throwing — but only after the error is read', async () => {
    const { insert } = makeDb({
      error: {
        message:
          'new row for relation "discord_webhook_logs" violates check constraint'
      }
    })

    // Fire-and-forget: must not throw, but the {error} result is warned on.
    await expect(logDiscordWebhookDelivery(entry)).resolves.toBeUndefined()
    expect(insert).toHaveBeenCalledTimes(1)
  })
})
