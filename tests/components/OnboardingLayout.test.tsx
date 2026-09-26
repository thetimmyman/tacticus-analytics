import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingLayout from '@/app/(public)/onboarding/layout'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  navigationServer: vi.fn()
}))

vi.mock('@/app/lib/auth', () => ({
  getCurrentUser: mocks.getCurrentUser
}))

vi.mock('@/app/components/NavigationServer', () => ({
  NavigationServer: (props: Record<string, unknown>) => {
    mocks.navigationServer(props)
    return <div data-testid="navigation-server" />
  }
}))

describe('OnboardingLayout navigation authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards inactive membership authority alongside the retained stale profile', async () => {
    const staleProfile = {
      user_id: 'inactive-user',
      role: 'leader',
      guild_code: 'FORMER',
      is_app_admin: true,
      avatar_url: '/former-avatar.png'
    }
    mocks.getCurrentUser.mockResolvedValue({
      id: 'inactive-user',
      membershipStatus: 'inactive',
      profile: staleProfile
    })

    render(
      await OnboardingLayout({
        children: <div>Join existing guild</div>
      })
    )

    expect(screen.getByTestId('navigation-server')).toBeInTheDocument()
    expect(screen.getByText('Join existing guild')).toBeInTheDocument()
    expect(mocks.navigationServer).toHaveBeenCalledWith(
      expect.objectContaining({
        user: {
          id: 'inactive-user',
          membershipStatus: 'inactive'
        },
        profile: staleProfile,
        hideAnalytics: true
      })
    )
  })

  it('preserves the synthetic onboarding profile for a never-linked account', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'new-user',
      membershipStatus: 'none',
      profile: null
    })

    render(await OnboardingLayout({ children: <div>Get started</div> }))

    expect(mocks.navigationServer).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { id: 'new-user', membershipStatus: 'none' },
        profile: { user_id: 'new-user', role: 'onboarding' },
        hideAnalytics: true
      })
    )
  })
})
