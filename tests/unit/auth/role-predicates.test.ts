import { describe, expect, it } from 'vitest'
import {
  canManageHeraldRole,
  isOfficerLeaderOrAdminRole
} from '@/app/lib/auth/role-predicates'

describe('role predicates', () => {
  describe('isOfficerLeaderOrAdminRole', () => {
    it('allows officer, leader, and admin roles', () => {
      expect(isOfficerLeaderOrAdminRole('officer')).toBe(true)
      expect(isOfficerLeaderOrAdminRole('leader')).toBe(true)
      expect(isOfficerLeaderOrAdminRole('admin')).toBe(true)
    })

    it('handles case variants', () => {
      expect(isOfficerLeaderOrAdminRole('Officer')).toBe(true)
      expect(isOfficerLeaderOrAdminRole('LEADER')).toBe(true)
      expect(isOfficerLeaderOrAdminRole('Admin')).toBe(true)
    })

    it('denies member and unknown roles', () => {
      expect(isOfficerLeaderOrAdminRole('member')).toBe(false)
      expect(isOfficerLeaderOrAdminRole('moderator')).toBe(false)
      expect(isOfficerLeaderOrAdminRole('')).toBe(false)
    })

    it('denies missing roles', () => {
      expect(isOfficerLeaderOrAdminRole(null)).toBe(false)
      expect(isOfficerLeaderOrAdminRole(undefined)).toBe(false)
    })

    it('preserves the existing exact stored-role policy', () => {
      expect(isOfficerLeaderOrAdminRole(' officer ')).toBe(false)
      expect(isOfficerLeaderOrAdminRole('\tleader\n')).toBe(false)
      expect(isOfficerLeaderOrAdminRole(' admin ')).toBe(false)
    })
  })

  describe('canManageHeraldRole', () => {
    it('allows officer and leader', () => {
      expect(canManageHeraldRole('officer')).toBe(true)
      expect(canManageHeraldRole('leader')).toBe(true)
    })

    it('handles case variants', () => {
      expect(canManageHeraldRole('Officer')).toBe(true)
      expect(canManageHeraldRole('LEADER')).toBe(true)
    })

    it("DENIES 'admin' — the literal boss-playbooks/page.tsx used to accept", () => {
      // app_role has no 'admin' member, so only a self-set user_metadata.role could match.
      expect(canManageHeraldRole('admin')).toBe(false)
      expect(canManageHeraldRole('Admin')).toBe(false)
    })

    it('denies member, unknown, empty and missing roles', () => {
      expect(canManageHeraldRole('member')).toBe(false)
      expect(canManageHeraldRole('applicant')).toBe(false)
      expect(canManageHeraldRole('')).toBe(false)
      expect(canManageHeraldRole(null)).toBe(false)
      expect(canManageHeraldRole(undefined)).toBe(false)
    })

    it('does not trim — stored roles are exact', () => {
      expect(canManageHeraldRole(' officer ')).toBe(false)
      expect(canManageHeraldRole('\tleader\n')).toBe(false)
    })
  })
})
