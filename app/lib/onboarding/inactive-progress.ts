import type { MembershipStatus } from '@/app/types'
import type { OnboardingProgress } from '@/app/lib/onboarding/progress'

/** An inactive account's former guild is not current authority; strip it before any lookup. */
export function sanitizeInactiveOnboardingProgress(
  progress: OnboardingProgress,
  membershipStatus: MembershipStatus
): OnboardingProgress {
  if (membershipStatus !== 'inactive') return progress

  return {
    ...progress,
    guild_mode: 'existing_guild',
    role_intent: 'member',
    guild_status: 'not_started',
    guild_code: null,
    guild_name: null,
    guild_error_message: null,
    guild_can_retry: true,
    guild_lock_expires_at: null,
    sync_status: 'not_required',
    sync_progress: 0,
    sync_records_synced: 0,
    sync_error_message: null,
    sync_can_retry: true,
    profile_status: 'not_started',
    player_id: null,
    player_name: null,
    profile_error_message: null,
    profile_can_retry: true
  }
}
