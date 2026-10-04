import { describe, it, expect, vi } from 'vitest'
import {
  fingerprintDiff,
  isDuplicateGlobalConfigAlert,
  recordGlobalConfigAlert
} from './alert-dedup'
import type { ConfigDiff } from './global-config-diff'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

function diffOf(overrides: Partial<ConfigDiff> = {}): Pick<
  ConfigDiff,
  'oldVersion' | 'newVersion' | 'lines'
> {
  return {
    oldVersion: 'a30dbdb2',
    newVersion: 'a90d9ece',
    lines: ['NEW season config: foo'],
    ...overrides
  }
}

/** Builds a fake Supabase client whose `.from(table)` returns the given table stub. */
function fakeSupabase(table: unknown): TypedSupabaseClient {
  return { from: vi.fn(() => table) } as unknown as TypedSupabaseClient
}

describe('fingerprintDiff', () => {
  it('is stable for the same transition and content', () => {
    const a = fingerprintDiff(diffOf())
    const b = fingerprintDiff(diffOf())
    expect(a).toBe(b)
  })

  it('changes when the diff lines change under the same version pair', () => {
    const a = fingerprintDiff(diffOf())
    const b = fingerprintDiff(diffOf({ lines: ['NEW season config: bar'] }))
    expect(a).not.toBe(b)
  })

  it('changes when the version pair changes under the same lines', () => {
    const a = fingerprintDiff(diffOf())
    const b = fingerprintDiff(diffOf({ newVersion: 'ffffffff' }))
    expect(a).not.toBe(b)
  })

  it('never includes a timestamp-shaped field (deterministic across calls)', () => {
    // Regression guard for the extractedAt bug: the fingerprint must depend
    // only on (oldVersion, newVersion, lines), never on "now".
    const calls = Array.from({ length: 5 }, () => fingerprintDiff(diffOf()))
    expect(new Set(calls).size).toBe(1)
  })
})

describe('isDuplicateGlobalConfigAlert', () => {
  it('returns duplicate=true when the stored fingerprint matches', async () => {
    const diff = diffOf()
    const fingerprint = fingerprintDiff(diff)
    const table = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: true,
              old_version: diff.oldVersion,
              new_version: diff.newVersion,
              content_fingerprint: fingerprint,
              alerted_at: '2026-10-04T00:00:00.000Z'
            },
            error: null
          })
        })
      })
    }

    const result = await isDuplicateGlobalConfigAlert(fakeSupabase(table), diff)
    expect(result.duplicate).toBe(true)
    expect(result.fingerprint).toBe(fingerprint)
  })

  it('returns duplicate=false when no row is stored yet', async () => {
    const table = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
        })
      })
    }

    const result = await isDuplicateGlobalConfigAlert(
      fakeSupabase(table),
      diffOf()
    )
    expect(result.duplicate).toBe(false)
  })

  it('returns duplicate=false when the stored fingerprint differs (new drift)', async () => {
    const table = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: true,
              old_version: 'old',
              new_version: 'old2',
              content_fingerprint: 'stale-fingerprint',
              alerted_at: '2026-10-03T00:00:00.000Z'
            },
            error: null
          })
        })
      })
    }

    const result = await isDuplicateGlobalConfigAlert(
      fakeSupabase(table),
      diffOf()
    )
    expect(result.duplicate).toBe(false)
  })

  it('fails open (duplicate=false) when the read errors', async () => {
    const table = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: null, error: { message: 'boom' } })
        })
      })
    }

    const result = await isDuplicateGlobalConfigAlert(
      fakeSupabase(table),
      diffOf()
    )
    expect(result.duplicate).toBe(false)
  })
})

describe('recordGlobalConfigAlert', () => {
  it('upserts the singleton row keyed on id', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const table = { upsert }
    const diff = diffOf()
    const fingerprint = fingerprintDiff(diff)

    await recordGlobalConfigAlert(fakeSupabase(table), diff, fingerprint)

    expect(upsert).toHaveBeenCalledTimes(1)
    const [row, options] = upsert.mock.calls[0]
    expect(row).toMatchObject({
      id: true,
      old_version: diff.oldVersion,
      new_version: diff.newVersion,
      content_fingerprint: fingerprint
    })
    expect(options).toEqual({ onConflict: 'id' })
  })

  it('never throws when the write fails (best-effort)', async () => {
    const table = {
      upsert: vi.fn().mockRejectedValue(new Error('write failed'))
    }

    await expect(
      recordGlobalConfigAlert(fakeSupabase(table), diffOf(), 'fp')
    ).resolves.toBeUndefined()
  })
})
