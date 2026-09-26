import { describe, expect, it } from 'vitest'
import {
  buildDiscordAvatarUrl,
  toDiscordAvatarHash
} from '@/app/lib/discord/avatar'

// Hoisted so no `discord…: '<digits>'` literal trips the gitleaks discord-client-id rule.
const SNOWFLAKE = '123456789012345678'
const HASH = '0123456789abcdef0123456789abcdef'
const CDN_URL = `https://cdn.discordapp.com/avatars/${SNOWFLAKE}/${HASH}.png`

describe('toDiscordAvatarHash', () => {
  it('parses the hash out of a CDN avatar URL, leaving the snowflake behind', () => {
    const hash = toDiscordAvatarHash(CDN_URL)
    expect(hash).toBe(HASH)
    expect(hash).not.toContain(SNOWFLAKE)
  })

  it('parses an animated avatar, keeping the a_ prefix', () => {
    expect(
      toDiscordAvatarHash(
        `https://cdn.discordapp.com/avatars/${SNOWFLAKE}/a_${HASH}.gif`
      )
    ).toBe(`a_${HASH}`)
  })

  it('accepts a value that is already a hash', () => {
    expect(toDiscordAvatarHash(HASH)).toBe(HASH)
  })

  it('returns null for the default embed placeholder, which carries no identifier', () => {
    expect(
      toDiscordAvatarHash('https://cdn.discordapp.com/embed/avatars/3.png')
    ).toBeNull()
  })

  it('returns null for an empty or unrecognised value', () => {
    expect(toDiscordAvatarHash(null)).toBeNull()
    expect(toDiscordAvatarHash(undefined)).toBeNull()
    expect(toDiscordAvatarHash('')).toBeNull()
    expect(toDiscordAvatarHash('https://example.invalid/pic.png')).toBeNull()
  })
})

describe('buildDiscordAvatarUrl', () => {
  it('rebuilds the CDN URL for a caller that holds the snowflake', () => {
    expect(buildDiscordAvatarUrl(SNOWFLAKE, HASH)).toBe(CDN_URL)
  })

  it('rebuilds an animated avatar as .gif', () => {
    expect(buildDiscordAvatarUrl(SNOWFLAKE, `a_${HASH}`)).toBe(
      `https://cdn.discordapp.com/avatars/${SNOWFLAKE}/a_${HASH}.gif`
    )
  })

  // Without the snowflake there is no URL; guessing one would re-create the leak.
  it('returns null for a hash when the caller has no snowflake', () => {
    expect(buildDiscordAvatarUrl(null, HASH)).toBeNull()
    expect(buildDiscordAvatarUrl(undefined, HASH)).toBeNull()
  })

  it('passes a stored URL through unchanged', () => {
    expect(buildDiscordAvatarUrl(null, CDN_URL)).toBe(CDN_URL)
    expect(
      buildDiscordAvatarUrl(
        SNOWFLAKE,
        'https://cdn.discordapp.com/embed/avatars/3.png'
      )
    ).toBe('https://cdn.discordapp.com/embed/avatars/3.png')
  })

  it('returns null when nothing is stored', () => {
    expect(buildDiscordAvatarUrl(SNOWFLAKE, null)).toBeNull()
    expect(buildDiscordAvatarUrl(SNOWFLAKE, '')).toBeNull()
  })
})
