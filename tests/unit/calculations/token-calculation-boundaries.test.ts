import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calculateTokenAvailability,
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'

const SEC = 1000
const HOUR_MS = 60 * 60 * SEC
const NOW_MS = Date.parse('2026-06-01T00:00:00.000Z')

function isoMinusHours(hours: number): string {
  return new Date(NOW_MS - hours * HOUR_MS).toISOString()
}

describe('calculateTokenAvailability boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_MS))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps tokens pinned at the cap after a long idle and resets the refresh timer', () => {
    // Idle >24h regenerates to the cap, which resets refreshTime to now: no cooldown.
    const result = calculateTokenAvailability([
      {
        displayName: 'CappedIdler',
        damageType: 'Battle',
        startedOn: isoMinusHours(240) // 10 days ago
      }
    ])

    expect(result.tokensAvailable).toBe(MAX_TOKENS)
    expect(result.tokenCooldown).toBeNull()
    expect(result.tokenNextSeconds ?? null).toBeNull()

    const nowSeconds = Math.floor(NOW_MS / 1000)
    expect(result.tokenStatus.count).toBe(MAX_TOKENS)
    expect(result.tokenStatus.refreshTime).toBe(nowSeconds)
  })

  it('never re-anchors refreshTime on spends — regen runs continuously below cap (SQL parity)', () => {
    // Regen anchors on dropping below cap and ignores later spends, matching the SQL replay.
    const battles = [
      {
        displayName: 'ZeroBurst',
        damageType: 'Battle' as const,
        startedOn: isoMinusHours(5)
      },
      {
        displayName: 'ZeroBurst',
        damageType: 'Battle' as const,
        startedOn: isoMinusHours(4)
      },
      {
        displayName: 'ZeroBurst',
        damageType: 'Battle' as const,
        startedOn: isoMinusHours(3)
      }
    ]

    const result = calculateTokenAvailability(battles)

    expect(result.tokensAvailable).toBe(0)

    const anchorSeconds = Math.floor((NOW_MS - 5 * HOUR_MS) / 1000)
    expect(result.tokenStatus.refreshTime).toBe(anchorSeconds)

    const elapsedSinceAnchor = 5 * 60 * 60
    const expectedNext = TWELVE_HOURS_IN_SECONDS - elapsedSinceAnchor
    expect(result.tokenNextSeconds).toBe(expectedNext)
  })

  it('computes the bomb 18h cooldown on the no-token-battle path for a bomb-only history', () => {
    // Bomb availability is computed independently of the no-token-battle early return.
    const result = calculateTokenAvailability([
      {
        displayName: 'BomberOnly',
        damageType: 'Bomb',
        startedOn: isoMinusHours(2) // 2h ago, well within the 18h bomb cooldown
      }
    ])

    expect(result.tokensAvailable).toBe(MAX_TOKENS)
    expect(result.tokenCooldown).toBeNull()

    expect(result.bombsAvailable).toBe(0)
    expect(result.bombCooldown).not.toBeNull()
    expect(result.bombNextSeconds).toBe(16 * 60 * 60)
    expect(result.tokenStatus.refreshTime).toBe(Math.floor(NOW_MS / 1000))
    expect(result.lastBattleTime).toBeUndefined()
  })
})
