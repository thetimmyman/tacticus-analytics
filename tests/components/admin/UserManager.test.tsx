import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { UserManager } from '@/app/(dashboard)/admin/feature-releases/UserManager'

vi.mock(
  '@/app/(dashboard)/admin/feature-releases/UserManagerSearchTab',
  () => ({ UserManagerSearchTab: () => <div>User search content</div> })
)
vi.mock('@/app/(dashboard)/admin/feature-releases/UserManagerRoleTab', () => ({
  UserManagerRoleTab: () => <div>Role content</div>
}))
vi.mock('@/app/(dashboard)/admin/feature-releases/InviteCodeManager', () => ({
  InviteCodeManager: () => <div>Invite manager content</div>
}))
vi.mock('@/app/(dashboard)/admin/feature-releases/UserBanManager', () => ({
  BanUserDialog: () => <div>Ban dialog content</div>,
  BannedUsersTab: () => <div>Ban ledger content</div>
}))

describe('UserManager consolidated tabs', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({})
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('contains both ban management and invite codes in the user area', async () => {
    render(<UserManager />)

    expect(await screen.findByText('User search content')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Banned Users' }))
    expect(screen.getByText('Ban ledger content')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Invite Codes' }))
    expect(screen.getByText('Invite manager content')).toBeInTheDocument()
  })
})
