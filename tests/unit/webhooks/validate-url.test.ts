import { describe, it, expect } from 'vitest'
import { validateDiscordWebhookUrl } from '@/app/lib/webhooks/validate-url'

describe('validateDiscordWebhookUrl', () => {
  it('accepts canonical Discord webhook URLs', () => {
    const result = validateDiscordWebhookUrl(
      'https://discord.com/api/webhooks/1234567890123456789/SyntheticTestTokenNotARealWebhook00'
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.url).toBe(
        'https://discord.com/api/webhooks/1234567890123456789/SyntheticTestTokenNotARealWebhook00'
      )
    }
  })

  it('accepts ptb and canary webhook URLs', () => {
    expect(
      validateDiscordWebhookUrl(
        'https://ptb.discord.com/api/webhooks/123/token'
      ).ok
    ).toBe(true)
    expect(
      validateDiscordWebhookUrl(
        'https://canary.discord.com/api/webhooks/123/token'
      ).ok
    ).toBe(true)
  })

  it('accepts legacy discordapp.com webhook URLs', () => {
    expect(
      validateDiscordWebhookUrl('https://discordapp.com/api/webhooks/123/token')
        .ok
    ).toBe(true)
  })

  it('accepts webhook URLs with query strings', () => {
    const result = validateDiscordWebhookUrl(
      'https://discord.com/api/webhooks/123/token?wait=true'
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.url).toBe(
        'https://discord.com/api/webhooks/123/token?wait=true'
      )
    }
  })

  it('trims surrounding whitespace', () => {
    const result = validateDiscordWebhookUrl(
      '  https://discord.com/api/webhooks/123/token  '
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.url).toBe('https://discord.com/api/webhooks/123/token')
    }
  })

  it('rejects Discord channel URLs with kind=channel-url and actionable hint', () => {
    const result = validateDiscordWebhookUrl(
      'https://discord.com/channels/100000000000000001/200000000000000002'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('channel-url')
      expect(result.message).toContain('CHANNEL URL')
      if ('hint' in result) {
        expect(result.hint).toContain('api/webhooks')
        expect(result.hint).toContain('Edit Channel')
      }
    }
  })

  it('rejects ptb/canary channel URLs as channel-url', () => {
    for (const url of [
      'https://ptb.discord.com/channels/111/222',
      'https://canary.discord.com/channels/111/222',
      'https://discordapp.com/channels/111/222'
    ]) {
      const result = validateDiscordWebhookUrl(url)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.kind).toBe('channel-url')
    }
  })

  it('rejects empty / whitespace-only input with kind=empty', () => {
    for (const input of ['', '   ', null, undefined]) {
      const result = validateDiscordWebhookUrl(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.kind).toBe('empty')
    }
  })

  it('rejects unrelated URLs with kind=unrecognized', () => {
    for (const url of [
      'https://example.com/webhook',
      'https://slack.com/api/webhook',
      'javascript:alert(1)',
      'discord.com/api/webhooks/123/token', // missing https:
      'http://discord.com/api/webhooks/123/token', // http not https
      'https://discord.com.evil.test/api/webhooks/123/token',
      'https://discord.com@evil.test/api/webhooks/123/token',
      'https://user:pass@discord.com/api/webhooks/123/token', // trufflehog:ignore -- rejected-URL fixture
      'https://discord.com:444/api/webhooks/123/token'
    ]) {
      const result = validateDiscordWebhookUrl(url)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.kind).toBe('unrecognized')
    }
  })

  it('rejects malformed webhook paths under supported Discord hosts', () => {
    for (const url of [
      'https://discord.com/api/webhooks/abc/token',
      'https://discord.com/api/webhooks/123',
      'https://discord.com/api/webhooks/123/',
      'https://discord.com/api/webhooks/123/token/extra',
      'https://discord.com/webhooks/123/token',
      'https://ptb.discord.com/api/webhooks/abc/token',
      'https://canary.discord.com/api/webhooks/123',
      'https://discordapp.com/api/webhooks/123/token/extra'
    ]) {
      const result = validateDiscordWebhookUrl(url)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.kind).toBe('unrecognized')
    }
  })

  it('rejects versioned webhook paths, which delivery cannot use', () => {
    const result = validateDiscordWebhookUrl(
      'https://discord.com/api/v10/webhooks/123/token'
    )
    expect(result.ok).toBe(false)
  })

  it('rejects suffixes delivery cannot use (trailing slash, fragment, odd token chars)', () => {
    for (const url of [
      'https://discord.com/api/webhooks/123/token/',
      'https://discord.com/api/webhooks/123/token#x',
      'https://discord.com/api/webhooks/123/tok.en'
    ]) {
      const result = validateDiscordWebhookUrl(url)
      expect(result.ok, url).toBe(false)
    }
    expect(
      validateDiscordWebhookUrl(
        'https://discord.com/api/webhooks/123/token?thread_id=9'
      ).ok
    ).toBe(true)
  })

  it('accepts an upper-case scheme/host and stores it lower-cased', () => {
    const result = validateDiscordWebhookUrl(
      'HTTPS://DISCORD.COM/api/webhooks/123/Tok-EN'
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.url).toBe('https://discord.com/api/webhooks/123/Tok-EN')
    }
  })

  it('rejects strings the URL parser would normalize but the DB CHECK stores raw', () => {
    // webhook_config's CHECK would reject these as a 500; the validator gives a 400.
    for (const url of [
      'https://discord.com:443/api/webhooks/123/token',
      'https://discord.com/api/./webhooks/123/token',
      'https://discord.com/api/webhooks/123/tok en',
      'https://discord.com/api/webhooks/123/tok\ten'
    ]) {
      const result = validateDiscordWebhookUrl(url)
      expect(result.ok, url).toBe(false)
      if (!result.ok) expect(result.kind).toBe('unrecognized')
    }
  })

  it('rejects overly long strings with kind=too-long', () => {
    const longUrl = 'https://discord.com/api/webhooks/' + 'a'.repeat(600)
    const result = validateDiscordWebhookUrl(longUrl)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('too-long')
  })

  it('rejects non-string inputs without throwing', () => {
    const result = validateDiscordWebhookUrl(12345 as unknown as string)
    expect(result.ok).toBe(false)
  })
})
