import { requireAuth, requireRole } from '@/app/lib/auth'
import type { AuthData } from '@/app/lib/auth'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'

export interface BossAssignmentsAccess extends AuthData {
  /** Gates every mutation control and write effect; the write endpoints are officer-gated too. */
  canEdit: boolean
  /** Own-guild officers/leaders only; no app-admin bypass, since the Herald routes would 403. */
  canManageHerald: boolean
  /** App-admins only: the seed endpoint is `is_app_admin`-gated. */
  canSeed: boolean
}

/**
 * `canEdit` must not test role === 'admin': `user.role` can fall through to client-writable
 * `user_metadata.role`; use `profile.is_app_admin`. Zero I/O: the layout calls this.
 */
export async function requireBossAssignmentsAccess(): Promise<BossAssignmentsAccess> {
  const authData = await requireAuth()
  if (authData.profile?.is_app_admin) {
    return {
      ...authData,
      canEdit: true,
      // Not `true`: a non-officer admin would get herald controls that always 403.
      canManageHerald: canManageHeraldRole(authData.profile.role),
      canSeed: true
    }
  }

  const memberData = await requireRole('member')
  const role = String(memberData.profile.role ?? 'member').toLowerCase()
  const canEdit = role === 'officer' || role === 'leader'
  return {
    ...memberData,
    canEdit,
    canManageHerald: canManageHeraldRole(role),
    canSeed: memberData.profile.is_app_admin === true
  }
}
