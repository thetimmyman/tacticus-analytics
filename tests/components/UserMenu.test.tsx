import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UserMenu } from '@/app/components/navigation/UserMenu'
import type { UserRole } from '@tacticus/app-core/types'
import { canAccessReleaseStage } from '@/app/lib/utils/release-stage'

const mockUsePathname = vi.fn()
const originalDeploymentEnv = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV

vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname()
}))

vi.mock('@tacticus/ui-kit', () => ({
  Avatar: ({ displayName }: { displayName: string }) => (
    <div data-testid="avatar">{displayName}</div>
  )
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
  RadixDropdownMenuSeparator: () => <hr />
}))

vi.mock('@/app/components/icons/DiscordIcon', () => ({
  DiscordIcon: () => <div data-testid="discord-icon" />
}))

vi.mock('@/app/lib/utils/release-stage', () => ({
  getStageDisplayInfo: vi.fn(() => ({
    label: 'Beta',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10'
  })),
  canAccessReleaseStage: vi.fn(() => true)
}))

describe('UserMenu', () => {
  const baseProps = {
    user: { id: 'user-1', email: 'user@example.com' },
    profile: {
      user_id: 'user-1',
      role: 'member',
      guild_code: 'TESTGUILD',
      display_name: 'Test User',
      is_app_admin: false,
      avatar_url: null
    },
    effectiveRole: 'member' as UserRole,
    guildThemeData: null,
    currentSeason: '81',
    hasCluster: true,
    onLogout: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENV = 'alpha'
    mockUsePathname.mockReturnValue('/home')
    vi.mocked(canAccessReleaseStage).mockReturnValue(true)
  })

  afterAll(() => {
    if (originalDeploymentEnv === undefined) {
      delete process.env.NEXT_PUBLIC_DEPLOYMENT_ENV
    } else {
      process.env.NEXT_PUBLIC_DEPLOYMENT_ENV = originalDeploymentEnv
    }
  })

  it('renders profile details and profile link', () => {
    render(<UserMenu {...baseProps} />)

    expect(screen.getAllByText('Test User').length).toBeGreaterThan(0)
    expect(screen.getByText('TESTGUILD')).toBeInTheDocument()
    expect(screen.getAllByText('Profile').length).toBeGreaterThan(0)
  })

  it('shows temp role label when effective role differs', () => {
    render(<UserMenu {...baseProps} effectiveRole="leader" />)

    expect(screen.getByText('LEADER (temp)')).toBeInTheDocument()
  })

  it('keeps app navigation out of the account-only menu for app admins', () => {
    render(
      <UserMenu
        {...baseProps}
        profile={{ ...baseProps.profile, is_app_admin: true }}
      />
    )

    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
    expect(screen.queryByText('Command')).not.toBeInTheDocument()
  })

  it('hides analysis section when analytics are disabled', () => {
    render(<UserMenu {...baseProps} hideAnalytics={true} />)

    expect(screen.queryByText('Analysis')).not.toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('limits officers to account-scoped links', () => {
    render(<UserMenu {...baseProps} effectiveRole="officer" />)

    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Guild Settings')).toBeInTheDocument()
    expect(screen.getByText('Guild API Key')).toBeInTheDocument()
    expect(screen.queryByText(/Guild Ops/)).not.toBeInTheDocument()
    expect(screen.queryByText('Members')).not.toBeInTheDocument()
    expect(screen.queryByText('Boss Assignments')).not.toBeInTheDocument()
    expect(screen.queryByText('Herald')).not.toBeInTheDocument()
  })

  it('still applies release-stage gates within the Settings workspace', () => {
    vi.mocked(canAccessReleaseStage).mockImplementation(
      (stage) => stage !== 'beta'
    )

    // Not role-gated, so a member render isolates the release-stage gate.
    render(
      <UserMenu
        {...baseProps}
        effectiveRole="member"
        featureReleaseStages={{ '/api-keys': 'beta' }}
      />
    )

    expect(screen.queryByText('Guild API Key')).not.toBeInTheDocument()
    expect(screen.queryByText('Locked')).not.toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
    expect(screen.getAllByText('Profile').length).toBeGreaterThan(0)
  })

  it('renders the guild API key link for every rank', () => {
    // Open to every rank: roster sync can lag a real officer's rank.
    const { rerender } = render(
      <UserMenu {...baseProps} effectiveRole="member" />
    )

    expect(screen.getByText('Guild API Key')).toBeInTheDocument()
    expect(screen.getByText('My API Key')).toBeInTheDocument()

    rerender(<UserMenu {...baseProps} effectiveRole="officer" />)

    expect(screen.getByText('Guild API Key')).toBeInTheDocument()

    rerender(<UserMenu {...baseProps} effectiveRole="leader" />)

    expect(screen.getByText('Guild API Key')).toBeInTheDocument()
  })

  it('keeps the menu account-only when no profile is available', () => {
    render(<UserMenu {...baseProps} hasProfile={false} />)

    expect(screen.queryByText('Raid')).not.toBeInTheDocument()
    expect(screen.queryByText('War')).not.toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
    expect(screen.queryByText('Command')).not.toBeInTheDocument()
    expect(screen.getByText('My API Key')).toBeInTheDocument()
  })

  it('removes active-profile actions from the inactive account menu', () => {
    render(
      <UserMenu
        {...baseProps}
        profile={null}
        hasProfile={false}
        hideAnalytics={true}
      />
    )

    expect(screen.getByTestId('dropdown-content')).toHaveTextContent('INACTIVE')
    expect(screen.queryByText('Profile')).not.toBeInTheDocument()
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
    expect(screen.queryByText('Guild API Key')).not.toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('keeps the menu account-only for onboarding users', () => {
    render(<UserMenu {...baseProps} effectiveRole="onboarding" />)

    expect(screen.queryByText('Raid')).not.toBeInTheDocument()
    expect(screen.queryByText('War')).not.toBeInTheDocument()
    expect(screen.queryByText('Command')).not.toBeInTheDocument()
    expect(screen.queryByText('Guild API Key')).not.toBeInTheDocument()
    expect(screen.getAllByText('Profile').length).toBeGreaterThan(0)
  })

  it('calls onLogout when logout button clicked', () => {
    const onLogout = vi.fn()
    render(<UserMenu {...baseProps} onLogout={onLogout} />)

    fireEvent.click(screen.getByText('Logout'))
    expect(onLogout).toHaveBeenCalled()
  })
})
