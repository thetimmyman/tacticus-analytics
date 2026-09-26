import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import HomePage from '@/app/(home)/home/page'

const { requireAuthAllowInactive, inactiveHomeSpy, activeHomeSpy } = vi.hoisted(
  () => ({
    requireAuthAllowInactive: vi.fn(),
    inactiveHomeSpy: vi.fn(),
    activeHomeSpy: vi.fn()
  })
)

vi.mock('@/app/lib/auth', () => ({ requireAuthAllowInactive }))
vi.mock('@/app/(home)/home/InactiveHome', () => ({
  default: (props: Record<string, unknown>) => {
    inactiveHomeSpy(props)
    return <div data-testid="inactive-home">Inactive home</div>
  }
}))
vi.mock('@/app/(home)/home/active-page', () => ({
  default: (props: Record<string, unknown>) => {
    activeHomeSpy(props)
    return <div>Active home</div>
  }
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  })
}))

describe('/home membership boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('short-circuits inactive users onto the minimal InactiveHome surface', async () => {
    requireAuthAllowInactive.mockResolvedValue({
      id: 'user-1',
      email: 'inactive@example.com',
      role: 'leader',
      displayName: 'Former Leader',
      guildCode: 'OLD',
      timezone: 'UTC',
      avatarUrl: null,
      membershipStatus: 'inactive',
      profile: {
        player_id: 'player-1',
        guild_code: 'OLD',
        cluster_code: 'OLD-CLUSTER',
        role: 'leader',
        is_app_admin: true,
        is_current: false
      }
    })

    const result = await HomePage({ searchParams: Promise.resolve({}) })
    render(result)

    expect(screen.getByTestId('inactive-home')).toBeInTheDocument()
    expect(activeHomeSpy).not.toHaveBeenCalled()
    // Only the display name is passed, so no role, guild or id can leak.
    expect(inactiveHomeSpy).toHaveBeenCalledWith({
      displayName: 'Former Leader'
    })
  })

  it('delegates current members to the active home loader', async () => {
    const activeUser = {
      id: 'user-1',
      email: 'active@example.com',
      role: 'member',
      displayName: 'Member',
      guildCode: 'EOT',
      timezone: 'UTC',
      avatarUrl: null,
      membershipStatus: 'active',
      profile: { guild_code: 'EOT', role: 'member', is_current: true }
    }
    const searchParams = Promise.resolve({ season: '82' })
    requireAuthAllowInactive.mockResolvedValue(activeUser)

    const result = await HomePage({ searchParams })
    render(result)

    expect(screen.getByText('Active home')).toBeInTheDocument()
    expect(activeHomeSpy).toHaveBeenCalledWith({
      user: activeUser,
      searchParams
    })
    expect(inactiveHomeSpy).not.toHaveBeenCalled()
  })
})
