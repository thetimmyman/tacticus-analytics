import { describe, expect, it } from 'vitest'
import {
  DAILY_MIN_SPACING_HOURS,
  ROLLOVER_WINDOW_HOURS,
  buildAuditRow,
  decideAuditMode,
  type LiveTokenReading
} from '@/app/lib/token-audit/audit-core'
import {
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'

const NOW = new Date('2026-07-02T12:00:00.000Z')

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

describe('decideAuditMode', () => {
  it('returns rollover inside the season rollover window', () => {
    expect(
      decideAuditMode({
        now: NOW,
        seasonStartAt: null,
        seasonFirstBattleAt: hoursAgo(ROLLOVER_WINDOW_HOURS - 1),
        lastDailyRunAt: hoursAgo(1)
      })
    ).toBe('rollover')
  })

  it('rollover window is half-open: exactly at the boundary falls back to daily rules', () => {
    expect(
      decideAuditMode({
        now: NOW,
        seasonStartAt: null,
        seasonFirstBattleAt: hoursAgo(ROLLOVER_WINDOW_HOURS),
        lastDailyRunAt: null
      })
    ).toBe('daily')
  })

  it('ignores a first battle in the future (clock skew / bad data)', () => {
    expect(
      decideAuditMode({
        now: NOW,
        seasonStartAt: null,
        seasonFirstBattleAt: hoursAgo(-2),
        lastDailyRunAt: null
      })
    ).toBe('daily')
  })

  it('skips when the last daily run is within the spacing window', () => {
    expect(
      decideAuditMode({
        now: NOW,
        seasonStartAt: hoursAgo(200),
        seasonFirstBattleAt: hoursAgo(100),
        lastDailyRunAt: hoursAgo(DAILY_MIN_SPACING_HOURS - 1)
      })
    ).toBeNull()
  })

  it('runs daily once the spacing window has elapsed', () => {
    expect(
      decideAuditMode({
        now: NOW,
        seasonStartAt: hoursAgo(200),
        seasonFirstBattleAt: hoursAgo(100),
        lastDailyRunAt: hoursAgo(DAILY_MIN_SPACING_HOURS)
      })
    ).toBe('daily')
  })

  it('runs daily when the guild has never been audited', () => {
    expect(
      decideAuditMode({
        now: NOW,
        seasonStartAt: null,
        seasonFirstBattleAt: null,
        lastDailyRunAt: null
      })
    ).toBe('daily')
  })

  it('rollover wins over daily spacing (hourly cadence during the window)', () => {
    expect(
      decideAuditMode({
        now: NOW,
        seasonStartAt: null,
        seasonFirstBattleAt: hoursAgo(2),
        lastDailyRunAt: hoursAgo(1)
      })
    ).toBe('rollover')
  })

  it('season-calendar start triggers rollover BEFORE the first battle (Phase 1 pre-battle evidence)', () => {
    expect(
      decideAuditMode({
        now: NOW,
        seasonStartAt: hoursAgo(3),
        seasonFirstBattleAt: null,
        lastDailyRunAt: hoursAgo(1)
      })
    ).toBe('rollover')
  })

  it('stale calendar start outside the window defers to the first-battle anchor', () => {
    expect(
      decideAuditMode({
        now: NOW,
        seasonStartAt: hoursAgo(ROLLOVER_WINDOW_HOURS + 10),
        seasonFirstBattleAt: hoursAgo(2),
        lastDailyRunAt: hoursAgo(1)
      })
    ).toBe('rollover')
  })
})

const LIVE_OK: LiveTokenReading = {
  current: 2,
  max: MAX_TOKENS,
  nextTokenInSeconds: 3600,
  regenDelayInSeconds: TWELVE_HOURS_IN_SECONDS
}

function row(
  overrides: Partial<Parameters<typeof buildAuditRow>[0]> = {}
): ReturnType<typeof buildAuditRow> {
  return buildAuditRow({
    guildCode: 'TEST',
    playerId: 'p1',
    displayName: 'Player One',
    season: '100',
    mode: 'daily',
    live: LIVE_OK,
    liveBombs: null,
    replay: { tokensAvailable: 1, tokenNextSeconds: 900 },
    rpc: { tokensAvailable: 3, tokenNextSeconds: null, dataSource: 'live' },
    cptaTokens: 0,
    battleRowsSeen: 7,
    ...overrides
  })
}

describe('buildAuditRow', () => {
  it('computes deltas as estimator minus live (negative = undercount)', () => {
    const r = row()
    expect(r.replay_tokens_delta).toBe(1 - 2)
    expect(r.rpc_tokens_delta).toBe(3 - 2)
    expect(r.cpta_tokens_delta).toBe(0 - 2)
  })

  it('propagates nulls when an estimator produced nothing', () => {
    const r = row({ replay: null, rpc: null, cptaTokens: null })
    expect(r.replay_tokens).toBeNull()
    expect(r.replay_tokens_delta).toBeNull()
    expect(r.rpc_tokens).toBeNull()
    expect(r.rpc_tokens_delta).toBeNull()
    expect(r.rpc_data_source).toBeNull()
    expect(r.cpta_tokens).toBeNull()
    expect(r.cpta_tokens_delta).toBeNull()
  })

  it('treats an estimator zero as a real reading, not a missing one', () => {
    const r = row({ replay: { tokensAvailable: 0, tokenNextSeconds: 10 } })
    expect(r.replay_tokens).toBe(0)
    expect(r.replay_tokens_delta).toBe(0 - 2)
  })

  it('constants_ok is true when live matches the canonical economy constants', () => {
    expect(row().constants_ok).toBe(true)
  })

  it('constants_ok flags a changed cap', () => {
    expect(row({ live: { ...LIVE_OK, max: 4 } }).constants_ok).toBe(false)
  })

  it('constants_ok flags a changed regen delay', () => {
    expect(
      row({
        live: { ...LIVE_OK, regenDelayInSeconds: TWELVE_HOURS_IN_SECONDS - 1 }
      }).constants_ok
    ).toBe(false)
  })

  it('omits rpc_post_snapshot_spends entirely when the RPC lacks the field (pre-S2)', () => {
    // Key absence is load-bearing: the token_audit_snapshots column may not exist yet.
    expect('rpc_post_snapshot_spends' in row()).toBe(false)
  })

  it('includes rpc_post_snapshot_spends when the RPC returned it', () => {
    expect(row({ rpcPostSnapshotSpends: 2 }).rpc_post_snapshot_spends).toBe(2)
  })

  it('includes rpc_post_snapshot_spends as null when present but unread for this member', () => {
    const r = row({ rpcPostSnapshotSpends: null })
    expect('rpc_post_snapshot_spends' in r).toBe(true)
    expect(r.rpc_post_snapshot_spends).toBeNull()
  })

  it('carries bomb readings when present', () => {
    const r = row({
      liveBombs: {
        current: 1,
        max: 1,
        nextTokenInSeconds: 7200,
        regenDelayInSeconds: 64800
      }
    })
    expect(r.live_bombs).toBe(1)
    expect(r.live_bomb_next_seconds).toBe(7200)
    expect(r.live_bomb_regen_delay_seconds).toBe(64800)
  })
})
