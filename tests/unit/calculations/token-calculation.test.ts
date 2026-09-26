import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  calculateTokenAvailability,
  getTokenAvailability,
  calculateGuildTokenAvailability
} from '@/app/lib/calculations/token-calculation'

describe('Token Calculation Engine', () => {
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000
  const now = new Date('2024-01-01T20:00:00Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('calculateTokenAvailability', () => {
    it('initializes with 3 tokens when no battles and no season start', () => {
      const result = calculateTokenAvailability([], undefined, now)

      expect(result.tokensAvailable).toBe(3)
      expect(result.bombsAvailable).toBe(1)
    })

    it('handles initial state at season start', () => {
      const seasonStart = new Date('2024-01-01T00:00:00Z')
      const result = calculateTokenAvailability([], seasonStart, seasonStart)

      expect(result.tokensAvailable).toBe(2)
    })

    it('regenerates tokens after season start', () => {
      const seasonStart = new Date('2024-01-01T00:00:00Z')
      const twelveHoursLater = new Date(seasonStart.getTime() + TWELVE_HOURS_MS)
      const result = calculateTokenAvailability(
        [],
        seasonStart,
        twelveHoursLater
      )

      expect(result.tokensAvailable).toBe(3)
    })

    it('deducts tokens for battles', () => {
      const startTime = new Date('2024-01-01T00:00:00Z')
      const battles: any[] = [
        {
          displayName: 'P1',
          damageType: 'Battle',
          startedOn: startTime.toISOString()
        }
      ]

      const result = calculateTokenAvailability(battles, undefined, startTime)
      expect(result.tokensAvailable).toBe(1)
    })

    it('tracks token regeneration between battles', () => {
      const start = new Date('2024-01-01T00:00:00Z')
      const battle1Time = start.toISOString()
      const battle2Time = new Date(
        start.getTime() + TWELVE_HOURS_MS
      ).toISOString()

      const battles: any[] = [
        { displayName: 'P1', damageType: 'Battle', startedOn: battle1Time },
        { displayName: 'P1', damageType: 'Battle', startedOn: battle2Time }
      ]

      const result = calculateTokenAvailability(
        battles,
        undefined,
        new Date(battle2Time)
      )
      expect(result.tokensAvailable).toBe(1)
    })

    it('handles bomb cooldown', () => {
      const bombTime = new Date(
        now.getTime() - 10 * 60 * 60 * 1000
      ).toISOString()

      const battles: any[] = [
        // Normal battle avoids the implementation's early return.
        {
          displayName: 'P1',
          damageType: 'Battle',
          startedOn: new Date(now.getTime() - 11 * 60 * 60 * 1000).toISOString()
        },
        { displayName: 'P1', damageType: 'Bomb', startedOn: bombTime }
      ]

      const result = calculateTokenAvailability(battles, undefined, now)

      expect(result.bombsAvailable).toBe(0)
      expect(result.bombCooldown).toBeDefined()

      const later = new Date(now.getTime() + 10 * 60 * 60 * 1000)
      const result2 = calculateTokenAvailability(battles, undefined, later)
      expect(result2.bombsAvailable).toBe(1)
    })
  })

  describe('getTokenAvailability (Unified)', () => {
    it('always calculates from battle history (live API is fetched separately by token-service)', () => {
      const syncData = {
        last_sync_tokens: 2,
        last_sync_bombs: 1,
        last_sync_at: now.toISOString(),
        api_key_is_valid: true,
        tacticus_api_key_encrypted: 'key'
      }

      const result = getTokenAvailability(syncData, [], undefined, now)
      expect(result.dataSource).toBe('calculated')
    })

    it('falls back to calculation when no API key', () => {
      const syncData = {
        last_sync_tokens: null,
        last_sync_bombs: null,
        last_sync_at: null,
        api_key_is_valid: false,
        tacticus_api_key_encrypted: null
      }

      const result = getTokenAvailability(syncData, [], undefined, now)
      expect(result.dataSource).toBe('calculated')
    })

    it('falls back to calculation when API key is invalid (even with stale sync data)', () => {
      // Stale sync data from a since-invalidated key must not be trusted.
      const syncData = {
        last_sync_tokens: 1,
        last_sync_bombs: 0,
        last_sync_at: new Date(
          now.getTime() - 7 * 24 * 60 * 60 * 1000
        ).toISOString(), // 1 week ago
        api_key_is_valid: false, // Key is now invalid
        tacticus_api_key_encrypted: 'old-key-still-exists'
      }

      const result = getTokenAvailability(syncData, [], undefined, now)
      expect(result.dataSource).toBe('calculated')
    })
  })

  describe('calculateGuildTokenAvailability', () => {
    it('groups battles by player and calculates for each', () => {
      const start = new Date('2024-01-01T00:00:00Z')
      const battleTime = start.toISOString()

      const battles: any[] = [
        { displayName: 'PlayerA', damageType: 'Battle', startedOn: battleTime },
        { displayName: 'PlayerB', damageType: 'Battle', startedOn: battleTime }
      ]

      const results = calculateGuildTokenAvailability(battles, start)

      expect(results.has('PlayerA')).toBe(true)
      expect(results.has('PlayerB')).toBe(true)

      // Pinned: one battle at `start` evaluated at `start` still reports 2.
      expect(results.get('PlayerA')?.tokensAvailable).toBe(2)
    })
  })
})
