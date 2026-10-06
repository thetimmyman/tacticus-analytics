import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NavigationServer } from '@/app/components/NavigationServer'

const mocks = vi.hoisted(() => ({
  getLatestSeason: vi.fn(),
  db: vi.fn(),
  getGuildTheme: vi.fn(),
  getServerClusterContext: vi.fn(),
  getUserAccessLevels: vi.fn(),
  getAllFeatureReleaseStages: vi.fn(),
  alphaChromeBar: vi.fn(),
  navigation: vi.fn()
}))

vi.mock('@/app/lib/utils/season', () => ({
  getLatestSeason: mocks.getLatestSeason
}))

vi.mock('@/app/lib/db', () => ({ db: mocks.db }))

vi.mock('@/app/lib/theme-system', () => ({
  getGuildTheme: mocks.getGuildTheme
}))

vi.mock('@/app/lib/auth/cached-auth', () => ({
  getServerClusterContext: mocks.getServerClusterContext
}))

vi.mock('@/app/lib/services/feature-release-service', () => ({
  getUserAccessLevels: mocks.getUserAccessLevels,
  getAllFeatureReleaseStages: mocks.getAllFeatureReleaseStages
}))

vi.mock('@/app/components/navigation/AlphaChromeBar', () => ({
  AlphaChromeBar: (props: Record<string, unknown>) => {
    mocks.alphaChromeBar(props)
    return <div data-testid="desktop-chrome" />
  }
}))

vi.mock('@/app/components/Navigation', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.navigation(props)
    return <div data-testid="public-mobile-chrome" />
  }
}))

// Downloads is an independent async server entry; these tests exercise membership authority.
vi.mock('@/app/downloads/DownloadsNavigationEntry', () => ({
  default: () => null
}))

describe('NavigationServer membership authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLatestSeason.mockResolvedValue('106')
  })

  it('scrubs a stale leader profile before either public-page chrome surface', async () => {
    const staleProfile = {
      user_id: 'inactive-user',
      role: 'leader',
      guild_code: 'FORMER',
      avatar_unit_id: 'former-avatar',
      avatar_url: '/former-avatar.png',
      is_app_admin: true
    }

    render(
      await NavigationServer({
        user: {
          id: 'inactive-user',
          role: 'leader',
          membershipStatus: 'inactive'
        },
        profile: staleProfile
      })
    )

    expect(screen.getByTestId('desktop-chrome')).toBeInTheDocument()
    expect(screen.getByTestId('public-mobile-chrome')).toBeInTheDocument()

    expect(mocks.alphaChromeBar).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveRole: 'member',
        profile: null,
        guildThemeData: null,
        hasCluster: false,
        hasProfile: false,
        hideAnalytics: true,
        isAppAdmin: false,
        userAccessLevels: null
      })
    )
    expect(mocks.navigation).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveRole: 'member',
        profile: null,
        guildThemeData: null,
        hasCluster: false,
        hideAnalytics: true,
        userAccessLevels: null
      })
    )

    expect(mocks.db).not.toHaveBeenCalled()
    expect(mocks.getServerClusterContext).not.toHaveBeenCalled()
    expect(mocks.getUserAccessLevels).not.toHaveBeenCalled()
    expect(mocks.getAllFeatureReleaseStages).not.toHaveBeenCalled()
    expect(mocks.getGuildTheme).not.toHaveBeenCalled()
  })

  it('preserves active profile authority and profile-derived navigation data', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: { avatar_unit_id: null },
        error: null
      })
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    mocks.db.mockResolvedValue({ from: vi.fn().mockReturnValue(query) })
    mocks.getServerClusterContext.mockResolvedValue({
      clusterCode: 'ACTIVE-CLUSTER'
    })
    mocks.getUserAccessLevels.mockResolvedValue({ playbooks: 'full' })
    mocks.getAllFeatureReleaseStages.mockResolvedValue({})
    mocks.getGuildTheme.mockReturnValue({
      name: 'Active Guild',
      primary: '#111111',
      secondary: '#222222',
      accent: '#333333'
    })

    const activeProfile = {
      user_id: 'active-user',
      role: 'leader',
      guild_code: 'ACTIVE',
      avatar_url: '/active-avatar.png'
    }
    render(
      await NavigationServer({
        user: {
          id: 'active-user',
          role: 'leader',
          membershipStatus: 'active'
        },
        profile: activeProfile
      })
    )

    expect(mocks.alphaChromeBar).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveRole: 'leader',
        profile: activeProfile,
        hasCluster: true,
        hasProfile: true,
        hideAnalytics: false
      })
    )
    expect(mocks.db).toHaveBeenCalledOnce()
    expect(mocks.getGuildTheme).toHaveBeenCalledWith('ACTIVE')
  })

  it('preserves anonymous public navigation without profile lookups', async () => {
    render(await NavigationServer({}))

    expect(screen.queryByTestId('desktop-chrome')).not.toBeInTheDocument()
    expect(screen.getByTestId('public-mobile-chrome')).toBeInTheDocument()
    expect(mocks.navigation).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveRole: 'member',
        profile: undefined,
        hideAnalytics: false,
        hasCluster: false
      })
    )
    expect(mocks.db).not.toHaveBeenCalled()
    expect(mocks.getGuildTheme).not.toHaveBeenCalled()
  })
})
