import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MobileNav } from '@/app/components/navigation/MobileNav'
import { canAccessReleaseStage } from '@/app/lib/utils/release-stage'

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

vi.mock('@/app/components/icons/DiscordIcon', () => ({
  DiscordIcon: () => <div data-testid="discord-icon" />
}))

vi.mock('@tacticus/ui-kit', () => ({
  Avatar: ({ displayName }: { displayName: string }) => (
    <div data-testid="avatar">{displayName}</div>
  )
}))

vi.mock('@/app/components/SeasonSelector', () => ({
  default: () => <div data-testid="season-selector" />
}))

vi.mock('@tacticus/ui-kit/radix-dropdown', () => ({
  RadixDropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RadixDropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-trigger">{children}</div>
  ),
  RadixDropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  RadixDropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RadixDropdownMenuSeparator: () => <hr />
}))

vi.mock('@/app/lib/utils/navigation', () => ({
  getHrefWithSeason: vi.fn((href, season) => `${href}?season=${season}`)
}))

vi.mock('@/app/lib/utils/release-stage', () => ({
  getStageDisplayInfo: vi.fn(() => ({
    label: 'Beta',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10'
  })),
  canAccessReleaseStage: vi.fn(() => true)
}))

const originalDeploymentEnv = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV

