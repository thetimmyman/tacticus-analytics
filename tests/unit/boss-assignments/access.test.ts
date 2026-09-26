/**
 * Runs in the layout for the whole subtree, so it must add no I/O; canManageHerald has no app-admin
 * bypass because the herald write routes have none.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAuthMock, requireRoleMock, dbMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  requireRoleMock: vi.fn(),
  dbMock: vi.fn()
}))

vi.mock('@/app/lib/auth', () => ({
  requireAuth: requireAuthMock,
  requireRole: requireRoleMock
}))

// Mocked so an added query fails an assertion.
vi.mock('@/app/lib/db', () => ({ db: dbMock, serviceDb: dbMock }))

import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'

const asMember = (profile: Record<string, unknown>) => {
  requireAuthMock.mockResolvedValue({
    profile: { is_app_admin: false, ...profile },
    user: { id: 'user-1' }
  })
  requireRoleMock.mockResolvedValue({
    profile: { is_app_admin: false, ...profile },
    user: { id: 'user-1' }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requireBossAssignmentsAccess', () => {
  describe('canManageHerald', () => {
    it('is true for an officer and a leader of this guild', async () => {
      asMember({ role: 'officer' })
      expect((await requireBossAssignmentsAccess()).canManageHerald).toBe(true)

      asMember({ role: 'Leader' })
      expect((await requireBossAssignmentsAccess()).canManageHerald).toBe(true)
    })

    it('is false for a plain member', async () => {
      asMember({ role: 'member' })
      const access = await requireBossAssignmentsAccess()
      expect(access.canManageHerald).toBe(false)
      expect(access.canEdit).toBe(false)
    })

    it('is FALSE for an app-admin who is not an officer of this guild (D10)', async () => {
      requireAuthMock.mockResolvedValue({
        profile: { is_app_admin: true, role: 'member' },
        user: { id: 'admin-1' }
      })

      const access = await requireBossAssignmentsAccess()

      expect(access.canEdit).toBe(true)
      // Herald/season-config writes are officer-of-this-guild only.
      expect(access.canManageHerald).toBe(false)
    })

    it('is true for an app-admin who IS an officer of this guild', async () => {
      requireAuthMock.mockResolvedValue({
        profile: { is_app_admin: true, role: 'officer' },
        user: { id: 'admin-2' }
      })

      expect((await requireBossAssignmentsAccess()).canManageHerald).toBe(true)
    })

    it("never honours a spoofable 'admin' role string", async () => {
      // app_role has no 'admin', so this literal can only match a spoofed principal.
      asMember({ role: 'admin' })
      const access = await requireBossAssignmentsAccess()
      expect(access.canManageHerald).toBe(false)
      expect(access.canEdit).toBe(false)
    })
  })

  describe('canSeed', () => {
    it('is true only for a platform app-admin', async () => {
      requireAuthMock.mockResolvedValue({
        profile: { is_app_admin: true, role: 'member' },
        user: { id: 'admin-1' }
      })
      expect((await requireBossAssignmentsAccess()).canSeed).toBe(true)
    })

    it('is false for a non-admin officer (the seed endpoint would 403)', async () => {
      asMember({ role: 'officer' })
      const access = await requireBossAssignmentsAccess()
      expect(access.canSeed).toBe(false)
      expect(access.canEdit).toBe(true)
    })

    it('is false for a plain member', async () => {
      asMember({ role: 'member' })
      expect((await requireBossAssignmentsAccess()).canSeed).toBe(false)
    })
  })

  describe('zero-I/O constraint (D14)', () => {
    it('adds no database round-trip beyond the cached auth calls', async () => {
      asMember({ role: 'officer' })

      await requireBossAssignmentsAccess()

      expect(dbMock).not.toHaveBeenCalled()
      expect(requireAuthMock).toHaveBeenCalledTimes(1)
      expect(requireRoleMock).toHaveBeenCalledTimes(1)
      expect(requireRoleMock).toHaveBeenCalledWith('member')
    })

    it('short-circuits requireRole entirely for an app-admin', async () => {
      requireAuthMock.mockResolvedValue({
        profile: { is_app_admin: true, role: 'officer' },
        user: { id: 'admin-1' }
      })

      await requireBossAssignmentsAccess()

      expect(dbMock).not.toHaveBeenCalled()
      expect(requireRoleMock).not.toHaveBeenCalled()
    })
  })
})
