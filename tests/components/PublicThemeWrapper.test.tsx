import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublicThemeWrapper from '@/app/(public)/PublicThemeWrapper'

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  publicThemeClient: vi.fn()
}))

vi.mock('@/app/lib/auth', () => ({
  getAuthUser: mocks.getAuthUser
}))

vi.mock('@/app/(public)/PublicThemeClient', () => ({
  default: (props: {
    children: React.ReactNode
    profile?: Record<string, unknown> | null
  }) => {
    mocks.publicThemeClient(props)
    return <div data-testid="public-theme-client">{props.children}</div>
  }
}))

describe('PublicThemeWrapper membership authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scrubs the retained stale profile for an inactive account', async () => {
    const staleProfile = {
      user_id: 'inactive-user',
      guild_code: 'FORMER',
      role: 'leader',
      theme_preference: 'former-custom-theme'
    }
    mocks.getAuthUser.mockResolvedValue({
      user: {
        id: 'inactive-user',
        membershipStatus: 'inactive'
      },
      profile: staleProfile
    })

    render(
      await PublicThemeWrapper({
        children: <div>Recovery page</div>
      })
    )

    expect(screen.getByText('Recovery page')).toBeInTheDocument()
    expect(mocks.publicThemeClient).toHaveBeenCalledWith(
      expect.objectContaining({ profile: null })
    )
  })

  it('preserves the current profile theme for an active member', async () => {
    const activeProfile = {
      user_id: 'active-user',
      guild_code: 'ACTIVE',
      role: 'member',
      theme_preference: 'active-custom-theme'
    }
    mocks.getAuthUser.mockResolvedValue({
      user: { id: 'active-user', membershipStatus: 'active' },
      profile: activeProfile
    })

    render(await PublicThemeWrapper({ children: <div>Public page</div> }))

    expect(mocks.publicThemeClient).toHaveBeenCalledWith(
      expect.objectContaining({ profile: activeProfile })
    )
  })

  it('preserves anonymous public theming without a profile', async () => {
    mocks.getAuthUser.mockResolvedValue(null)

    render(await PublicThemeWrapper({ children: <div>Visitor page</div> }))

    expect(mocks.publicThemeClient).toHaveBeenCalledWith(
      expect.objectContaining({ profile: null })
    )
  })
})
