import { expect, it, vi } from 'vitest'
import {
  selectRosterRefreshCandidates,
  tryBeginPlayerRosterRefresh,
  readRosterVerificationSummary
} from '@/app/lib/player/roster-snapshot-store'

function client(data: unknown, error: unknown = null) {
  return { rpc: vi.fn(() => ({ abortSignal: async () => ({ data, error }) })) }
}

it('retains database fairness order within the authorized candidate cohort', async () => {
  const db = client([2, 1])
  const rows = [
    { id: 1, label: 'synthetic-first' },
    { id: 2, label: 'synthetic-second' },
    { id: 3, label: 'synthetic-fresh' }
  ]
  expect(
    await selectRosterRefreshCandidates(
      rows,
      { freshMs: 1200000, retryMs: 300000 },
      db as never
    )
  ).toEqual([rows[1], rows[0]])
  expect(db.rpc).toHaveBeenCalledWith('get_player_roster_refresh_candidates', {
    p_mapping_ids: [1, 2, 3],
    p_fresh_seconds: 1200,
    p_retry_seconds: 300,
    p_require_enabled_guild: true
  })
})

it.each([
  [[99], null],
  [[1, 1], null],
  [null, null],
  [[{ id: 1 }], null],
  [
    [1],
    {
      message: 'synthetic-private-sdk-body',
      details: 'synthetic-private-account'
    }
  ]
])(
  'refuses malformed, foreign or unavailable selection without exposing SDK content',
  async (data, error) => {
    const db = client(data, error)
    await expect(
      selectRosterRefreshCandidates(
        [{ id: 1 }],
        { freshMs: 1200000, retryMs: 300000 },
        db as never
      )
    ).rejects.toEqual(new Error('Roster snapshot storage unavailable'))
  }
)

it('does no metadata work for an empty cohort', async () => {
  const db = client([])
  expect(
    await selectRosterRefreshCandidates(
      [],
      { freshMs: 1200000, retryMs: 300000 },
      db as never
    )
  ).toEqual([])
  expect(db.rpc).not.toHaveBeenCalled()
})

it('treats a raced background selection as a coalesced read', async () => {
  const db = client(null)
  expect(
    await tryBeginPlayerRosterRefresh(
      null,
      1,
      { freshMs: 1200000, retryMs: 300000 },
      db as never
    )
  ).toBeNull()
})
it('returns private verification coverage without account identities', async () => {
  const db = client({
    total: 2,
    verified: 1,
    fresh: 1,
    oldestVerifiedAt: '2026-01-01T00:00:00.000Z'
  })
  expect(
    await readRosterVerificationSummary([1, 2], 21600000, db as never)
  ).toEqual({
    total: 2,
    verified: 1,
    fresh: 1,
    oldestVerifiedAt: '2026-01-01T00:00:00.000Z'
  })
})
it('rejects inconsistent or identity-bearing verification metadata', async () => {
  for (const data of [
    { total: 1, verified: 2, fresh: 1, oldestVerifiedAt: null },
    {
      total: 1,
      verified: 0,
      fresh: 0,
      oldestVerifiedAt: null,
      owner: 'synthetic-private-account'
    }
  ]) {
    await expect(
      readRosterVerificationSummary([1], 21600000, client(data) as never)
    ).rejects.toEqual(new Error('Roster snapshot storage unavailable'))
  }
})
