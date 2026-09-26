import { describe, it, expect } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import {
  requireGuildMember,
  requireGuildOfficerOrClusterLeader,
  type ProfileRow
} from '@/app/lib/auth/guild-permissions'
import { AppError, ErrorCode } from '@/app/lib/errors/AppError'

/** Route suites mock the guild guards, so the real functions run here against a stub. */

type GuildConfigRow = { guild_code: string; cluster_code: string | null }

interface StubOptions {
  profile: ProfileRow | null
  profileError?: { message: string } | null
  guildConfigRows?: GuildConfigRow[]
  guildConfigError?: { message: string } | null
}

const createStubSupabase = (opts: StubOptions) => {
  const calls = { playerMapping: 0, guildConfig: 0 }

  const supabase = {
    from(table: string) {
      if (table === 'player_mapping') {
        calls.playerMapping += 1
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle: async () => ({
                        data: opts.profile,
                        error: opts.profileError ?? null
                      })
                    }
                  }
                }
              }
            }
          }
        }
      }

      if (table === 'guild_config') {
        calls.guildConfig += 1
        return {
          select() {
            return {
              in: async () => ({
                data: opts.guildConfigRows ?? [],
                error: null
              }),
              eq(_column: string, value: string) {
                return {
                  maybeSingle: async () => ({
                    data:
                      (opts.guildConfigRows ?? []).find(
                        (row) => row.guild_code === value
                      ) ?? null,
                    error: opts.guildConfigError ?? null
                  })
                }
              }
            }
          }
        }
      }

      throw new Error(`Unexpected table queried: ${table}`)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, calls }
}

const ENDPOINT = '/api/test/guild-resource'

// The production 403 AppError, not a generic throw or 500.
const expectForbidden = async (
  run: () => Promise<unknown>
): Promise<AppError> => {
  try {
    await run()
  } catch (err) {
    expect(err).toBeInstanceOf(AppError)
    const appErr = err as AppError
    expect(appErr.code).toBe(ErrorCode.FORBIDDEN)
    expect(appErr.statusCode).toBe(403)
    return appErr
  }
  throw new Error(
    'Expected the call to throw a forbidden AppError, but it resolved'
  )
}

