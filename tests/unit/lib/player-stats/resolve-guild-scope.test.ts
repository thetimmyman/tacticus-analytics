import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveGuildScope } from '@/app/lib/player-stats/resolve-guild-scope'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/app/lib/services/guild-config-service', () => ({
  GuildConfigService: {
    getClusterGuilds: vi.fn()
  }
}))

import { GuildConfigService } from '@/app/lib/services/guild-config-service'

const mockGetClusterGuilds = vi.mocked(GuildConfigService.getClusterGuilds)
const mockSupabase = {} as any // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveGuildScope', () => {
  it('returns [guildCode] when no cluster code', async () => {
    const result = await resolveGuildScope(mockSupabase, 'GUILD1', null)
    expect(result).toEqual(['GUILD1'])
    expect(mockGetClusterGuilds).not.toHaveBeenCalled()
  })

  it('returns all cluster guild codes when cluster has guilds', async () => {
    mockGetClusterGuilds.mockResolvedValue([
      {
        guild_code: 'GUILD1',
        display_name: 'G1',
        enabled: true,
        cluster_code: 'C1',
        cluster_id: 'c1',
        onboarding_completed: true
      },
      {
        guild_code: 'GUILD2',
        display_name: 'G2',
        enabled: true,
        cluster_code: 'C1',
        cluster_id: 'c1',
        onboarding_completed: true
      },
      {
        guild_code: 'GUILD3',
        display_name: 'G3',
        enabled: true,
        cluster_code: 'C1',
        cluster_id: 'c1',
        onboarding_completed: true
      }
    ])

    const result = await resolveGuildScope(mockSupabase, 'GUILD1', 'CLUSTER1')
    expect(result).toEqual(['GUILD1', 'GUILD2', 'GUILD3'])
  })

  it('falls back to [guildCode] when cluster has no enabled guilds', async () => {
    mockGetClusterGuilds.mockResolvedValue([])

    const result = await resolveGuildScope(mockSupabase, 'GUILD1', 'CLUSTER1')
    expect(result).toEqual(['GUILD1'])
  })

  it('falls back to [guildCode] on service error', async () => {
    mockGetClusterGuilds.mockRejectedValue(new Error('DB down'))

    const result = await resolveGuildScope(mockSupabase, 'GUILD1', 'CLUSTER1')
    expect(result).toEqual(['GUILD1'])
  })
})
