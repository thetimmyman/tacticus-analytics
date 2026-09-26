import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import Navigation from '@/app/components/Navigation'

vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

vi.mock('@/app/components/icons/AnalyticsIcon', () => ({
  AnalyticsIcon: () => <div data-testid="eot-icon" />
}))

vi.mock('@/app/components/SeasonSelector', () => ({
  default: () => <div data-testid="season-selector" />
}))

vi.mock('@/app/components/navigation/MobileNav', () => ({
  MobileNav: (props: { effectiveRole: string; hasProfile: boolean }) => (
    <div
      data-testid="mobile-nav"
      data-role={props.effectiveRole}
      data-has-profile={String(props.hasProfile)}
    />
  )
}))

vi.mock('@/app/components/navigation/PublicNav', () => ({
  PublicNav: () => <div data-testid="public-nav" />
}))

vi.mock('@/app/components/navigation/OnboardingNav', () => ({
  OnboardingNav: () => <div data-testid="onboarding-nav" />
}))

describe('Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders public nav when no user is provided', () => {
    render(<Navigation />)
    expect(screen.getByTestId('public-nav')).toBeInTheDocument()
  })

  it('renders onboarding nav for onboarding role', () => {
    render(
      <Navigation user={{ id: 'user-123' }} profile={{ role: 'onboarding' }} />
    )
    expect(screen.getByTestId('onboarding-nav')).toBeInTheDocument()
  })

  it('renders onboarding nav from the server-resolved role when there is no profile', () => {
    // The server role is authoritative: no profile must not read as 'member'.
    render(<Navigation user={{ id: 'user-123' }} effectiveRole="onboarding" />)
    expect(screen.getByTestId('onboarding-nav')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-nav')).not.toBeInTheDocument()
  })

  it('renders only the mobile nav for authenticated users (desktop chrome is WorkspaceBar)', () => {
    render(
      <Navigation
        user={{ id: 'user-123', email: 'test@example.com' }}
        profile={{
          role: 'member',
          guild_code: 'TESTGUILD',
          display_name: 'TestUser'
        }}
      />
    )

    const mobileNav = screen.getByTestId('mobile-nav')
    expect(mobileNav).toBeInTheDocument()
    expect(mobileNav).toHaveAttribute('data-role', 'member')
    expect(mobileNav).toHaveAttribute('data-has-profile', 'true')
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
    expect(screen.queryByTestId('season-selector')).toBeNull()
  })

  it('keeps the mobile nav for a profile-less inactive session', () => {
    render(
      <Navigation
        user={{ id: 'user-123' }}
        hideAnalytics={true}
        effectiveRole="member"
      />
    )

    const mobileNav = screen.getByTestId('mobile-nav')
    expect(mobileNav).toBeInTheDocument()
    expect(mobileNav).toHaveAttribute('data-has-profile', 'false')
  })

  it('passes hasCluster prop correctly', () => {
    render(
      <Navigation
        user={{ id: 'user-123' }}
        profile={{ role: 'member' }}
        hasCluster={true}
      />
    )

    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument()
  })

  it('handles app admin users', () => {
    render(
      <Navigation
        user={{ id: 'user-123' }}
        profile={{ role: 'member', is_app_admin: true }}
      />
    )

    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument()
  })

  it('renders with userAccessLevels', () => {
    render(
      <Navigation
        user={{ id: 'user-123' }}
        profile={{ role: 'member' }}
        userAccessLevels={{
          max_access_level: 'alpha',
          is_app_admin: false,
          is_admin: false
        }}
      />
    )

    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument()
  })

  it('renders with feature release stages', () => {
    render(
      <Navigation
        user={{ id: 'user-123' }}
        profile={{ role: 'member' }}
        featureReleaseStages={{
          '/meta-atlas': 'beta',
          '/wars': 'alpha'
        }}
      />
    )

    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument()
  })
})