describe('requireGuildMember (cross-tenant read boundary)', () => {
  it('ALLOWS a member reading their own guild', async () => {
    const { supabase, calls } = createStubSupabase({
      profile: { role: 'member', guild_code: 'GUILDA', display_name: 'Alice' }
    })

    await expect(
      requireGuildMember(supabase, 'user-a', 'GUILDA', ENDPOINT)
    ).resolves.toBeUndefined()

    expect(calls.guildConfig).toBe(0)
  })

  it('DENIES a member of guild A reading guild B (no cluster escalation)', async () => {
    const { supabase } = createStubSupabase({
      profile: { role: 'member', guild_code: 'GUILDA', display_name: 'Alice' }
    })

    const err = await expectForbidden(() =>
      requireGuildMember(supabase, 'user-a', 'GUILDB', ENDPOINT)
    )
    expect(err.metadata).toMatchObject({ guild_code: 'GUILDB' })
  })

  it('DENIES an officer of A reading B — officer is not a cross-guild reader', async () => {
    const { supabase, calls } = createStubSupabase({
      profile: {
        role: 'officer',
        guild_code: 'GUILDA',
        display_name: 'Olivia'
      },
      guildConfigRows: [
        { guild_code: 'GUILDA', cluster_code: 'CLUSTERX' },
        { guild_code: 'GUILDB', cluster_code: 'CLUSTERX' }
      ]
    })

    await expectForbidden(() =>
      requireGuildMember(supabase, 'user-o', 'GUILDB', ENDPOINT)
    )
    // Same cluster, but the cluster branch is gated on role==='leader'.
    expect(calls.guildConfig).toBe(0)
  })

  it('DENIES a cluster leader of X reading a guild in cluster Y', async () => {
    const { supabase, calls } = createStubSupabase({
      profile: { role: 'leader', guild_code: 'GUILDA', display_name: 'Leo' },
      guildConfigRows: [
        { guild_code: 'GUILDA', cluster_code: 'CLUSTERX' },
        { guild_code: 'GUILDC', cluster_code: 'CLUSTERY' }
      ]
    })

    await expectForbidden(() =>
      requireGuildMember(supabase, 'user-l', 'GUILDC', ENDPOINT)
    )
    expect(calls.guildConfig).toBe(1)
  })

  it('ALLOWS a cluster leader reading a SAME-cluster peer guild', async () => {
    const { supabase, calls } = createStubSupabase({
      profile: { role: 'leader', guild_code: 'GUILDA', display_name: 'Leo' },
      guildConfigRows: [
        { guild_code: 'GUILDA', cluster_code: 'CLUSTERX' },
        { guild_code: 'GUILDB', cluster_code: 'CLUSTERX' }
      ]
    })

    await expect(
      requireGuildMember(supabase, 'user-l', 'GUILDB', ENDPOINT)
    ).resolves.toBeUndefined()
    expect(calls.guildConfig).toBe(1)
  })

  it('FORBIDS when the actor has no current profile (null)', async () => {
    const { supabase } = createStubSupabase({ profile: null })

    const err = await expectForbidden(() =>
      requireGuildMember(supabase, 'ghost', 'GUILDA', ENDPOINT)
    )
    expect(err.message).toMatch(/No current guild membership/i)
  })

  // `app_role` carries both casings and SQL compares lower(role).
  it('ALLOWS a cluster leader stored as `Leader` onto a SAME-cluster peer', async () => {
    const { supabase, calls } = createStubSupabase({
      profile: { role: 'Leader', guild_code: 'GUILDA', display_name: 'Leo' },
      guildConfigRows: [
        { guild_code: 'GUILDA', cluster_code: 'CLUSTERX' },
        { guild_code: 'GUILDB', cluster_code: 'CLUSTERX' }
      ]
    })

    await expect(
      requireGuildMember(supabase, 'user-l', 'GUILDB', ENDPOINT)
    ).resolves.toBeUndefined()
    expect(calls.guildConfig).toBe(1)
  })

  it('DENIES an `Officer` of A reading B — case does not widen officer scope', async () => {
    const { supabase, calls } = createStubSupabase({
      profile: {
        role: 'Officer',
        guild_code: 'GUILDA',
        display_name: 'Olivia'
      },
      guildConfigRows: [
        { guild_code: 'GUILDA', cluster_code: 'CLUSTERX' },
        { guild_code: 'GUILDB', cluster_code: 'CLUSTERX' }
      ]
    })

    await expectForbidden(() =>
      requireGuildMember(supabase, 'user-o', 'GUILDB', ENDPOINT)
    )
    expect(calls.guildConfig).toBe(0)
  })

  it('DENIES a leader whose own guild has a null cluster_code (no cluster => no peer access)', async () => {
    const { supabase } = createStubSupabase({
      profile: { role: 'leader', guild_code: 'GUILDA', display_name: 'Leo' },
      guildConfigRows: [
        { guild_code: 'GUILDA', cluster_code: null },
        { guild_code: 'GUILDB', cluster_code: null }
      ]
    })

    await expectForbidden(() =>
      requireGuildMember(supabase, 'user-l', 'GUILDB', ENDPOINT)
    )
  })

  it('surfaces a DB failure as a thrown AppError, never as a silent allow', async () => {
    const { supabase } = createStubSupabase({
      profile: null,
      profileError: { message: 'connection reset' }
    })

    await expect(
      requireGuildMember(supabase, 'user-a', 'GUILDA', ENDPOINT)
    ).rejects.toBeInstanceOf(AppError)
  })
})

