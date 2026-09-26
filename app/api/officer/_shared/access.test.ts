import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAuthForApi = vi.fn()
const checkFeatureAccess = vi.fn()

vi.mock('@/app/lib/auth', () => ({
  requireAuthForApi
}))

vi.mock('@/app/lib/services/feature-release-service', () => ({
  checkFeatureAccess
}))

const baseAuth = {
  user: {
    id: 'user-1',
    role: 'officer',
    membershipStatus: 'active'
  },
  profile: {
    guild_code: 'GUILD1',
    role: 'officer',
    is_current: true
  }
}

describe('requireActiveOfficerCommandAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthForApi.mockResolvedValue(baseAuth)
    checkFeatureAccess.mockResolvedValue({ has_access: true })
  })

  it('requires the current player_mapping role, not auth metadata role fallback', async () => {
    requireAuthForApi.mockResolvedValue({
      user: {
        id: 'user-1',
        role: 'officer',
        membershipStatus: 'active'
      },
      profile: {
        guild_code: 'GUILD1',
        role: null,
        is_current: true
      }
    })

    const { requireActiveOfficerCommandAccess } = await import('./access')

    await expect(requireActiveOfficerCommandAccess()).rejects.toMatchObject({
      statusCode: 403
    })
    expect(checkFeatureAccess).not.toHaveBeenCalled()
  })

  it.each([
    ['inactive membership', { membershipStatus: 'inactive' }, {}],
    ['non-current profile', {}, { is_current: false }]
  ])(
    'rejects %s before checking feature access',
    async (_label, user, profile) => {
      requireAuthForApi.mockResolvedValue({
        user: { ...baseAuth.user, ...user },
        profile: { ...baseAuth.profile, ...profile }
      })

      const { requireActiveOfficerCommandAccess } = await import('./access')

      await expect(requireActiveOfficerCommandAccess()).rejects.toMatchObject({
        statusCode: 403
      })
      expect(checkFeatureAccess).not.toHaveBeenCalled()
    }
  )

  it.each(['Officer', 'Leader', 'leader'])(
    'allows an active current profile stored as %s',
    async (role) => {
      requireAuthForApi.mockResolvedValue({
        user: baseAuth.user,
        profile: { ...baseAuth.profile, role }
      })

      const { requireActiveOfficerCommandAccess } = await import('./access')

      await expect(requireActiveOfficerCommandAccess()).resolves.toMatchObject({
        guildCode: 'GUILD1'
      })
    }
  )

  it.each(['member', 'Member'])('rejects a %s profile', async (role) => {
    requireAuthForApi.mockResolvedValue({
      user: baseAuth.user,
      profile: { ...baseAuth.profile, role }
    })

    const { requireActiveOfficerCommandAccess } = await import('./access')

    await expect(requireActiveOfficerCommandAccess()).rejects.toMatchObject({
      statusCode: 403
    })
    expect(checkFeatureAccess).not.toHaveBeenCalled()
  })

  it('allows an active current officer profile with feature access', async () => {
    const { requireActiveOfficerCommandAccess } = await import('./access')

    await expect(requireActiveOfficerCommandAccess()).resolves.toMatchObject({
      guildCode: 'GUILD1'
    })
    expect(checkFeatureAccess).toHaveBeenCalledWith(
      'user-1',
      'officer_command_center'
    )
  })
})
