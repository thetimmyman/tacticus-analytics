import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { MembershipStatus } from '@/app/types'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('onboarding.membership-state')

export type OnboardingMembershipState = MembershipStatus | 'error'

type MembershipRow = {
  is_current: boolean | null
}

// Unlike getCurrentUser(), a lookup failure here is a distinct fail-closed 'error' state.
export async function resolveOnboardingMembershipState(
  serviceClient: TypedSupabaseClient,
  userId: string
): Promise<OnboardingMembershipState> {
  try {
    const { data, error } = await serviceClient
      .from('player_mapping')
      .select('is_current')
      .eq('user_id', userId)

    if (error) {
      logger.warn(
        { userId, error: error.message },
        'Strict onboarding membership lookup failed'
      )
      return 'error'
    }

    const rows = (data ?? []) as MembershipRow[]
    if (rows.some((row) => row.is_current === true)) return 'active'
    if (rows.length > 0) return 'inactive'
    return 'none'
  } catch (error) {
    logger.error({ userId, error }, 'Strict onboarding membership lookup threw')
    return 'error'
  }
}
