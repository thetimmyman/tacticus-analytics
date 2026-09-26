import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import InactiveDashboardLayout from '@/app/(home)/layout'
import type { AppUser } from '@/app/types'
import type { PlayerMapping } from '@tacticus/app-core/types'

const { requireAuthAllowInactive, shellSpy } = vi.hoisted(() => ({
  requireAuthAllowInactive: vi.fn(),
  shellSpy: vi.fn()
}))

vi.mock('@/app/lib/auth', () => ({ requireAuthAllowInactive }))
vi.mock('@/app/components/dashboard/DashboardShell', () => ({
  default: (props: {
    children: React.ReactNode
    user: AppUser
    profile: PlayerMapping | null | undefined
    hideAnalytics: boolean
  }) => {
    shellSpy(props)
    return <div data-testid="shell">{props.children}</div>
  }
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  })
}))

const staleUser = {
  id: 'user-1',
  email: 'inactive@example.com',
  role: 'leader',
  displayName: 'Former Leader',
  guildCode: 'OLD',
  timezone: 'UTC',
  avatarUrl: 'https://example.test/avatar.png',
  membershipStatus: 'inactive',
  profile: {
    user_id: 'user-1',
    guild_code: 'OLD',
    cluster_code: 'OLD-CLUSTER',
    role: 'leader',
    is_app_admin: true,
    is_current: false
  }
}

describe('inactive-capable dashboard layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scrubs stale authorization context before rendering the shell', async () => {
    requireAuthAllowInactive.mockResolvedValue(staleUser)

    const result = await InactiveDashboardLayout({
      children: <div>Inactive home</div>
    })
    render(result)

    expect(screen.getByText('Inactive home')).toBeInTheDocument()
    expect(shellSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: null,
        hideAnalytics: true,
        // 'onboarding' hides the chrome server-side while the client nav resolves 'member', stranding the session.
        user: expect.objectContaining({
          role: 'member',
          guildCode: null,
          avatarUrl: null,
          profile: null
        })
      })
    )
  })

  it('keeps a fresh active profile and resolves active feature access', async () => {
    const activeUser = {
      ...staleUser,
      role: 'member',
      guildCode: 'EOT',
      membershipStatus: 'active',
      profile: {
        ...staleUser.profile,
        guild_code: 'EOT',
        cluster_code: 'EOT',
        role: 'member',
        is_app_admin: false,
        is_current: true
      }
    }
    requireAuthAllowInactive.mockResolvedValue(activeUser)

    const result = await InactiveDashboardLayout({
      children: <div>Active home</div>
    })
    render(result)

    expect(shellSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: activeUser.profile,
        hideAnalytics: false
      })
    )
  })
})
