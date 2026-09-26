import { beforeEach, describe, expect, it, vi } from 'vitest'
import BossAssignmentsPage from '@/app/(dashboard)/boss-assignments/page'
import BossSeasonPlannerPage from '@/app/(dashboard)/boss-assignments/season-planner/page'
import BossUpcomingAssignmentsPage from '@/app/(dashboard)/boss-assignments/upcoming/page'
import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'
import GuildManagementPage from '@/app/(dashboard)/guild-management/page'

const {
  redirectMock,
  permanentRedirectMock,
  requireRoleMock,
  requireAuthMock
} = vi.hoisted(() => ({
  redirectMock: vi.fn(),
  permanentRedirectMock: vi.fn(),
  requireRoleMock: vi.fn(),
  requireAuthMock: vi.fn()
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  permanentRedirect: permanentRedirectMock
}))

vi.mock('@/app/lib/auth', () => ({
  requireRole: requireRoleMock,
  requireAuth: requireAuthMock
}))

describe('Dashboard redirect pages', () => {
  beforeEach(() => {
    redirectMock.mockReset()
    permanentRedirectMock.mockReset()
    requireRoleMock.mockReset()
    requireAuthMock.mockReset()
    requireRoleMock.mockResolvedValue(undefined)
    requireAuthMock.mockResolvedValue({
      profile: { is_app_admin: false },
      user: { id: 'user-1' }
    })
  })

  it('permanently redirects season planner to season assignments', () => {
    BossSeasonPlannerPage()
    expect(permanentRedirectMock).toHaveBeenCalledWith(
      '/boss-assignments/season'
    )
  })

  it('permanently redirects upcoming assignments to the current landing', () => {
    BossUpcomingAssignmentsPage()
    expect(permanentRedirectMock).toHaveBeenCalledWith(
      '/boss-assignments/current'
    )
  })

  it('lets a plain member through to the current boss assignments (read-only view)', async () => {
    requireRoleMock.mockResolvedValue({
      profile: { is_app_admin: false, role: 'member' },
      user: { id: 'member-1' }
    })
    await BossAssignmentsPage()
    expect(requireRoleMock).toHaveBeenCalledWith('member')
    expect(redirectMock).toHaveBeenCalledWith('/boss-assignments/current')
  })

  it('lets an officer through to the current boss assignments', async () => {
    requireRoleMock.mockResolvedValue({
      profile: { is_app_admin: false, role: 'officer' },
      user: { id: 'officer-1' }
    })
    await BossAssignmentsPage()
    expect(requireRoleMock).toHaveBeenCalledWith('member')
    expect(redirectMock).toHaveBeenCalledWith('/boss-assignments/current')
  })

  it('lets an app-admin bypass the member gate (WI-2730 acceptance)', async () => {
    requireAuthMock.mockResolvedValue({
      profile: { is_app_admin: true },
      user: { id: 'admin-1' }
    })
    await BossAssignmentsPage()
    expect(requireRoleMock).not.toHaveBeenCalled()
    expect(redirectMock).toHaveBeenCalledWith('/boss-assignments/current')
  })

  it('redirects a below-member (onboarding) away from boss assignments', async () => {
    // requireRole's redirect throws, so the trailing redirect never runs.
    const redirectSignal = new Error('NEXT_REDIRECT')
    requireRoleMock.mockImplementation(async () => {
      redirectMock('/unauthorized?required=member&current=onboarding')
      throw redirectSignal
    })
    await expect(BossAssignmentsPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(requireRoleMock).toHaveBeenCalledWith('member')
    expect(redirectMock).toHaveBeenCalledWith(
      '/unauthorized?required=member&current=onboarding'
    )
    expect(redirectMock).not.toHaveBeenCalledWith('/boss-assignments/current')
  })

  // Auth-critical: canEdit gates every mutation control and write path.
  it('computes canEdit=false for a plain member', async () => {
    requireRoleMock.mockResolvedValue({
      profile: { is_app_admin: false, role: 'member' },
      user: { id: 'member-1' }
    })
    const access = await requireBossAssignmentsAccess()
    expect(access.canEdit).toBe(false)
  })

  it('computes canEdit=true for an officer and a leader', async () => {
    requireRoleMock.mockResolvedValue({
      profile: { is_app_admin: false, role: 'officer' },
      user: { id: 'officer-1' }
    })
    expect((await requireBossAssignmentsAccess()).canEdit).toBe(true)

    requireRoleMock.mockResolvedValue({
      profile: { is_app_admin: false, role: 'Leader' },
      user: { id: 'leader-1' }
    })
    expect((await requireBossAssignmentsAccess()).canEdit).toBe(true)
  })

  it('computes canEdit=true for an app-admin without calling requireRole', async () => {
    requireAuthMock.mockResolvedValue({
      profile: { is_app_admin: true, role: 'member' },
      user: { id: 'admin-1' }
    })
    const access = await requireBossAssignmentsAccess()
    expect(access.canEdit).toBe(true)
    expect(requireRoleMock).not.toHaveBeenCalled()
  })

  it('enforces officer role before redirecting guild management', async () => {
    await GuildManagementPage()
    expect(requireRoleMock).toHaveBeenCalledWith('officer')
    expect(redirectMock).toHaveBeenCalledWith('/guild-management/members')
  })
})