describe('MobileNav', () => {
  const defaultProps = {
    user: { id: 'user-123', email: 'test@example.com' },
    profile: {
      user_id: 'user-123',
      role: 'member',
      guild_code: 'TESTGUILD',
      display_name: 'TestUser',
      is_app_admin: false,
      avatar_url: null
    },
    effectiveRole: 'member' as const,
    currentSeason: '81',
    hasCluster: true,
    onLogout: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENV = 'alpha'
    vi.mocked(canAccessReleaseStage).mockReturnValue(true)
  })

  afterAll(() => {
    if (originalDeploymentEnv === undefined) {
      delete process.env.NEXT_PUBLIC_DEPLOYMENT_ENV
    } else {
      process.env.NEXT_PUBLIC_DEPLOYMENT_ENV = originalDeploymentEnv
    }
  })

  it('renders mobile navigation', () => {
    render(<MobileNav {...defaultProps} />)
    expect(screen.getByText('Tacticus Analytics')).toBeInTheDocument()
  })

  it('renders season selector', () => {
    render(<MobileNav {...defaultProps} />)
    expect(screen.getByTestId('season-selector')).toBeInTheDocument()
  })

  it('renders user avatar', () => {
    render(<MobileNav {...defaultProps} />)
    expect(screen.getAllByTestId('avatar').length).toBeGreaterThan(0)
  })

  it('displays user display name', () => {
    render(<MobileNav {...defaultProps} />)
    expect(screen.getAllByText('TestUser').length).toBeGreaterThan(0)
  })

  it('displays guild code', () => {
    render(<MobileNav {...defaultProps} />)
    expect(screen.getByText('TESTGUILD')).toBeInTheDocument()
  })

  it('constrains long account labels without shrinking the menu control', () => {
    const longPlayer = `Player${'X'.repeat(80)}`
    const longGuild = `Guild${'Y'.repeat(80)}`

    render(
      <MobileNav
        {...defaultProps}
        profile={{ ...defaultProps.profile, display_name: longPlayer }}
        guildThemeData={{
          guild_code: 'TESTGUILD',
          display_name: longGuild,
          primary_color: '#ff0000',
          secondary_color: '#00ff00',
          accent_color: '#0000ff',
          theme_name: 'long-label-test'
        }}
      />
    )

    const trigger = screen.getByRole('button', {
      name: 'Open account and navigation menu'
    })
    const playerLabel = screen.getByTestId('mobile-account-player-label')
    const guildLabel = screen.getByTestId('mobile-account-guild-label')

    expect(trigger).toHaveClass('min-w-[44px]', 'max-w-56', 'overflow-hidden')
    expect(playerLabel).toHaveClass('min-w-0', 'truncate')
    expect(guildLabel).toHaveClass('truncate')
    expect(playerLabel).toHaveTextContent(longPlayer)
    expect(guildLabel.textContent).toContain(longGuild)
  })

  it('renders dropdown menu', () => {
    render(<MobileNav {...defaultProps} />)
    expect(screen.getByTestId('dropdown-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('dropdown-content')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /open account and navigation menu/i
      })
    ).toBeInTheDocument()
  })

  it('renders core navigation links', () => {
    render(<MobileNav {...defaultProps} />)
    expect(screen.getByText('Command')).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Explore')).toBeInTheDocument()
    expect(screen.getByText('Roster')).toBeInTheDocument()
  })

  it('renders raid section when not hiding analytics', () => {
    render(
      <MobileNav {...defaultProps} hideAnalytics={false} hasProfile={true} />
    )
    expect(screen.getByText(/^Raid$/)).toBeInTheDocument()
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0)
    expect(screen.getByText('Bosses')).toBeInTheDocument()
    expect(screen.getByText('Your Stats')).toBeInTheDocument()
  })

  it('hides raid section when hideAnalytics is true', () => {
    render(<MobileNav {...defaultProps} hideAnalytics={true} />)
    expect(screen.queryByText(/^Raid$/)).not.toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('renders war section', () => {
    render(
      <MobileNav {...defaultProps} hideAnalytics={false} hasProfile={true} />
    )
    expect(screen.getAllByText(/War/).length).toBeGreaterThan(0)
    expect(screen.getByText('War Reports')).toBeInTheDocument()
    expect(screen.getByText('Guild Metrics')).toBeInTheDocument()
    expect(screen.queryByText('Explorer')).not.toBeInTheDocument()
  })

  it('renders guild management for officer role', () => {
    render(<MobileNav {...defaultProps} effectiveRole="officer" />)
    expect(screen.getByText('Members')).toBeInTheDocument()
    expect(screen.getByText('Performance')).toBeInTheDocument()
    expect(screen.getByText('Tokens')).toBeInTheDocument()
  })

  it('renders guild management for leader role', () => {
    render(<MobileNav {...defaultProps} effectiveRole="leader" />)
    expect(screen.getByText('Members')).toBeInTheDocument()
    expect(screen.getByText('Guild API Key')).toBeInTheDocument()
  })

  it('hides guild management for member role', () => {
    render(<MobileNav {...defaultProps} effectiveRole="member" />)
    expect(screen.queryByText('Members')).not.toBeInTheDocument()
    expect(screen.getByText('Trends')).toBeInTheDocument()
    // Open to every rank because roster sync can lag a real officer's rank.
    expect(screen.getByText('Guild API Key')).toBeInTheDocument()
    expect(screen.getByText('My API Key')).toBeInTheDocument()
  })

  it('renders admin link for app admins', () => {
    render(
      <MobileNav
        {...defaultProps}
        profile={{ ...defaultProps.profile, is_app_admin: true }}
      />
    )
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('hides admin link for non-admins', () => {
    render(
      <MobileNav
        {...defaultProps}
        profile={{ ...defaultProps.profile, is_app_admin: false }}
      />
    )
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('renders community section', () => {
    render(<MobileNav {...defaultProps} />)
    expect(screen.getByText(/Community/)).toBeInTheDocument()
    expect(screen.getByText('Discord')).toBeInTheDocument()
    expect(screen.getByText('Thanks')).toBeInTheDocument()
    expect(screen.getByText('Creators')).toBeInTheDocument()
    expect(screen.getByText('Support')).toBeInTheDocument()
  })

  it('renders logout button', () => {
    render(<MobileNav {...defaultProps} />)
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('calls onLogout when logout button clicked', () => {
    const onLogout = vi.fn()
    render(<MobileNav {...defaultProps} onLogout={onLogout} />)

    const logoutButton = screen.getByText('Logout')
    fireEvent.click(logoutButton)

    expect(onLogout).toHaveBeenCalled()
  })

  it('displays guild theme logo when provided', () => {
    const guildThemeData = {
      guild_code: 'TESTGUILD',
      display_name: 'Test Guild',
      primary_color: '#ff0000',
      secondary_color: '#00ff00',
      accent_color: '#0000ff',
      logo_url: 'https://example.com/logo.png',
      theme_name: 'test-theme'
    }

    render(<MobileNav {...defaultProps} guildThemeData={guildThemeData} />)
    const logo = screen.getByAltText('Test Guild')
    expect(logo).toHaveAttribute('src', 'https://example.com/logo.png')
  })

  it('displays default icon when no guild theme logo', () => {
    render(<MobileNav {...defaultProps} guildThemeData={null} />)
    expect(screen.getByTestId('eot-icon')).toBeInTheDocument()
  })

  it('renders premium features section when accessible (no stage badge)', () => {
    // An empty stage map would prove nothing.
    vi.mocked(canAccessReleaseStage).mockImplementation(
      (stage) => !stage || stage === 'public' || stage === 'beta'
    )

    render(
      <MobileNav
        {...defaultProps}
        userAccessLevels={{
          max_access_level: 'beta',
          is_app_admin: false,
          is_admin: false
        }}
        featureReleaseStages={{ '/meta-atlas': 'beta' }}
      />
    )
    expect(screen.getByText('Meta Atlas')).toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  it('hides stage-gated sections entirely when access is denied', () => {
    vi.mocked(canAccessReleaseStage).mockImplementation(
      (stage) => stage !== 'beta'
    )

    render(
      <MobileNav
        {...defaultProps}
        featureReleaseStages={{ '/meta-atlas': 'beta' }}
      />
    )

    expect(screen.queryByText('Meta Atlas')).not.toBeInTheDocument()
    expect(screen.queryByText('Locked')).not.toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
    expect(screen.getByText('Command')).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('hides raid and war workspaces when no profile is available', () => {
    render(<MobileNav {...defaultProps} hasProfile={false} />)

    expect(screen.queryByText(/^Raid$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/War/)).not.toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
    expect(screen.getByText('Command')).toBeInTheDocument()
  })

  it('renders only the recovery-safe allowlist for an inactive session', () => {
    render(
      <MobileNav
        {...defaultProps}
        profile={null}
        hasProfile={false}
        hideAnalytics={true}
      />
    )

    expect(screen.getByTestId('dropdown-content')).toHaveTextContent('INACTIVE')
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Explore')).toBeInTheDocument()
    expect(screen.getByText('Community')).toBeInTheDocument()
    expect(screen.getByText('Creators')).toBeInTheDocument()
    expect(screen.queryByText('Roster')).not.toBeInTheDocument()
    expect(screen.queryByText('Achievements')).not.toBeInTheDocument()
    expect(screen.queryByText('Guild Ops')).not.toBeInTheDocument()
    expect(screen.queryByText('Boss Assignments')).not.toBeInTheDocument()
    expect(screen.queryByText('Tools')).not.toBeInTheDocument()
    expect(screen.queryByText('Herald')).not.toBeInTheDocument()
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
    expect(screen.queryByText('Guild API Key')).not.toBeInTheDocument()
    expect(screen.queryByText('Profile')).not.toBeInTheDocument()
    expect(screen.queryByTestId('season-selector')).not.toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('hides raid and war workspaces for onboarding users', () => {
    render(<MobileNav {...defaultProps} effectiveRole="onboarding" />)

    expect(screen.queryByText(/^Raid$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/War/)).not.toBeInTheDocument()
    expect(screen.getByText('Command')).toBeInTheDocument()
  })

  it('handles null profile gracefully', () => {
    render(<MobileNav {...defaultProps} profile={null} />)
    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.getByText('NO GUILD')).toBeInTheDocument()
  })

  it('displays profile link in header', () => {
    render(<MobileNav {...defaultProps} />)
    const profileLinks = screen.getAllByRole('link', { name: /Profile/ })
    expect(
      profileLinks.some(
        (link) => link.getAttribute('href') === '/profile?season=81'
      )
    ).toBe(true)
  })
})
