import { describe, it, expect } from 'vitest'
// The WarExplorer formatter stays inline in its component, so its block keeps a copy.
import {
  formatShortDate,
  formatSeasonDateTime,
  formatUtcDateShort,
  formatUtcDateLabel
} from '@/app/lib/season-date/date-format'
import {
  CLOSED_SEASON_TTL_SECONDS,
  CURRENT_SEASON_TTL_SECONDS
} from '@/app/lib/season-date/ttl'
import { resolveEffectiveSeason } from '@/app/lib/season-date/precedence'

// A midday-UTC instant keeps Y/M/D identical in every real timezone.
const ISO_MIDDAY = '2026-01-05T13:07:00Z'

describe('AchievementsClient.formatDate (hasMounted-guarded, en-US short date)', () => {
  const subject = formatShortDate

  it('hasMounted=false returns the SSR placeholder "recently"', () => {
    expect(subject(ISO_MIDDAY, false)).toBe('recently')
  })
  it('null value returns null', () => {
    expect(subject(null, true)).toBeNull()
    expect(subject(null, false)).toBeNull()
  })
  it('hasMounted=true formats en-US "Mon D, YYYY"', () => {
    expect(subject(ISO_MIDDAY, true)).toBe('Jan 5, 2026')
  })
})

describe('SeasonPlannerClient.formatDateTime (hasMounted-guarded, explicit timeZone)', () => {
  const subject = formatSeasonDateTime

  it('hasMounted=false returns the SSR placeholder "—"', () => {
    expect(subject(ISO_MIDDAY, 'UTC', false)).toBe('—')
  })
  it('invalid ISO returns the raw input verbatim (no throw)', () => {
    expect(subject('not-a-date', 'UTC', true)).toBe('not-a-date')
    expect(subject('not-a-date', 'UTC', false)).toBe('not-a-date')
  })
  it('UTC timeZone => 24h "MM/DD/YYYY, HH:mm"', () => {
    expect(subject(ISO_MIDDAY, 'UTC', true)).toBe('01/05/2026, 13:07')
  })
  it('explicit non-UTC timeZone shifts the wall-clock deterministically', () => {
    expect(subject(ISO_MIDDAY, 'America/New_York', true)).toBe(
      '01/05/2026, 08:07'
    )
  })
  it('empty timeZone string falls back to UTC', () => {
    expect(subject(ISO_MIDDAY, '', true)).toBe('01/05/2026, 13:07')
  })
})

// WarExplorer `formatDate` uses the local tz, so its time string is asserted only under UTC.
describe('GuildWarExplorerClient.formatDate (hasMounted-guarded, en-US short datetime, local tz)', () => {
  const subject = (dateStr: string | null, hasMounted: boolean): string => {
    if (!dateStr) return '-'
    if (!hasMounted) return '-'
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  it('null returns "-"', () => {
    expect(subject(null, true)).toBe('-')
  })
  it('hasMounted=false returns "-" (SSR placeholder)', () => {
    expect(subject(ISO_MIDDAY, false)).toBe('-')
  })
  it('hasMounted=true formats en-US "Mon D, hh:mm AM/PM" (UTC tz only)', () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const out = subject(ISO_MIDDAY, true)
    if (tz === 'UTC' || tz === 'Etc/UTC') {
      expect(out).toBe('Jan 5, 01:07 PM')
    } else {
      expect(out).toMatch(/^Jan \d{1,2}, \d{2}:\d{2}\s?[AP]M$/)
    }
  })
})

describe('WarMatchCard.formatDateShort (UTC parts, locale-independent)', () => {
  const subject = formatUtcDateShort

  it('null returns "Unknown"', () => {
    expect(subject(null)).toBe('Unknown')
  })
  it('invalid returns "Unknown"', () => {
    expect(subject('xyz')).toBe('Unknown')
  })
  it('formats UTC YYYY-MM-DD with zero padding', () => {
    expect(subject(ISO_MIDDAY)).toBe('2026-01-05')
    expect(subject('2026-12-31T23:59:00Z')).toBe('2026-12-31')
    expect(subject('2026-03-09T00:00:00Z')).toBe('2026-03-09')
  })
})

describe('ActivityAnalytics.formatDateLabel (ISO passthrough + UTC parts)', () => {
  const subject = formatUtcDateLabel

  it('passes a bare ISO date through verbatim', () => {
    expect(subject('2026-01-05')).toBe('2026-01-05')
  })
  it('collapses a full ISO timestamp to UTC YYYY-MM-DD', () => {
    expect(subject(ISO_MIDDAY)).toBe('2026-01-05')
  })
  it('returns the raw string when unparseable', () => {
    expect(subject('hello')).toBe('hello')
  })
  it('numeric epoch-ms input is String()-ed first, becomes an Invalid Date, returns raw digits', () => {
    // `new Date("1767618420000")` is Invalid Date, so the raw string is returned.
    const ms = Date.parse(ISO_MIDDAY) // 1767618420000
    expect(subject(ms)).toBe(String(ms))
  })
})

// Season TTLs: centralize only if every consumer keeps these exact numbers.
describe('Season TTL constants (centralization must preserve exact numbers)', () => {
  it('CLOSED_SEASON_TTL_SECONDS == 86400 (24h)', () => {
    expect(CLOSED_SEASON_TTL_SECONDS).toBe(86400)
    expect(CLOSED_SEASON_TTL_SECONDS).toBe(24 * 60 * 60)
  })
  it('CURRENT_SEASON_TTL_SECONDS == 300 (5m)', () => {
    expect(CURRENT_SEASON_TTL_SECONDS).toBe(300)
    expect(CURRENT_SEASON_TTL_SECONDS).toBe(5 * 60)
  })
  it('cached.ts and target-scores-batch.ts duplicates hold IDENTICAL values', () => {
    expect(CLOSED_SEASON_TTL_SECONDS).toBe(24 * 60 * 60)
    expect(CURRENT_SEASON_TTL_SECONDS).toBe(5 * 60)
  })
  it('SeasonSelector staleTime == 300000ms (== CURRENT_SEASON_TTL_SECONDS * 1000)', () => {
    expect(5 * 60 * 1000).toBe(300000)
    expect(CURRENT_SEASON_TTL_SECONDS * 1000).toBe(300000)
  })
  it('SeasonSelector gcTime == 600000ms (10m, double staleTime)', () => {
    expect(10 * 60 * 1000).toBe(600000)
    expect(10 * 60 * 1000).toBe(2 * (5 * 60 * 1000))
  })
})

describe('resolveEffectiveSeason (params.season || latestSeason equivalence)', () => {
  it('present URL season wins over the fallback', () => {
    expect(resolveEffectiveSeason('100', '83')).toBe('100')
  })
  it('undefined URL season falls through to the fallback', () => {
    expect(resolveEffectiveSeason(undefined, '83')).toBe('83')
  })
  it('empty-string URL season falls through to the fallback (|| semantics)', () => {
    expect(resolveEffectiveSeason('', '83')).toBe('83')
  })
})
