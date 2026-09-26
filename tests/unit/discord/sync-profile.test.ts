import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncDiscordProfile } from '@/app/lib/discord/sync-profile'
import type { SupabaseClient, User } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  serviceDb: vi.fn(),
  authorityRpc: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({
  serviceDb: mocks.serviceDb
}))

type LookupResult = {
  data: Array<{ display_name: string | null }> | null
  error: { message: string } | null
}

const createSelectQuery = <T>(result: T) => ({
  select: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  then: <R1, R2>(
    onFulfilled?: (value: T) => R1,
    onRejected?: (reason: Error) => R2
  ) => Promise.resolve(result).then(onFulfilled, onRejected)
})

const createUpdateQuery = () => {
  const query = {
    update: vi.fn(),
    in: vi.fn(),
    eq: vi.fn(),
    then: <R1, R2>(
      onFulfilled?: (value: { error: null }) => R1,
      onRejected?: (reason: Error) => R2
    ) => Promise.resolve({ error: null }).then(onFulfilled, onRejected)
  }
  query.update.mockReturnValue(query)
  query.in.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

const buildSupabase = (lookupResult: LookupResult) => {
  const lookupQuery = createSelectQuery(lookupResult)
  const updateQuery = createUpdateQuery()
  const from = vi
    .fn()
    .mockReturnValueOnce(lookupQuery)
    .mockReturnValueOnce(updateQuery)
  const auth = { updateUser: vi.fn().mockResolvedValue({ error: null }) }
  return {
    lookupQuery,
    updateQuery,
    supabase: { from, auth } as unknown as SupabaseClient
  }
}

// Legacy raw-Discord identity shape (pre-normalization GoTrue).
const discordUser = {
  id: 'uid',
  identities: [
    {
      provider: 'discord',
      identity_data: {
        id: '123456789012345678',
        username: 'tester',
        global_name: 'Tester',
        avatar_url:
          'https://cdn.discordapp.com/avatars/123456789012345678/0123456789abcdef0123456789abcdef.png'
      }
    }
  ]
} as unknown as User

const normalizedDiscordUser = {
  id: 'uid',
  identities: [
    {
      provider: 'discord',
      identity_data: {
        provider_id: '123456789012345678',
        sub: '123456789012345678',
        name: 'tester#0',
        custom_claims: { global_name: 'Tester' },
        avatar_url:
          'https://cdn.discordapp.com/avatars/123456789012345678/0123456789abcdef0123456789abcdef.png'
      }
    }
  ]
} as unknown as User

describe('syncDiscordProfile display-name clobber guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.serviceDb.mockReturnValue({
      rpc: mocks.authorityRpc
    })
    mocks.authorityRpc.mockResolvedValue({
      data: [
        {
          mapping_id: 42,
          player_id: 'player-42',
          user_id: 'uid',
          guild_code: 'EOT',
          role: 'member',
          is_app_admin: false,
          ownership_attestation_id: 'attestation-42'
        }
      ],
      error: null
    })
  })

  it('omits display_name when any is_current row already has one', async () => {
    const { updateQuery, supabase } = buildSupabase({
      data: [{ display_name: null }, { display_name: 'Existing Name' }],
      error: null
    })

    const result = await syncDiscordProfile(supabase, discordUser)

    expect(result.status).toBe('synced')
    expect(updateQuery.update).toHaveBeenCalledTimes(1)
    const payload = updateQuery.update.mock.calls[0]![0] as Record<
      string,
      string | null
    >
    expect(payload).not.toHaveProperty('display_name')
    expect(payload.discord_username).toBe('tester')
    expect(payload.discord_user_id).toBe('123456789012345678')
    expect(updateQuery.in).toHaveBeenCalledWith('id', [42])
  })

  it('omits display_name when the profile lookup itself errors', async () => {
    const { updateQuery, supabase } = buildSupabase({
      data: null,
      error: { message: 'lookup failed' }
    })

    const result = await syncDiscordProfile(supabase, discordUser)

    expect(result.status).toBe('synced')
    const payload = updateQuery.update.mock.calls[0]![0] as Record<
      string,
      string | null
    >
    expect(payload).not.toHaveProperty('display_name')
  })

  it('syncs id + username from the NORMALIZED GoTrue identity shape', async () => {
    const { updateQuery, supabase } = buildSupabase({
      data: [{ display_name: null }],
      error: null
    })

    const result = await syncDiscordProfile(supabase, normalizedDiscordUser)

    expect(result.status).toBe('synced')
    const payload = updateQuery.update.mock.calls[0]![0] as Record<
      string,
      string | null
    >
    expect(payload.discord_user_id).toBe('123456789012345678')
    expect(payload.discord_username).toBe('tester')
    expect(payload.display_name).toBe('Tester')
  })

  it('backfills display_name when rows exist but none has one', async () => {
    const { updateQuery, supabase } = buildSupabase({
      data: [{ display_name: null }, { display_name: null }],
      error: null
    })

    const result = await syncDiscordProfile(supabase, discordUser)

    expect(result.status).toBe('synced')
    const payload = updateQuery.update.mock.calls[0]![0] as Record<
      string,
      string | null
    >
    expect(payload.display_name).toBe('Tester')
  })

  // The CDN URL embeds the snowflake and avatar_url is peer-readable; persist only the hash.
  it('persists the avatar HASH, never the Discord CDN URL', async () => {
    const { updateQuery, supabase } = buildSupabase({
      data: [{ display_name: 'Existing Name' }],
      error: null
    })

    await syncDiscordProfile(supabase, discordUser)

    const payload = updateQuery.update.mock.calls[0]![0] as Record<
      string,
      string | null
    >
    expect(payload.avatar_url).toBe('0123456789abcdef0123456789abcdef')
    expect(payload.avatar_url).not.toContain('cdn.discordapp.com')
    expect(payload.avatar_url).not.toContain('123456789012345678')
  })

  it('persists the avatar hash from the NORMALIZED GoTrue identity shape too', async () => {
    const { updateQuery, supabase } = buildSupabase({
      data: [{ display_name: 'Existing Name' }],
      error: null
    })

    await syncDiscordProfile(supabase, normalizedDiscordUser)

    const payload = updateQuery.update.mock.calls[0]![0] as Record<
      string,
      string | null
    >
    expect(payload.avatar_url).toBe('0123456789abcdef0123456789abcdef')
  })

  it("writes no avatar for Discord's default embed placeholder, which carries no identifier", async () => {
    const { updateQuery, supabase } = buildSupabase({
      data: [{ display_name: 'Existing Name' }],
      error: null
    })
    const defaultAvatarUser = {
      id: 'uid',
      identities: [
        {
          provider: 'discord',
          identity_data: {
            provider_id: '123456789012345678',
            name: 'tester#0',
            avatar_url: 'https://cdn.discordapp.com/embed/avatars/3.png'
          }
        }
      ]
    } as unknown as User

    await syncDiscordProfile(supabase, defaultAvatarUser)

    const payload = updateQuery.update.mock.calls[0]![0] as Record<
      string,
      string | null | undefined
    >
    expect(payload.avatar_url).toBeUndefined()
  })

  it('lets an unclaimed Discord user continue without binding a roster row', async () => {
    mocks.authorityRpc.mockResolvedValueOnce({ data: [], error: null })
    const { updateQuery, supabase } = buildSupabase({
      data: [{ display_name: null }],
      error: null
    })

    await expect(syncDiscordProfile(supabase, discordUser)).resolves.toEqual({
      status: 'unclaimed'
    })
    expect(updateQuery.update).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.auth.updateUser).not.toHaveBeenCalled()
  })
})
