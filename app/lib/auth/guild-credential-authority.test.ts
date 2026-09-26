import { describe, it, expect } from 'vitest'
import { requireGuildCredentialAuthority } from '@/app/lib/auth/guild-permissions'
import { AppError } from '@/app/lib/errors/AppError'

/**
 * The only guard on another guild's API key now that the write runs as service
 * role; each case mirrors a clause of guild_config_update_by_role (current
 * mapping, same guild_code, role in lowercase leader/officer).
 */

type ProfileShape = {
  role: string | null
  guild_code: string | null
  display_name: string | null
}
type QueryResult = {
  data: ProfileShape | null
  error: { message: string } | null
}
type Client = Parameters<typeof requireGuildCredentialAuthority>[0]

const clientReturning = (result: QueryResult): Client => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result
  }
  return { from: () => chain } as unknown as Client
}

const profile = (
  role: string | null,
  guildCode: string | null
): QueryResult => ({
  data: { role, guild_code: guildCode, display_name: 'Someone' },
  error: null
})

// Distinct values: user and guild are adjacent string params, so equal
// fixtures would hide a transposition.
const GUILD = '00000000-0000-4000-8000-000000000006'
const USER = '00000000-0000-4000-8000-000000000001'

const authorize = (result: QueryResult, guild = GUILD) =>
  requireGuildCredentialAuthority(
    clientReturning(result),
    USER,
    guild,
    'test-endpoint'
  )

describe('requireGuildCredentialAuthority', () => {
  it('admits a current leader of the target guild', async () => {
    await expect(authorize(profile('leader', GUILD))).resolves.toMatchObject({
      role: 'leader'
    })
  })

  it('admits a current officer of the target guild', async () => {
    await expect(authorize(profile('officer', GUILD))).resolves.toMatchObject({
      role: 'officer'
    })
  })

  it('rejects a plain member of the target guild', async () => {
    await expect(authorize(profile('member', GUILD))).rejects.toThrow(AppError)
  })

  it('rejects a leader of a DIFFERENT guild', async () => {
    await expect(
      authorize(profile('leader', 'SOME-OTHER-GUILD'))
    ).rejects.toThrow(AppError)
  })

  it('rejects a caller with no current membership', async () => {
    await expect(authorize({ data: null, error: null })).rejects.toThrow(
      AppError
    )
  })

  it('rejects rather than admits when the profile lookup errors', async () => {
    await expect(
      authorize({ data: null, error: { message: 'boom' } })
    ).rejects.toThrow(AppError)
  })

  // The policy never matched capitalized `Leader`/`Officer`; don't widen it.
  it('rejects capitalized role variants the RLS policy never admitted', async () => {
    await expect(authorize(profile('Leader', GUILD))).rejects.toThrow(AppError)
    await expect(authorize(profile('Officer', GUILD))).rejects.toThrow(AppError)
  })

  it('denies with 403, not 500', async () => {
    await expect(authorize(profile('member', GUILD))).rejects.toMatchObject({
      statusCode: 403
    })
  })
})
