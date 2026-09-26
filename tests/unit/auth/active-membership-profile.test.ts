import { describe, expect, it } from 'vitest'
import type { AuthData } from '@/app/lib/auth'
import { getActiveMembershipProfile } from '@/app/lib/auth/active-membership-profile'

const profile = {
  user_id: 'user-1',
  guild_code: 'GUILD',
  role: 'leader',
  theme_preference: 'guild-theme'
}

function authData(membershipStatus: 'active' | 'inactive'): AuthData {
  return {
    user: { membershipStatus },
    profile
  } as AuthData
}

describe('getActiveMembershipProfile', () => {
  it('returns the current profile for an active membership', () => {
    expect(getActiveMembershipProfile(authData('active'))).toBe(profile)
  })

  it('scrubs the retained profile for an inactive membership', () => {
    expect(getActiveMembershipProfile(authData('inactive'))).toBeNull()
  })

  it('returns null for anonymous auth data', () => {
    expect(getActiveMembershipProfile(null)).toBeNull()
  })
})