describe('requireGuildOfficerOrClusterLeader (cross-tenant write boundary)', () => {
  it('ALLOWS an officer of their own guild and returns the profile row', async () => {
    const profile: ProfileRow = {
      role: 'officer',
      guild_code: 'GUILDA',
      display_name: 'Olivia'
    }
    const { supabase, calls } = createStubSupabase({ profile })

    const result = await requireGuildOfficerOrClusterLeader(
      supabase,
      'user-o',
      'GUILDA',
      ENDPOINT
    )
    expect(result).toEqual(profile)
    expect(calls.guildConfig).toBe(0)
  })

  it('ALLOWS a leader of their own guild', async () => {
    const profile: ProfileRow = {
      role: 'leader',
      guild_code: 'GUILDA',
      display_name: 'Leo'
    }
    const { supabase } = createStubSupabase({ profile })

    const result = await requireGuildOfficerOrClusterLeader(
      supabase,
      'user-l',
      'GUILDA',
      ENDPOINT
    )
    expect(result.role).toBe('leader')
  })

  it('ALLOWS an `Officer` of their own guild (mixed-case enum variant)', async () => {
    const profile: ProfileRow = {
      role: 'Officer',
      guild_code: 'GUILDA',
      display_name: 'Olivia'
    }
    const { supabase, calls } = createStubSupabase({ profile })

    const result = await requireGuildOfficerOrClusterLeader(
      supabase,
      'user-o',
      'GUILDA',
      ENDPOINT
    )
    expect(result).toEqual(profile)
    expect(calls.guildConfig).toBe(0)
  })

  it('ALLOWS a `Leader` writing to a SAME-cluster peer guild', async () => {
    const profile: ProfileRow = {
      role: 'Leader',
      guild_code: 'GUILDA',
      display_name: 'Leo'
    }
    const { supabase, calls } = createStubSupabase({
      profile,
      guildConfigRows: [
        { guild_code: 'GUILDA', cluster_code: 'CLUSTERX' },
        { guild_code: 'GUILDB', cluster_code: 'CLUSTERX' }
      ]
    })

    const result = await requireGuildOfficerOrClusterLeader(
      supabase,
      'user-l',
      'GUILDB',
      ENDPOINT
    )
    expect(result).toEqual(profile)
    expect(calls.guildConfig).toBe(1)
  })

  it('DENIES a `Member` of A writing to A — case does not grant write', async () => {
    const { supabase } = createStubSupabase({
      profile: { role: 'Member', guild_code: 'GUILDA', display_name: 'Alice' }
    })

    await expectForbidden(() =>
      requireGuildOfficerOrClusterLeader(supabase, 'user-a', 'GUILDA', ENDPOINT)
    )
  })

  it('DENIES a member of A writing to A — members cannot write', async () => {
    const { supabase } = createStubSupabase({
      profile: { role: 'member', guild_code: 'GUILDA', display_name: 'Alice' }
    })

    await expectForbidden(() =>
      requireGuildOfficerOrClusterLeader(supabase, 'user-a', 'GUILDA', ENDPOINT)
    )
  })

  it('DENIES an officer of A writing to B (officer scope is single-guild)', async () => {
    const { supabase, calls } = createStubSupabase({
      profile: {
        role: 'officer',
        guild_code: 'GUILDA',
        display_name: 'Olivia'
      },
      guildConfigRows: [
        { guild_code: 'GUILDA', cluster_code: 'CLUSTERX' },
        { guild_code: 'GUILDB', cluster_code: 'CLUSTERX' }
      ]
    })

    await expectForbidden(() =>
      requireGuildOfficerOrClusterLeader(supabase, 'user-o', 'GUILDB', ENDPOINT)
    )
    expect(calls.guildConfig).toBe(0)
  })

  it('DENIES a cluster leader of X writing to a guild in cluster Y', async () => {
    const { supabase, calls } = createStubSupabase({
      profile: { role: 'leader', guild_code: 'GUILDA', display_name: 'Leo' },
      guildConfigRows: [
        { guild_code: 'GUILDA', cluster_code: 'CLUSTERX' },
        { guild_code: 'GUILDC', cluster_code: 'CLUSTERY' }
      ]
    })

    const err = await expectForbidden(() =>
      requireGuildOfficerOrClusterLeader(supabase, 'user-l', 'GUILDC', ENDPOINT)
    )
    expect(err.metadata).toMatchObject({ guild_code: 'GUILDC' })
    expect(calls.guildConfig).toBe(1)
  })

  it('ALLOWS a cluster leader writing to a SAME-cluster peer guild', async () => {
    const profile: ProfileRow = {
      role: 'leader',
      guild_code: 'GUILDA',
      display_name: 'Leo'
    }
    const { supabase, calls } = createStubSupabase({
      profile,
      guildConfigRows: [
        { guild_code: 'GUILDA', cluster_code: 'CLUSTERX' },
        { guild_code: 'GUILDB', cluster_code: 'CLUSTERX' }
      ]
    })

    const result = await requireGuildOfficerOrClusterLeader(
      supabase,
      'user-l',
      'GUILDB',
      ENDPOINT
    )
    expect(result).toEqual(profile)
    expect(calls.guildConfig).toBe(1)
  })

  it('FORBIDS when the actor has no current profile (null)', async () => {
    const { supabase } = createStubSupabase({ profile: null })

    const err = await expectForbidden(() =>
      requireGuildOfficerOrClusterLeader(supabase, 'ghost', 'GUILDA', ENDPOINT)
    )
    expect(err.message).toMatch(/No current guild membership/i)
  })

  it('DENIES a leader with no own guild_code (null) even if target cluster resolves', async () => {
    // The cluster branch is gated on a truthy profile.guild_code.
    const { supabase, calls } = createStubSupabase({
      profile: { role: 'leader', guild_code: null, display_name: 'Orphan' },
      guildConfigRows: [{ guild_code: 'GUILDB', cluster_code: 'CLUSTERX' }]
    })

    await expectForbidden(() =>
      requireGuildOfficerOrClusterLeader(supabase, 'user-l', 'GUILDB', ENDPOINT)
    )
    expect(calls.guildConfig).toBe(0)
  })
})
