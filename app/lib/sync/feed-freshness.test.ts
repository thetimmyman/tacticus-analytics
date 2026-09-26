import { describe, it, expect } from 'vitest'
import {
  REALTIME_CADENCE_SECONDS,
  SYNC_FEEDS,
  SYNC_TIER_CADENCE_SECONDS,
  feedStatus,
  formatAge,
  formatCadence,
  readFeed,
  resolveRaidCadenceSeconds
} from '@/app/lib/sync/feed-freshness'

const MIN = 60
const HOUR = 3600
const DAY = 86400

const raid = SYNC_FEEDS.find((f) => f.key === 'raid')!

describe('feedStatus', () => {
  it('judges the feed against its own cadence', () => {
    expect(feedStatus(45 * MIN, REALTIME_CADENCE_SECONDS)).toBe('overdue')
    expect(feedStatus(45 * MIN, HOUR)).toBe('current')
  })

  it('tolerates one missed cycle, flags three, condemns beyond', () => {
    expect(feedStatus(2 * raid.cadenceSeconds, raid.cadenceSeconds)).toBe(
      'current'
    )
    expect(feedStatus(3 * raid.cadenceSeconds, raid.cadenceSeconds)).toBe(
      'late'
    )
    expect(feedStatus(6 * raid.cadenceSeconds, raid.cadenceSeconds)).toBe(
      'late'
    )
    expect(feedStatus(7 * raid.cadenceSeconds, raid.cadenceSeconds)).toBe(
      'overdue'
    )
  })

  it('separates "never reported" from "overdue"', () => {
    expect(feedStatus(null, raid.cadenceSeconds)).toBe('never')
    expect(feedStatus(99 * DAY, raid.cadenceSeconds)).toBe('overdue')
  })

  it('does not divide by a zero cadence', () => {
    expect(feedStatus(60, 0)).toBe('overdue')
  })
})

describe('formatAge', () => {
  it('keeps a dead feed legible instead of bucketing it', () => {
    expect(formatAge(5 * DAY)).toBe('5 days ago')
    expect(formatAge(14 * DAY)).toBe('14 days ago')
  })

  it('stays in seconds under a minute so an active feed visibly moves', () => {
    expect(formatAge(44)).toBe('44 seconds ago')
    expect(formatAge(1)).toBe('1 second ago')
    expect(formatAge(0)).toBe('0 seconds ago')
  })

  it('steps through minutes and hours', () => {
    expect(formatAge(60)).toBe('1 minute ago')
    expect(formatAge(59 * MIN)).toBe('59 minutes ago')
    expect(formatAge(HOUR)).toBe('1 hour ago')
    expect(formatAge(47 * HOUR)).toBe('47 hours ago')
    expect(formatAge(48 * HOUR)).toBe('2 days ago')
  })

  it('renders a never-reported feed without inventing an age', () => {
    expect(formatAge(null)).toBe('never')
    expect(formatAge(Number.NaN)).toBe('never')
  })
})

describe('formatCadence', () => {
  it('matches the real production schedules', () => {
    expect(formatCadence(REALTIME_CADENCE_SECONDS)).toBe('every 2 min')
    expect(formatCadence(SYNC_TIER_CADENCE_SECONDS.active!)).toBe('every 1h')
    expect(formatCadence(SYNC_TIER_CADENCE_SECONDS.dormant!)).toBe('every 12h')
  })

  it('handles day-scale and invalid cadences', () => {
    expect(formatCadence(DAY)).toBe('every 1d')
    expect(formatCadence(0)).toBe('unknown')
  })
})

describe('readFeed', () => {
  it('reports the raw age alongside the cadence', () => {
    const now = Date.UTC(2026, 7, 6, 12, 0, 0)
    const reading = readFeed(raid, now - 44_000, now)

    expect(reading.ageLabel).toBe('44 seconds ago')
    expect(reading.cadenceLabel).toBe('every 1h')
    expect(reading.status).toBe('current')
  })

  it('judges against the caller-supplied cadence when one is given', () => {
    const now = Date.UTC(2026, 7, 6, 12, 0, 0)
    const tenMinutesStale = readFeed(raid, now - 10 * 60_000, now)
    expect(tenMinutesStale.status).toBe('current')

    const realtime = readFeed(
      raid,
      now - 10 * 60_000,
      now,
      REALTIME_CADENCE_SECONDS
    )
    expect(realtime.status).toBe('overdue')
    expect(realtime.cadenceLabel).toBe('every 2 min')
  })

  it('ignores a nonsensical cadence override rather than dividing by it', () => {
    const now = Date.UTC(2026, 7, 6, 12, 0, 0)
    for (const bad of [0, -1, Number.NaN, null]) {
      expect(readFeed(raid, now - 60_000, now, bad).cadenceSeconds).toBe(
        raid.cadenceSeconds
      )
    }
  })

  it('clamps clock skew instead of reporting a negative age', () => {
    const now = Date.UTC(2026, 7, 6, 12, 0, 0)
    const reading = readFeed(raid, now + 30_000, now)

    expect(reading.ageSeconds).toBe(0)
    expect(reading.status).toBe('current')
  })

  it('carries "never" through without an age', () => {
    const reading = readFeed(raid, null, Date.UTC(2026, 7, 6, 12, 0, 0))
    expect(reading.ageSeconds).toBeNull()
    expect(reading.status).toBe('never')
    expect(reading.ageLabel).toBe('never')
  })
})

describe('resolveRaidCadenceSeconds', () => {
  it('gives realtime-flagged guilds the fast cadence', () => {
    expect(resolveRaidCadenceSeconds({ realtimeSync: true })).toBe(
      REALTIME_CADENCE_SECONDS
    )
    expect(
      resolveRaidCadenceSeconds({ realtimeSync: true, syncTier: 'dormant' })
    ).toBe(REALTIME_CADENCE_SECONDS)
  })

  it('falls back to the active tier for unknown or missing tiers', () => {
    expect(resolveRaidCadenceSeconds({})).toBe(HOUR)
    expect(resolveRaidCadenceSeconds({ syncTier: null })).toBe(HOUR)
    expect(resolveRaidCadenceSeconds({ syncTier: 'nonsense' })).toBe(HOUR)
    expect(resolveRaidCadenceSeconds({ syncTier: 'warm' })).toBe(4 * HOUR)
  })
})

describe('SYNC_FEEDS', () => {
  it('keeps the cadence constants in step with the lane that sets the pace', async () => {
    // The real cadence is guild-batch-sync's staleness thresholds, not the cron.
    const { __internal } = await import('@/app/lib/jobs/guild-batch-sync')

    for (const [tier, seconds] of Object.entries(SYNC_TIER_CADENCE_SECONDS)) {
      expect(__internal.TIER_STALE_THRESHOLDS[tier]).toBe(seconds * 1000)
    }
    expect(Object.keys(SYNC_TIER_CADENCE_SECONDS).sort()).toEqual(
      Object.keys(__internal.TIER_STALE_THRESHOLDS).sort()
    )
    expect(__internal.REALTIME_STALE_THRESHOLD_MS).toBe(
      REALTIME_CADENCE_SECONDS * 1000
    )
  })

  it('keeps a fallback cadence that is a real tier, not the cron interval', () => {
    for (const feed of SYNC_FEEDS) {
      expect(Object.values(SYNC_TIER_CADENCE_SECONDS)).toContain(
        feed.cadenceSeconds
      )
    }
  })
})
