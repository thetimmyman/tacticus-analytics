import { describe, it, expect, vi } from 'vitest'
import {
  CLAIM_STALE_MS,
  claimGlobalConfigAlert,
  clearGlobalConfigAlertState,
  fingerprintDiff,
  markGlobalConfigAlertDelivered,
  releaseGlobalConfigAlert
} from './alert-dedup'
import type { ConfigDiff } from './global-config-diff'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

function diffOf(
  overrides: Partial<ConfigDiff> = {}
): Pick<ConfigDiff, 'oldVersion' | 'newVersion' | 'lines'> {
  return {
    oldVersion: 'a30dbdb2',
    newVersion: 'a90d9ece',
    lines: ['NEW season config: foo'],
    ...overrides
  }
}

type Call = [method: string, args: unknown[]]
type QueryResult = {
  data?: unknown
  error?: { message: string } | null
  throws?: boolean
}

/**
 * Fake Supabase client. Each `.from()` starts one query whose builder calls
 * are recorded in `queries`; awaiting it resolves to the next queued result.
 */
function fakeDb(results: QueryResult[]) {
  const queries: Call[][] = []
  const from = vi.fn(() => {
    const calls: Call[] = []
    queries.push(calls)
    const result = results.shift() ?? {}
    const builder: Record<string, unknown> = {}
    for (const method of [
      'upsert',
      'update',
      'select',
      'eq',
      'neq',
      'or',
      'is'
    ]) {
      builder[method] = (...args: unknown[]) => {
        calls.push([method, args])
        return builder
      }
    }
    builder.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown
    ) =>
      (result.throws
        ? Promise.reject(new Error('network down'))
        : Promise.resolve({
            data: result.data ?? null,
            error: result.error ?? null
          })
      ).then(resolve, reject)
    return builder
  })
  return { db: { from } as unknown as TypedSupabaseClient, queries }
}

function argsOf(calls: Call[] | undefined, method: string): unknown[] {
  const call = calls?.find(([m]) => m === method)
  if (!call) throw new Error(`no ${method}() call`)
  return call[1]
}

const NOW = new Date('2026-01-15T12:00:00.000Z')

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

describe('claimGlobalConfigAlert', () => {
  it('claims the first transition ever with an insert that ignores conflicts', async () => {
    const { db, queries } = fakeDb([{ data: [{ id: true }] }])
    const result = await claimGlobalConfigAlert(db, diffOf(), NOW)

    expect(result).toEqual({
      claimed: true,
      fingerprint: fingerprintDiff(diffOf())
    })
    expect(queries).toHaveLength(1)
    const [row, options] = argsOf(queries[0], 'upsert')
    expect(row).toMatchObject({
      id: true,
      content_fingerprint: result.fingerprint,
      alerted_at: NOW.toISOString(),
      delivered_at: null
    })
    expect(options).toEqual({ onConflict: 'id', ignoreDuplicates: true })
  })

  it('takes over the row when it holds a different transition or a stale undelivered claim', async () => {
    const { db, queries } = fakeDb([{ data: [] }, { data: [{ id: true }] }])
    const result = await claimGlobalConfigAlert(db, diffOf(), NOW)

    expect(result.claimed).toBe(true)
    expect(queries).toHaveLength(2)
    const staleBefore = new Date(NOW.getTime() - CLAIM_STALE_MS).toISOString()
    expect(argsOf(queries[1], 'or')).toEqual([
      `content_fingerprint.neq.${result.fingerprint},and(delivered_at.is.null,alerted_at.lt."${staleBefore}")`
    ])
    expect(argsOf(queries[1], 'update')[0]).toMatchObject({
      content_fingerprint: result.fingerprint,
      delivered_at: null
    })
  })

  it('skips when the same transition is already delivered or being posted', async () => {
    const { db } = fakeDb([{ data: [] }, { data: [] }])
    const result = await claimGlobalConfigAlert(db, diffOf(), NOW)
    expect(result.claimed).toBe(false)
  })

  it('degrades to claimed (post anyway) when the state is unavailable', async () => {
    const cases: QueryResult[][] = [
      [{ error: { message: 'relation does not exist' } }],
      [{ data: [] }, { error: { message: 'permission denied' } }],
      [{ throws: true }]
    ]
    for (const results of cases) {
      const { db } = fakeDb(results)
      expect((await claimGlobalConfigAlert(db, diffOf(), NOW)).claimed).toBe(
        true
      )
    }
    expect((await claimGlobalConfigAlert(null, diffOf(), NOW)).claimed).toBe(
      true
    )
  })
})

describe('markGlobalConfigAlertDelivered', () => {
  it('stamps delivered_at only on the row this caller claimed', async () => {
    const { db, queries } = fakeDb([{}])
    await markGlobalConfigAlertDelivered(db, 'fp-1', NOW)

    expect(argsOf(queries[0], 'update')).toEqual([
      { delivered_at: NOW.toISOString() }
    ])
    expect(queries[0]).toContainEqual(['eq', ['content_fingerprint', 'fp-1']])
  })

  it('never throws', async () => {
    const { db } = fakeDb([{ throws: true }])
    await expect(
      markGlobalConfigAlertDelivered(db, 'fp-1')
    ).resolves.toBeUndefined()
    await expect(
      markGlobalConfigAlertDelivered(null, 'fp-1')
    ).resolves.toBeUndefined()
  })
})

describe('releaseGlobalConfigAlert', () => {
  it('gives back only an undelivered claim on this transition', async () => {
    const { db, queries } = fakeDb([{}])
    await releaseGlobalConfigAlert(db, 'fp-1')

    expect(argsOf(queries[0], 'update')).toEqual([
      { content_fingerprint: '', delivered_at: null }
    ])
    expect(queries[0]).toContainEqual(['eq', ['content_fingerprint', 'fp-1']])
    expect(queries[0]).toContainEqual(['is', ['delivered_at', null]])
  })

  it('never throws', async () => {
    const { db } = fakeDb([{ throws: true }])
    await expect(releaseGlobalConfigAlert(db, 'fp-1')).resolves.toBeUndefined()
  })
})

describe('clearGlobalConfigAlertState', () => {
  it('forgets the last transition so a recurrence alerts again', async () => {
    const { db, queries } = fakeDb([{}])
    await clearGlobalConfigAlertState(db)

    expect(argsOf(queries[0], 'update')[0]).toMatchObject({
      content_fingerprint: '',
      delivered_at: null
    })
    expect(queries[0]).toContainEqual(['neq', ['content_fingerprint', '']])
  })

  it('never throws and is a no-op without a client', async () => {
    const { db } = fakeDb([{ throws: true }])
    await expect(clearGlobalConfigAlertState(db)).resolves.toBeUndefined()
    await expect(clearGlobalConfigAlertState(null)).resolves.toBeUndefined()
  })
})
