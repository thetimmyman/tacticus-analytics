import type { PlayerMapping, UserRole } from '@tacticus/app-core/types'

export type MembershipStatus = 'active' | 'inactive' | 'none'

/** Authenticated user: Supabase account metadata plus the player's mapping record. */
export interface AppUser {
  id: string
  email: string
  role: UserRole
  displayName: string | null
  guildCode: string | null
  timezone: string
  avatarUrl: string | null
  /** Null until onboarding completes. */
  profile: PlayerMapping | null
  /** 'active': is_current profile; 'inactive': can log in but not see guild data; 'none': needs onboarding. */
  membershipStatus: MembershipStatus
}

export interface AuthSession {
  user: AppUser | null
  accessToken: string | null
  refreshToken: string | null
  expiresAt: string | null
}
