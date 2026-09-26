import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AcknowledgementsPage from '@/app/(public)/acknowledgements/page'

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  getClusterInfoFromProfile: vi.fn()
}))

vi.mock('@/app/lib/auth', () => ({ getAuthUser: mocks.getAuthUser }))

vi.mock('@/app/lib/utils/cluster', () => ({
  getClusterInfoFromProfile: mocks.getClusterInfoFromProfile
}))

vi.mock('@/app/components/NavigationServer', () => ({
  NavigationServer: () => <div data-testid="navigation-server" />
}))

describe('AcknowledgementsPage current-membership presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not derive cluster presentation from a retained inactive guild', async () => {
    mocks.getAuthUser.mockResolvedValue({
      user: { id: 'inactive-user', membershipStatus: 'inactive' },
      profile: { user_id: 'inactive-user', guild_code: 'FORMER' }
    })

    render(await AcknowledgementsPage())

    expect(mocks.getClusterInfoFromProfile).not.toHaveBeenCalled()
    expect(screen.getAllByText(/Tacticus Analytics/).length).toBeGreaterThan(0)
  })

  it('preserves cluster presentation for an active member', async () => {
    mocks.getAuthUser.mockResolvedValue({
      user: { id: 'active-user', membershipStatus: 'active' },
      profile: { user_id: 'active-user', guild_code: 'ACTIVE' }
    })
    mocks.getClusterInfoFromProfile.mockResolvedValue({
      display_name: 'Active Cluster'
    })

    render(await AcknowledgementsPage())

    expect(mocks.getClusterInfoFromProfile).toHaveBeenCalledWith({
      guild_code: 'ACTIVE'
    })
    expect(screen.getAllByText(/Active Cluster/).length).toBeGreaterThan(0)
  })
})
