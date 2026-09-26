import { describe, expect, it } from 'vitest'
import type { OnboardingProgress } from '@/app/lib/onboarding/progress'
import { sanitizeInactiveOnboardingProgress } from '@/app/lib/onboarding/inactive-progress'

const historicalProgress: OnboardingProgress = {
  user_id: 'user-1',
  guild_mode: 'new_guild',
  role_intent: 'leader',
  guild_status: 'failed',
  guild_code: 'FORMER',
  guild_name: 'Former Guild',
  guild_error_message: 'former error',
  guild_can_retry: false,
  guild_lock_expires_at: '2026-08-04T00:00:00Z',
  sync_status: 'failed',
  sync_progress: 73,
  sync_records_synced: 1234,
  sync_error_message: 'former sync error',
  sync_can_retry: false,
  profile_status: 'complete',
  player_id: 'player-1',
  player_name: 'Player One',
  profile_error_message: null,
  profile_can_retry: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z'
}

describe('sanitizeInactiveOnboardingProgress', () => {
  it('clears former guild and sync state for an inactive membership', () => {
    expect(
      sanitizeInactiveOnboardingProgress(historicalProgress, 'inactive')
    ).toEqual({
      ...historicalProgress,
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
    })
  })

  it.each(['none', 'active'] as const)(
    'preserves the durable progress object for a %s membership',
    (membershipStatus) => {
      expect(
        sanitizeInactiveOnboardingProgress(historicalProgress, membershipStatus)
      ).toBe(historicalProgress)
    }
  )
})
