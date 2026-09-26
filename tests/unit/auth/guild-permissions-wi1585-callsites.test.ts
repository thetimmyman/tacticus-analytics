import { describe, it, expect } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import {
  requireGuildOfficerOrClusterLeader,
  type ProfileRow
} from '@/app/lib/auth/guild-permissions'
import { AppError, ErrorCode } from '@/app/lib/errors/AppError'

/** Loosening the helper fails here with a route-attributed name instead of silently widening a write path. */

type GuildConfigRow = { guild_code: string; cluster_code: string | null }

interface StubOptions {
  profile: ProfileRow | null
  guildConfigRows?: GuildConfigRow[]
}

const createStubSupabase = (opts: StubOptions) => {
  const supabase = {
    from(table: string) {
      if (table === 'player_mapping') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.profile, error: null })
              })
            })
          })
        }
      }
      if (table === 'guild_config') {
        return {
          select: () => ({
            in: async () => ({ data: opts.guildConfigRows ?? [], error: null })
          })
        }
      }
      throw new Error(`Unexpected table queried: ${table}`)
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as any
}

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
  throw new Error('Expected a forbidden AppError, but the call resolved')
}

const CALL_SITES = [
  { route: 'POST /api/herald/test-fire', endpoint: '/api/herald/test-fire' },
  {
    route: 'POST /api/herald/preview-message',
    endpoint: '/api/herald/preview-message'
  },
  {
    route: 'POST /api/herald/role-mappings/seed-from-meta-atlas',
    endpoint: '/api/herald/role-mappings/seed-from-meta-atlas'
  }
] as const

describe.each(CALL_SITES)(
  'WI-1585 canonical guild-permission pin — $route',
  ({ endpoint }) => {
    it('ALLOWS an officer of the target guild', async () => {
      const profile: ProfileRow = {
        role: 'officer',
        guild_code: 'GUILDA',
        display_name: 'Olivia'
      }
      const supabase = createStubSupabase({ profile })
      await expect(
        requireGuildOfficerOrClusterLeader(
          supabase,
          'user-o',
          'GUILDA',
          endpoint
        )
      ).resolves.toEqual(profile)
    })

    it('DENIES a plain member of the target guild (members cannot write)', async () => {
      const supabase = createStubSupabase({
        profile: { role: 'member', guild_code: 'GUILDA', display_name: 'Alice' }
      })
      const err = await expectForbidden(() =>
        requireGuildOfficerOrClusterLeader(
          supabase,
          'user-a',
          'GUILDA',
          endpoint
        )
      )
      expect(err.metadata).toMatchObject({ endpoint })
    })

    it('DENIES an officer of A acting on B (officer scope stays single-guild)', async () => {
      const supabase = createStubSupabase({
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
        requireGuildOfficerOrClusterLeader(
          supabase,
          'user-o',
          'GUILDB',
          endpoint
        )
      )
    })

    it('ALLOWS a cluster leader acting on a SAME-cluster peer guild', async () => {
      const profile: ProfileRow = {
        role: 'leader',
        guild_code: 'GUILDA',
        display_name: 'Leo'
      }
      const supabase = createStubSupabase({
        profile,
        guildConfigRows: [
          { guild_code: 'GUILDA', cluster_code: 'CLUSTERX' },
          { guild_code: 'GUILDB', cluster_code: 'CLUSTERX' }
        ]
      })
      await expect(
        requireGuildOfficerOrClusterLeader(
          supabase,
          'user-l',
          'GUILDB',
          endpoint
        )
      ).resolves.toEqual(profile)
    })

    it('DENIES a cluster leader of X acting on a guild in cluster Y', async () => {
      const supabase = createStubSupabase({
        profile: { role: 'leader', guild_code: 'GUILDA', display_name: 'Leo' },
        guildConfigRows: [
          { guild_code: 'GUILDA', cluster_code: 'CLUSTERX' },
          { guild_code: 'GUILDC', cluster_code: 'CLUSTERY' }
        ]
      })
      const err = await expectForbidden(() =>
        requireGuildOfficerOrClusterLeader(
          supabase,
          'user-l',
          'GUILDC',
          endpoint
        )
      )
      expect(err.metadata).toMatchObject({ endpoint, guild_code: 'GUILDC' })
    })
  }
)
