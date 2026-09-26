import type { AuthData, UserProfile } from '@/app/lib/auth'

/** getAuthUser() may return an inactive mapping for recovery UX; this keeps only current membership. */
export function getActiveMembershipProfile(
  authData: AuthData | null | undefined
): UserProfile | null {
  return authData?.user.membershipStatus === 'active' ? authData.profile : null
}
