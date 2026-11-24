import { describe, it, expect } from 'vitest'
import {
  maskDiscordWebhookUrl,
  isMaskedDiscordWebhookUrl
} from '@/app/lib/webhooks/mask-url'

describe('maskDiscordWebhookUrl', () => {
  it('masks the token segment while preserving host, webhook id, and last 4 chars for long tokens', () => {
    const token = ['synthetic', 'token', 'segment', '1234'].join('-')
    const masked = maskDiscordWebhookUrl(
      `https://discord.com/api/webhooks/1001/${token}`
    )
    expect(masked).toBe('https://discord.com/api/webhooks/1001/••••1234')
    expect(isMaskedDiscordWebhookUrl(masked)).toBe(true)
  })

  it('fully masks short tokens without revealing characters', () => {
    const masked = maskDiscordWebhookUrl(
      'https://discord.com/api/webhooks/123/short'
    )
    expect(masked).toBe('https://discord.com/api/webhooks/123/••••')
    expect(isMaskedDiscordWebhookUrl(masked)).toBe(true)
  })

  it('preserves trailing slash and supports alternate Discord hosts', () => {
    const token = ['synthetic', 'canary', 'token', '9876'].join('-')
    expect(
      maskDiscordWebhookUrl(
        `https://canary.discord.com/api/webhooks/999/${token}/`
      )
    ).toBe('https://canary.discord.com/api/webhooks/999/••••9876/')
  })

  it('returns null for null, undefined, or whitespace-only inputs', () => {
    expect(maskDiscordWebhookUrl(null)).toBeNull()
    expect(maskDiscordWebhookUrl(undefined)).toBeNull()
    expect(maskDiscordWebhookUrl('   ')).toBeNull()
  })

  it('redacts non-webhook strings safely', () => {
    const masked = maskDiscordWebhookUrl('not-a-url')
    expect(masked).toBe('••••')
    expect(isMaskedDiscordWebhookUrl(masked)).toBe(true)
    expect(
      isMaskedDiscordWebhookUrl('https://discord.com/api/webhooks/123/real')
    ).toBe(false)
  })
})
