import { describe, it, expect } from 'vitest'
import {
  classifyApiIncident,
  isRecentlyActiveGuild
} from '@/app/lib/services/api-key-incident-notifications'

describe('api-key-incident-notifications helpers', () => {
  describe('classifyApiIncident', () => {
    it('prioritizes invalid_api_key over failure count', () => {
      const incident = classifyApiIncident({
        api_key_is_valid: false,
        consecutive_sync_failures: 7
      })

      expect(incident?.type).toBe('invalid_api_key')
      expect(incident?.failureCount).toBe(7)
    })

    it('returns sync_failures when failures reach threshold', () => {
      const incident = classifyApiIncident({
        api_key_is_valid: true,
        consecutive_sync_failures: 3
      })

      expect(incident?.type).toBe('sync_failures')
      expect(incident?.failureCount).toBe(3)
    })

    it('returns null when guild is healthy', () => {
      const incident = classifyApiIncident({
        api_key_is_valid: true,
        consecutive_sync_failures: 1
      })

      expect(incident).toBeNull()
    })
  })

  describe('isRecentlyActiveGuild', () => {
    const now = new Date('2026-02-12T00:00:00.000Z')

    it('returns true when last_successful_sync is within lookback', () => {
      const isRecent = isRecentlyActiveGuild(
        {
          last_successful_sync: '2026-02-08T12:00:00.000Z',
          last_sync_attempt: null
        },
        now,
        14
      )

      expect(isRecent).toBe(true)
    })

    it('returns true when last_sync_attempt is within lookback', () => {
      const isRecent = isRecentlyActiveGuild(
        {
          last_successful_sync: null,
          last_sync_attempt: '2026-02-10T09:00:00.000Z'
        },
        now,
        14
      )

      expect(isRecent).toBe(true)
    })

    it('returns false when activity is outside lookback', () => {
      const isRecent = isRecentlyActiveGuild(
        {
          last_successful_sync: '2025-12-01T00:00:00.000Z',
          last_sync_attempt: '2025-12-05T00:00:00.000Z'
        },
        now,
        14
      )

      expect(isRecent).toBe(false)
    })
  })
})
