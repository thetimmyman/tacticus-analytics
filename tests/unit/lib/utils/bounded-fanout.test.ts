import { describe, expect, it } from 'vitest'

import { settledMapWithConcurrency } from '@/app/lib/utils/bounded-fanout'

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('settledMapWithConcurrency', () => {
  it('never exceeds the concurrency ceiling', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 23 }, (_, i) => i)

    await settledMapWithConcurrency(items, 4, async (item) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await tick()
      await tick()
      inFlight -= 1
      return item
    })

    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1) // it actually ran concurrently
  })

  it('preserves input order in the results array', async () => {
    const items = [5, 1, 4, 2, 3]
    const results = await settledMapWithConcurrency(items, 2, async (item) => {
      // Finish in reverse-ish order to prove ordering is positional.
      await new Promise((resolve) => setTimeout(resolve, item))
      return item * 10
    })
    expect(
      results.map((r) => (r.status === 'fulfilled' ? r.value : null))
    ).toEqual([50, 10, 40, 20, 30])
  })

  it('captures rejections as settled results without failing the batch', async () => {
    const results = await settledMapWithConcurrency(
      [1, 2, 3],
      2,
      async (item) => {
        if (item === 2) throw new Error('boom')
        return item
      }
    )
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 })
    expect(results[1].status).toBe('rejected')
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 })
  })

  it('handles empty input and concurrency larger than the input', async () => {
    expect(await settledMapWithConcurrency([], 4, async (x) => x)).toEqual([])
    const results = await settledMapWithConcurrency([1, 2], 16, async (x) => x)
    expect(results).toHaveLength(2)
  })

  it('clamps a non-finite concurrency to serial execution instead of zero workers', async () => {
    const results = await settledMapWithConcurrency(
      [1, 2, 3],
      Number.NaN,
      async (x) => x
    )
    expect(
      results.map((r) => (r.status === 'fulfilled' ? r.value : null))
    ).toEqual([1, 2, 3])
  })

  it('clamps a non-positive concurrency to serial execution', async () => {
    let inFlight = 0
    let peak = 0
    const results = await settledMapWithConcurrency(
      [1, 2, 3],
      0,
      async (item) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await tick()
        inFlight -= 1
        return item
      }
    )
    expect(peak).toBe(1)
    expect(results).toHaveLength(3)
  })

  it('passes the item index to the mapper', async () => {
    const seen: number[] = []
    await settledMapWithConcurrency(
      ['a', 'b', 'c'],
      2,
      async (_item, index) => {
        seen.push(index)
      }
    )
    expect([...seen].sort()).toEqual([0, 1, 2])
  })
})
