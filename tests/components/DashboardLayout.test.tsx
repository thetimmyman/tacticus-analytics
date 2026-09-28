import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DashboardLayout from '@/app/(dashboard)/layout'

const {
  requireAuthMock,
  dashboardThemeWrapperSpy,
  navigationServerSpy,
  dbMock,
  guildSyncIncidentMock
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  dashboardThemeWrapperSpy: vi.fn(),
  navigationServerSpy: vi.fn(),
  dbMock: vi.fn(),
  guildSyncIncidentMock: vi.fn()
}))

vi.mock('@/app/lib/auth', () => ({
  requireAuth: requireAuthMock
}))

vi.mock('@/app/lib/db', () => ({
  db: dbMock
}))

vi.mock('@/app/lib/data/guild-sync-incident', () => ({
  getOpenGuildSyncIncidentForUser: guildSyncIncidentMock
}))

vi.mock('@/app/(dashboard)/DashboardThemeWrapper', () => ({
  default: ({
    profile,
    children
  }: {
    profile: unknown
    children: React.ReactNode
  }) => {
    dashboardThemeWrapperSpy(profile)
    return <div data-testid="dashboard-theme-wrapper">{children}</div>
  }
}))

vi.mock('@/app/components/NavigationServer', () => ({
  NavigationServer: ({
    user,
    profile
  }: {
    user: { id: string }
    profile: { id?: string }
  }) => {
    navigationServerSpy({ user, profile })
    return <div data-testid="navigation-server">Navigation</div>
  }
}))

vi.mock('@/app/components/Footer', () => ({
  default: () => <div data-testid="footer">Footer</div>
}))

vi.mock('@/app/components/error/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="error-boundary">{children}</div>
  )
}))

vi.mock('@/app/components/ActivityTracker', () => ({
  ActivityTracker: () => <div data-testid="activity-tracker" />
}))

vi.mock('@tacticus/ui-kit/radix-tooltip', () => ({
  RadixTooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-provider">{children}</div>
  )
}))

describe('DashboardLayout', () => {
  beforeEach(() => {
    requireAuthMock.mockReset()
    dashboardThemeWrapperSpy.mockReset()
    navigationServerSpy.mockReset()
    dbMock.mockReset()
    dbMock.mockResolvedValue({})
    guildSyncIncidentMock.mockReset()
    guildSyncIncidentMock.mockResolvedValue(null)
  })

  it('renders the dashboard shell with auth context', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'user-123', email: 'test@example.com' },
      profile: { id: 'profile-1', display_name: 'Tester' }
    })

    const result = await DashboardLayout({
      children: <div data-testid="dashboard-child">Content</div>
    })
    render(result)

    expect(requireAuthMock).toHaveBeenCalledTimes(1)
    expect(dashboardThemeWrapperSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'profile-1' })
    )
    expect(navigationServerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ id: 'user-123' }),
        profile: expect.objectContaining({ id: 'profile-1' })
      })
    )
    expect(screen.getByTestId('dashboard-child')).toBeInTheDocument()
    expect(screen.getByTestId('navigation-server')).toBeInTheDocument()
    expect(screen.getByTestId('footer')).toBeInTheDocument()
  })
  it('renders the guild sync banner when the guild has an open incident', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'user-123', email: 'test@example.com' },
      profile: { id: 'profile-1', display_name: 'Tester', guild_code: 'GUILD1' }
    })
    guildSyncIncidentMock.mockResolvedValue({
      incidentId: 'GUILD1:invalid_key:2030-01-08T12:00:00.000Z',
      reason: 'invalid_key',
      guildCode: 'GUILD1',
      guildDisplayName: 'First Company',
      keyOwnerDisplayName: 'Sergeant Key Holder',
      lastSuccessfulSyncAt: '2030-01-08T12:00:00.000Z',
      viewerIsLeadership: false
    })

    const result = await DashboardLayout({
      children: <div data-testid="dashboard-child">Content</div>
    })
    render(result)

    expect(guildSyncIncidentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ guild_code: 'GUILD1' })
    )
    expect(screen.getByRole('alert')).toHaveTextContent('First Company')
  })

  it('renders no banner when there is no open incident', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'user-123', email: 'test@example.com' },
      profile: { id: 'profile-1', display_name: 'Tester', guild_code: 'GUILD1' }
    })

    const result = await DashboardLayout({
      children: <div data-testid="dashboard-child">Content</div>
    })
    render(result)

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
