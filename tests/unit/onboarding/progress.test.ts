import { describe, it, expect } from 'vitest'
import {
  resetStatusFields,
  type OnboardingProgress,
  type GuildMode
} from '@/app/lib/onboarding/progress'
import type {
  OnboardingGuildStatus,
  OnboardingSyncStatus
} from '@tacticus/app-core/onboarding.types'

describe('Onboarding Progress Utilities', () => {
  const createMockProgress = (
    overrides?: Partial<OnboardingProgress>
  ): OnboardingProgress => ({
    user_id: 'test-user-123',
    guild_mode: 'new_guild' as GuildMode,
    role_intent: 'member',
    guild_status: 'complete' as OnboardingGuildStatus,
    guild_code: 'TEST',
    guild_name: 'Test Guild',
    guild_error_message: 'Previous error',
    guild_can_retry: false,
    guild_lock_expires_at: null,
    sync_status: 'complete' as OnboardingSyncStatus,
    sync_progress: 100,
    sync_records_synced: 500,
    sync_error_message: 'Sync error',
    sync_can_retry: false,
    profile_status: 'complete',
    player_id: 'player-123',
    player_name: 'TestPlayer',
    profile_error_message: 'Profile error',
    profile_can_retry: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T12:00:00Z',
    ...overrides
  })

  describe('resetStatusFields', () => {
    it('clears all error messages by default', () => {
      const progress = createMockProgress()
      const result = resetStatusFields(progress, {})

      expect(result.guild_error_message).toBeNull()
      expect(result.sync_error_message).toBeNull()
      expect(result.profile_error_message).toBeNull()
    })

    it('enables retry for all status types by default', () => {
      const progress = createMockProgress()
      const result = resetStatusFields(progress, {})

      expect(result.guild_can_retry).toBe(true)
      expect(result.sync_can_retry).toBe(true)
      expect(result.profile_can_retry).toBe(true)
    })

    it('applies overrides after default reset', () => {
      const progress = createMockProgress()
      const result = resetStatusFields(progress, {
        guild_error_message: 'New error',
        guild_can_retry: false
      })

      expect(result.guild_error_message).toBe('New error')
      expect(result.guild_can_retry).toBe(false)
      expect(result.sync_error_message).toBeNull()
      expect(result.sync_can_retry).toBe(true)
    })

    it('allows overriding sync fields', () => {
      const progress = createMockProgress()
      const result = resetStatusFields(progress, {
        sync_error_message: 'Sync failed',
        sync_can_retry: false
      })

      expect(result.sync_error_message).toBe('Sync failed')
      expect(result.sync_can_retry).toBe(false)
    })

    it('allows overriding profile fields', () => {
      const progress = createMockProgress()
      const result = resetStatusFields(progress, {
        profile_error_message: 'Profile failed',
        profile_can_retry: false
      })

      expect(result.profile_error_message).toBe('Profile failed')
      expect(result.profile_can_retry).toBe(false)
    })

    it('can include additional fields in overrides', () => {
      const progress = createMockProgress()
      const result = resetStatusFields(progress, {
        guild_status: 'pending' as OnboardingGuildStatus,
        sync_status: 'pending' as OnboardingSyncStatus
      })

      expect(result.guild_status).toBe('pending')
      expect(result.sync_status).toBe('pending')
    })

    it('does not modify original progress object', () => {
      const progress = createMockProgress()
      const originalError = progress.guild_error_message

      resetStatusFields(progress, {})

      expect(progress.guild_error_message).toBe(originalError)
    })

    it('returns partial object suitable for update', () => {
      const progress = createMockProgress()
      const result = resetStatusFields(progress, {})

      expect(Object.keys(result)).toContain('guild_error_message')
      expect(Object.keys(result)).toContain('sync_error_message')
      expect(Object.keys(result)).toContain('profile_error_message')
      expect(Object.keys(result)).toContain('guild_can_retry')
      expect(Object.keys(result)).toContain('sync_can_retry')
      expect(Object.keys(result)).toContain('profile_can_retry')
    })

    it('handles progress with null error messages', () => {
      const progress = createMockProgress({
        guild_error_message: null,
        sync_error_message: null,
        profile_error_message: null
      })
      const result = resetStatusFields(progress, {})

      expect(result.guild_error_message).toBeNull()
      expect(result.sync_error_message).toBeNull()
      expect(result.profile_error_message).toBeNull()
    })

    it('handles progress with true can_retry values', () => {
      const progress = createMockProgress({
        guild_can_retry: true,
        sync_can_retry: true,
        profile_can_retry: true
      })
      const result = resetStatusFields(progress, {})

      expect(result.guild_can_retry).toBe(true)
      expect(result.sync_can_retry).toBe(true)
      expect(result.profile_can_retry).toBe(true)
    })
    it('lets an override re-set a field the default already cleared', () => {
      const progress = createMockProgress()
      const result = resetStatusFields(progress, {
        guild_can_retry: false,
        sync_can_retry: false,
        profile_can_retry: false
      })

      expect(result.guild_can_retry).toBe(false)
      expect(result.sync_can_retry).toBe(false)
      expect(result.profile_can_retry).toBe(false)
      expect(result.guild_error_message).toBeNull()
    })

    it('does not leak unrelated source fields into the update payload', () => {
      const progress = createMockProgress({
        guild_code: 'ABCD',
        sync_records_synced: 999
      })
      const result = resetStatusFields(progress, {})

      // Only reset fields are returned, so an update cannot clobber unrelated columns.
      expect(result).not.toHaveProperty('guild_code')
      expect(result).not.toHaveProperty('sync_records_synced')
      expect(result).not.toHaveProperty('user_id')
    })
  })
})
