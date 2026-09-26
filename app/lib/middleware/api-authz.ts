import type { User } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { db } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { findActiveBanForAuthUser } from '@/app/lib/auth/user-bans'

export async function checkApiSecurity(
  request: NextRequest,
  requiredRole?: string[]
): Promise<{
  allowed: boolean
  user?: User
  role?: string
  reason?: string
  deniedStatus?: 401 | 403
}> {
  void request
  try {
    const supabase = await db()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { allowed: false, reason: 'Authentication required' }
    }

    if (await findActiveBanForAuthUser(user)) {
      return {
        allowed: false,
        reason: 'Account suspended',
        deniedStatus: 403
      }
    }

    const { data: userProfile, error: profileError } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('role')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()

    if (profileError) {
      return { allowed: false, reason: 'Unable to verify permissions' }
    }

    const userRole = userProfile?.role || 'member'
    if (requiredRole && !requiredRole.includes(userRole)) {
      return {
        allowed: false,
        user,
        role: userRole,
        reason: `Insufficient permissions. Required: ${requiredRole.join(' or ')}, Current: ${userRole}`,
        deniedStatus: 403
      }
    }

    return { allowed: true, user, role: userRole }
  } catch {
    return { allowed: false, reason: 'Authentication check failed' }
  }
}
