import { describe, it, expect, vi } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { requireGuildCredentialMember } from '@/app/lib/auth/guild-permissions'
import { AppError } from '@/app/lib/errors/AppError'

/**
 * Credential UPDATE admits own-guild members of any rank (roster sync lags).
 * It must NOT be `requireGuildMember`, which admits same-cluster peer leaders.
 */

type ProfileShape = {
  role: string | null
  guild_code: string | null
  display_name: string | null
}
type ProfileResult = {
  data: ProfileShape | null
  error: { message: string } | null
}
type Client = Parameters<typeof requireGuildCredentialMember>[0]

// Distinct on purpose: user and guild are adjacent string params, so equal
// fixtures would hide a transposition.
const GUILD = '00000000-0000-4000-8000-000000000006'
const PEER_GUILD = 'PEER-GUILD-SAME-CLUSTER'
const USER = '00000000-0000-4000-8000-000000000001'

// guild_config reports both guilds in one cluster, so any cluster fallback in
// the helper would succeed and the peer-leader test would catch it.
const clientReturning = (result: ProfileResult): Client => {
  const profileChain = {
    select: () => profileChain,
    eq: () => profileChain,
    maybeSingle: async () => result
  }
  const clusterRows = [
    { guild_code: result.data?.guild_code, cluster_code: 'SHARED-CLUSTER' },
    { guild_code: GUILD, cluster_code: 'SHARED-CLUSTER' }
  ]
  const guildChain = {
    select: () => guildChain,
    eq: () => guildChain,
    in: async () => ({ data: clusterRows, error: null }),
    maybeSingle: async () => ({ data: clusterRows[0], error: null })
  }
  return {
    from: (table: string) =>
      table === 'player_mapping' ? profileChain : guildChain
  } as unknown as Client
}

const profile = (
  role: string | null,
  guildCode: string | null
): ProfileResult => ({
  data: { role, guild_code: guildCode, display_name: 'Someone' },
  error: null
})

const authorize = (result: ProfileResult, guild = GUILD) =>
  requireGuildCredentialMember(
    clientReturning(result),
    USER,
    guild,
    'test-endpoint'
  )

describe('requireGuildCredentialMember', () => {
  it('admits a plain member of the target guild', async () => {
    await expect(authorize(profile('member', GUILD))).resolves.toMatchObject({
      role: 'member',
      guild_code: GUILD
    })
  })

  it('admits officers and leaders of the target guild (any rank)', async () => {
    await expect(authorize(profile('officer', GUILD))).resolves.toMatchObject({
      role: 'officer'
    })
    await expect(authorize(profile('leader', GUILD))).resolves.toMatchObject({
      role: 'leader'
    })
  })

  it('admits a member whose role is null', async () => {
    await expect(authorize(profile(null, GUILD))).resolves.toMatchObject({
      guild_code: GUILD
    })
  })

  it('rejects an authenticated non-member with 403', async () => {
    await expect(
      authorize(profile('member', 'SOME-OTHER-GUILD'))
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  // `requireGuildMember` would admit this caller; a credential write must not.
  it('rejects a cluster leader of a PEER guild in the same cluster', async () => {
    await expect(
      authorize(profile('leader', PEER_GUILD))
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  // Otherwise `null === null` would admit a guildless profile.
  it('rejects a null-guild_code mapping, even against a null target', async () => {
    await expect(
      authorize(profile('member', null), null as unknown as string)
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(authorize(profile('member', null))).rejects.toMatchObject({
      statusCode: 403
    })
  })

  it('rejects a caller with no current mapping with 403', async () => {
    await expect(authorize({ data: null, error: null })).rejects.toMatchObject({
      statusCode: 403
    })
  })

  it('rejects rather than admits when the profile lookup errors', async () => {
    await expect(
      authorize({ data: null, error: { message: 'boom' } })
    ).rejects.toThrow(AppError)
  })
})
