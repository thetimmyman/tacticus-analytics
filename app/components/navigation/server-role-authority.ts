import type { UserRole } from '@tacticus/app-core/types'

interface NavigationRoleProfile {
  role?: string | null
}

interface NavigationRoleUser {
  role?: UserRole | null
}

/** A resolved profile is authoritative; session metadata is only an onboarding fallback. */
export function resolveServerNavigationRole(
  profile: NavigationRoleProfile | null | undefined,
  user: NavigationRoleUser | null | undefined
): NonNullable<UserRole> {
  if (profile) {
    return (profile.role ?? 'member') as NonNullable<UserRole>
  }

  return user?.role ?? 'member'
}
