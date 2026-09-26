import { describe, it, expect } from 'vitest'
import {
  getRolePermissions,
  canAccessPage,
  getRoleDisplayName,
  getRoleBadgeColor,
  type RolePermissions
} from '@/app/lib/auth/permissions'

describe('Auth Permissions', () => {
  describe('getRolePermissions', () => {
    it('returns guest permissions for null/undefined role', () => {
      const nullPerms = getRolePermissions(null)
      const undefinedPerms = getRolePermissions(undefined)

      expect(nullPerms.canViewAllGuilds).toBe(false)
      expect(nullPerms.canViewGuildData).toBe(false)
      expect(nullPerms.canEditGuildSettings).toBe(false)
      expect(nullPerms.canManageApiKeys).toBe(false)

      expect(undefinedPerms.canViewAllGuilds).toBe(false)
      expect(undefinedPerms.canAccessOnboarding).toBe(false)
    })

    it('returns onboarding permissions correctly', () => {
      const perms = getRolePermissions('onboarding')

      expect(perms.canAccessOnboarding).toBe(true)
      expect(perms.canViewGuildData).toBe(false)
      expect(perms.canViewBossPages).toBe(false)
      expect(perms.canEditGuildSettings).toBe(false)
      expect(perms.canManageMembers).toBe(false)
    })

    it('returns member permissions correctly', () => {
      const perms = getRolePermissions('member')

      expect(perms.canViewGuildData).toBe(true)
      expect(perms.canViewPlayerPerformance).toBe(true)
      expect(perms.canViewPlayerSearch).toBe(true)
      expect(perms.canViewVOTLW).toBe(true)
      // Tacticus validating the key is the real authorization (recovery when the key-owning leader leaves).
      expect(perms.canManageApiKeys).toBe(true)

      expect(perms.canViewTokenUsage).toBe(false)
      expect(perms.canViewBossPages).toBe(false)
      expect(perms.canEditGuildSettings).toBe(false)
      expect(perms.canManageMembers).toBe(false)
      expect(perms.canViewDebugPage).toBe(false)
    })

    it('returns officer permissions correctly', () => {
      const perms = getRolePermissions('officer')

      expect(perms.canViewGuildData).toBe(true)
      expect(perms.canViewTokenUsage).toBe(true)
      expect(perms.canViewBossPages).toBe(true)
      expect(perms.canEditGuildSettings).toBe(true)
      expect(perms.canManageMembers).toBe(true)
      expect(perms.canViewDebugPage).toBe(true)
      expect(perms.canExportData).toBe(true)
      expect(perms.canManageApiKeys).toBe(true)

      expect(perms.canPromoteToOfficer).toBe(false)
      expect(perms.canPromoteToLeader).toBe(false)
      expect(perms.canViewAllGuilds).toBe(false)
    })

    it('returns leader permissions correctly', () => {
      const perms = getRolePermissions('leader')

      expect(perms.canViewAllGuilds).toBe(true)
      expect(perms.canViewGuildData).toBe(true)
      expect(perms.canViewTokenUsage).toBe(true)
      expect(perms.canViewBossPages).toBe(true)
      expect(perms.canEditGuildSettings).toBe(true)
      expect(perms.canManageMembers).toBe(true)
      expect(perms.canPromoteToOfficer).toBe(true)
      expect(perms.canPromoteToLeader).toBe(true)
      expect(perms.canManageApiKeys).toBe(true)
      expect(perms.canViewDebugPage).toBe(true)
      expect(perms.canExportData).toBe(true)
    })

    it('returns guest permissions for unknown role', () => {
      // @ts-expect-error - testing invalid role
      const perms = getRolePermissions('unknown_role')

      expect(perms.canViewGuildData).toBe(false)
      expect(perms.canViewBossPages).toBe(false)
    })

    // A stored 'Officer' must not fall through to guest permissions.
    it('matches the capitalized enum variants', () => {
      expect(getRolePermissions('Officer')).toEqual(
        getRolePermissions('officer')
      )
      expect(getRolePermissions('Leader')).toEqual(getRolePermissions('leader'))
      expect(getRolePermissions('Member')).toEqual(getRolePermissions('member'))
    })
  })

  describe('canAccessPage', () => {
    describe('token-usage page', () => {
      it('denies access to members', () => {
        expect(canAccessPage('member', '/token-usage')).toBe(false)
      })

      it('allows access to officers', () => {
        expect(canAccessPage('officer', '/token-usage')).toBe(true)
      })

      it('allows access to leaders', () => {
        expect(canAccessPage('leader', '/token-usage')).toBe(true)
      })
    })

    describe('boss pages', () => {
      const bossPages = [
        '/boss',
        '/boss-l1',
        '/boss-l2',
        '/boss-l3',
        '/boss-l4',
        '/boss-l5'
      ]

      it('denies access to members for all boss pages', () => {
        bossPages.forEach((page) => {
          expect(canAccessPage('member', page)).toBe(false)
        })
      })

      it('allows access to officers for all boss pages', () => {
        bossPages.forEach((page) => {
          expect(canAccessPage('officer', page)).toBe(true)
        })
      })

      it('allows access to leaders for all boss pages', () => {
        bossPages.forEach((page) => {
          expect(canAccessPage('leader', page)).toBe(true)
        })
      })
    })

    describe('player pages', () => {
      it('allows members to access player-performance', () => {
        expect(canAccessPage('member', '/player-performance')).toBe(true)
      })

      it('allows members to access player-stats', () => {
        expect(canAccessPage('member', '/player-stats')).toBe(true)
      })

      it('allows members to access votlw', () => {
        expect(canAccessPage('member', '/votlw')).toBe(true)
      })
    })

    describe('management pages', () => {
      it('denies members access to settings', () => {
        expect(canAccessPage('member', '/settings')).toBe(false)
        expect(canAccessPage('member', '/guild-settings')).toBe(false)
      })

      it('allows officers access to settings', () => {
        expect(canAccessPage('officer', '/settings')).toBe(true)
        expect(canAccessPage('officer', '/guild-settings')).toBe(true)
      })

      it('denies members access to member management', () => {
        expect(canAccessPage('member', '/members')).toBe(false)
        expect(canAccessPage('member', '/member-management')).toBe(false)
      })

      it('allows officers access to member management', () => {
        expect(canAccessPage('officer', '/members')).toBe(true)
        expect(canAccessPage('officer', '/member-management')).toBe(true)
      })

      it('allows members access to api-keys (key-validity is the real gate)', () => {
        expect(canAccessPage('member', '/api-keys')).toBe(true)
      })

      it('allows officers access to api-keys', () => {
        expect(canAccessPage('officer', '/api-keys')).toBe(true)
      })

      it('allows leaders access to api-keys', () => {
        expect(canAccessPage('leader', '/api-keys')).toBe(true)
      })
    })

    describe('debug page', () => {
      it('denies members access to debug', () => {
        expect(canAccessPage('member', '/debug')).toBe(false)
      })

      it('allows officers access to debug', () => {
        expect(canAccessPage('officer', '/debug')).toBe(true)
      })
    })

    describe('unlisted pages', () => {
      it('allows access to unlisted pages by default', () => {
        expect(canAccessPage('member', '/some-unknown-page')).toBe(true)
        expect(canAccessPage('officer', '/dashboard')).toBe(true)
        expect(canAccessPage(null, '/public-page')).toBe(true)
      })
    })
  })

  describe('getRoleDisplayName', () => {
    it('returns correct display names for all roles', () => {
      expect(getRoleDisplayName('onboarding')).toBe('Onboarding')
      expect(getRoleDisplayName('member')).toBe('Member')
      expect(getRoleDisplayName('officer')).toBe('Officer')
      expect(getRoleDisplayName('leader')).toBe('Leader')
    })

    it('returns Unknown for invalid roles', () => {
      // @ts-expect-error - testing invalid role
      expect(getRoleDisplayName('invalid')).toBe('Unknown')
    })

    it('resolves the capitalized enum variants', () => {
      expect(getRoleDisplayName('Officer')).toBe('Officer')
      expect(getRoleDisplayName('Leader')).toBe('Leader')
      expect(getRoleDisplayName('Member')).toBe('Member')
    })
  })

  describe('getRoleBadgeColor', () => {
    it('returns correct badge colors for all roles', () => {
      expect(getRoleBadgeColor('onboarding')).toBe('bg-purple-500')
      expect(getRoleBadgeColor('member')).toBe('bg-gray-500')
      expect(getRoleBadgeColor('officer')).toBe('bg-blue-500')
      expect(getRoleBadgeColor('leader')).toBe('bg-amber-500')
    })

    it('returns gray for invalid roles', () => {
      // @ts-expect-error - testing invalid role
      expect(getRoleBadgeColor('invalid')).toBe('bg-gray-400')
    })

    it('resolves the capitalized enum variants', () => {
      expect(getRoleBadgeColor('Officer')).toBe('bg-blue-500')
      expect(getRoleBadgeColor('Leader')).toBe('bg-amber-500')
      expect(getRoleBadgeColor('Member')).toBe('bg-gray-500')
    })
  })

  describe('Permission hierarchy', () => {
    it('ensures leader has all officer permissions', () => {
      const leaderPerms = getRolePermissions('leader')
      const officerPerms = getRolePermissions('officer')

      Object.keys(officerPerms).forEach((key) => {
        const permKey = key as keyof RolePermissions
        if (officerPerms[permKey] === true) {
          expect(leaderPerms[permKey]).toBe(true)
        }
      })
    })

    it('ensures officer has all member permissions', () => {
      const officerPerms = getRolePermissions('officer')
      const memberPerms = getRolePermissions('member')

      Object.keys(memberPerms).forEach((key) => {
        const permKey = key as keyof RolePermissions
        if (memberPerms[permKey] === true) {
          expect(officerPerms[permKey]).toBe(true)
        }
      })
    })
  })
})
