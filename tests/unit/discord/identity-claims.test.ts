import { describe, expect, it } from 'vitest'
import { extractDiscordIdentityClaims } from '@/app/lib/discord/identity-claims'
import type { User } from '@supabase/supabase-js'

const userWith = (identityData: Record<string, unknown>): User =>
  ({
    id: 'uid',
    identities: [{ provider: 'discord', identity_data: identityData }]
  }) as unknown as User

// Fake snowflake, hoisted so no `discord…: '<digits>'` literal trips gitleaks.
const SNOWFLAKE = '123456789012345678'

describe('extractDiscordIdentityClaims', () => {
  it('resolves the normalized GoTrue shape (provider_id/name/custom_claims)', () => {
    const claims = extractDiscordIdentityClaims(
      userWith({
        iss: 'https://discord.com',
        sub: SNOWFLAKE,
        provider_id: SNOWFLAKE,
        name: 'moderntester#0',
        full_name: 'moderntester',
        avatar_url: 'https://cdn.discordapp.com/avatars/x/y.png',
        custom_claims: { global_name: 'Modern Tester' },
        email: 'x@example.com'
      })
    )
    expect(claims).toEqual({
      discordUserId: SNOWFLAKE,
      discordUsername: 'moderntester',
      discordGlobalName: 'Modern Tester',
      avatarUrl: 'https://cdn.discordapp.com/avatars/x/y.png',
      // Not a real CDN avatar path, so no hash is recoverable or persisted.
      avatarHash: null
    })
  })

  it('keeps a non-zero discriminator in the normalized name', () => {
    const claims = extractDiscordIdentityClaims(
      userWith({ provider_id: SNOWFLAKE, name: 'olduser#1234' })
    )
    expect(claims?.discordUsername).toBe('olduser#1234')
  })

  it('resolves the legacy raw-Discord shape', () => {
    const claims = extractDiscordIdentityClaims(
      userWith({
        id: SNOWFLAKE,
        username: 'tester',
        discriminator: '0',
        global_name: 'Tester'
      })
    )
    expect(claims).toEqual({
      discordUserId: SNOWFLAKE,
      discordUsername: 'tester',
      discordGlobalName: 'Tester',
      avatarUrl: null,
      avatarHash: null
    })
  })

  // Persist only the avatar hash: the CDN URL embeds the snowflake and avatar_url is peer-readable.
  it('recovers the avatar hash from a real CDN avatar URL', () => {
    const claims = extractDiscordIdentityClaims(
      userWith({
        provider_id: SNOWFLAKE,
        name: 'tester#0',
        avatar_url: `https://cdn.discordapp.com/avatars/${SNOWFLAKE}/0123456789abcdef0123456789abcdef.png`
      })
    )
    expect(claims?.avatarHash).toBe('0123456789abcdef0123456789abcdef')
  })

  it('prefers a raw `avatar` claim when an older identity carries one', () => {
    const claims = extractDiscordIdentityClaims(
      userWith({
        id: SNOWFLAKE,
        username: 'tester',
        avatar: 'a_0123456789abcdef0123456789abcdef',
        avatar_url: `https://cdn.discordapp.com/avatars/${SNOWFLAKE}/0123456789abcdef0123456789abcdef.png`
      })
    )
    expect(claims?.avatarHash).toBe('a_0123456789abcdef0123456789abcdef')
  })

  it('recovers no hash from the default embed placeholder, which carries no identifier', () => {
    const claims = extractDiscordIdentityClaims(
      userWith({
        provider_id: SNOWFLAKE,
        name: 'tester#0',
        avatar_url: 'https://cdn.discordapp.com/embed/avatars/3.png'
      })
    )
    expect(claims?.avatarHash).toBeNull()
  })

  it('formats legacy username with a non-zero discriminator', () => {
    const claims = extractDiscordIdentityClaims(
      userWith({
        id: SNOWFLAKE,
        username: 'olduser',
        discriminator: '1234'
      })
    )
    expect(claims?.discordUsername).toBe('olduser#1234')
  })

  it('prefers provider_id over sub over legacy id', () => {
    const claims = extractDiscordIdentityClaims(
      userWith({
        provider_id: '111111111111111111',
        sub: '222222222222222222',
        id: '333333333333333333'
      })
    )
    expect(claims?.discordUserId).toBe('111111111111111111')
  })

  it('rejects malformed snowflakes instead of writing garbage', () => {
    const claims = extractDiscordIdentityClaims(
      userWith({ provider_id: 'not-a-snowflake', sub: '123', name: 'x#0' })
    )
    expect(claims?.discordUserId).toBeNull()
    expect(claims?.discordUsername).toBe('x')
  })

  it('falls back to full_name for the global name', () => {
    const claims = extractDiscordIdentityClaims(
      userWith({ provider_id: SNOWFLAKE, full_name: 'Fully Named' })
    )
    expect(claims?.discordGlobalName).toBe('Fully Named')
  })

  it('returns null when the user has no discord identity', () => {
    const user = {
      id: 'uid',
      identities: [{ provider: 'google', identity_data: { sub: 'g' } }]
    } as unknown as User
    expect(extractDiscordIdentityClaims(user)).toBeNull()
  })
})
