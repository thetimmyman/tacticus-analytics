/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockGuildConfigService } = vi.hoisted(() => ({
  mockDb: vi.fn(),
  mockGuildConfigService: {
    getBasic: vi.fn()
  }
}))

vi.mock('@/app/lib/db', () => ({
  db: mockDb
}))

vi.mock('@/app/lib/services/guild-config-service', () => ({
  GuildConfigService: mockGuildConfigService
}))

import { validateWebhookManagementAccess } from '@/app/lib/utils/cluster-validation'
import type { PlayerMapping } from '@tacticus/app-core/types'

const profile = (role: string | null): PlayerMapping =>
  ({ role, guild_code: 'GUILDA' }) as unknown as PlayerMapping

// app_role carries both casings and SQL compares lower(pm.role); a case-sensitive
// check would grant cluster-wide access to any role outside the lowercase trio.
describe('validateWebhookManagementAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.mockResolvedValue({})
  })

  it.each(['officer', 'Officer', 'leader', 'Leader'])(
    'grants cluster-wide access to %s',
    async (role) => {
      await expect(
        validateWebhookManagementAccess(profile(role))
      ).resolves.toEqual({
        valid: true,
        accessLevel: 'cluster'
      })
    }
  )

  it.each(['member', 'Member', 'demo', null])(
    'denies %s with no accessLevel',
    async (role) => {
      await expect(
        validateWebhookManagementAccess(profile(role))
      ).resolves.toMatchObject({
        valid: false,
        accessLevel: 'none'
      })
      expect(mockGuildConfigService.getBasic).not.toHaveBeenCalled()
    }
  )

  it('routes an elevated caller to the cluster comparison for a target guild', async () => {
    mockGuildConfigService.getBasic.mockImplementation(
      async (_client: unknown, code: string) =>
        code === 'GUILDA'
          ? { guild_code: 'GUILDA', cluster_code: 'CLUSTERX' }
          : { guild_code: 'GUILDB', cluster_code: 'CLUSTERY' }
    )

    await expect(
      validateWebhookManagementAccess(profile('Officer'), 'GUILDB')
    ).resolves.toMatchObject({
      valid: false,
      accessLevel: 'none',
      error: 'Cannot access guilds from different clusters'
    })
  })

  it('allows an elevated caller onto a SAME-cluster peer guild', async () => {
    mockGuildConfigService.getBasic.mockResolvedValue({
      guild_code: 'GUILDB',
      cluster_code: 'CLUSTERX'
    })

    await expect(
      validateWebhookManagementAccess(profile('Leader'), 'GUILDB')
    ).resolves.toMatchObject({
      valid: true,
      accessLevel: 'cluster'
    })
  })
})
