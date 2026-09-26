import { describe, it, expect } from 'vitest'
import { computeSeasonWindowMs } from '@/app/lib/boss-assignments/season-planner/season-window'

// Live LOKI values; bufferAfterSeasonEnd is the 24h inter-season gap.
const LIVE = {
  firstSeasonStartMs: 1_646_128_800_000,
  seasonDurationSeconds: 1_209_600,
  bufferAfterSeasonEndSeconds: 86_400,
  seasonNumberOffset: 10
}

const DAY_MS = 86_400_000
const ACTIVE_MS = (1_209_600 - 86_400) * 1000 // 13 active days

describe('computeSeasonWindowMs', () => {
  it('produces the REAL in-game boundaries for S99 (start 2026-04-22, not 24h-early 2026-04-21)', () => {
    const { seasonStartMs, seasonEndMs } = computeSeasonWindowMs(99, LIVE)
    // Omitting the inter-season gap would yield a start 24h early.
    expect(new Date(seasonStartMs).toISOString()).toBe(
      '2026-04-22T10:00:00.000Z'
    )
    expect(new Date(seasonEndMs).toISOString()).toBe('2026-05-05T10:00:00.000Z')
  })

  it('produces the REAL S103 window (2026-06-17 .. 2026-06-30)', () => {
    const { seasonStartMs, seasonEndMs } = computeSeasonWindowMs(103, LIVE)
    expect(new Date(seasonStartMs).toISOString()).toBe(
      '2026-06-17T10:00:00.000Z'
    )
    expect(new Date(seasonEndMs).toISOString()).toBe('2026-06-30T10:00:00.000Z')
  })

  it('REGRESSION: includes the leading inter-season gap — start is exactly 24h LATER than the gap-omitting formula', () => {
    const season = 99
    const cycleMs = LIVE.seasonDurationSeconds * 1000
    const seasonsElapsed = season + LIVE.seasonNumberOffset - 1
    const buggyStartMs = LIVE.firstSeasonStartMs + seasonsElapsed * cycleMs

    const { seasonStartMs } = computeSeasonWindowMs(season, LIVE)
    expect(seasonStartMs - buggyStartMs).toBe(
      LIVE.bufferAfterSeasonEndSeconds * 1000
    )
    expect(seasonStartMs - buggyStartMs).toBe(DAY_MS)
  })

  it('keeps the active window at one cycle minus the trailing gap (13 days)', () => {
    const { seasonStartMs, seasonEndMs } = computeSeasonWindowMs(103, LIVE)
    expect(seasonEndMs - seasonStartMs).toBe(ACTIVE_MS)
    expect((seasonEndMs - seasonStartMs) / DAY_MS).toBe(13)
  })

  it('REGRESSION: during the real final day, secondsRemaining is positive (card must NOT read "season ended")', () => {
    const now = Date.parse('2026-06-29T18:00:00.000Z')
    const { seasonEndMs } = computeSeasonWindowMs(103, LIVE)
    const secondsRemaining = Math.max(0, (seasonEndMs - now) / 1000)
    expect(secondsRemaining).toBe(16 * 3600)
    expect(seasonEndMs).toBeGreaterThan(now)
  })

  it('matches the canonical contract on simple numbers (start = first + gap + elapsed*cycle)', () => {
    const constants = {
      firstSeasonStartMs: 1000,
      seasonDurationSeconds: 100, // cycleMs = 100_000
      bufferAfterSeasonEndSeconds: 10, // gapMs = 10_000, activeMs = 90_000
      seasonNumberOffset: 0
    }
    const { seasonStartMs, seasonEndMs } = computeSeasonWindowMs(1, constants)
    expect(seasonStartMs).toBe(1000 + 10_000 + 0)
    expect(seasonEndMs).toBe(11_000 + 90_000)
  })
})
