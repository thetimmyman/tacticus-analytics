/** `Promise.allSettled(items.map(mapper))` with a sliding concurrency window. Pinned by
 * config/upstream-call-inventory.json for official-API member fan-outs. */
export async function settledMapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  if (items.length === 0) return []
  // Non-finite concurrency would spawn zero workers; clamp to serial.
  const limit = Number.isFinite(concurrency)
    ? Math.max(1, Math.floor(concurrency))
    : 1
  const results = new Array<PromiseSettledResult<R>>(items.length)
  // `next()` is synchronous and workers interleave only at `await`, so no double claims.
  const queue = items.entries()

  async function worker(): Promise<void> {
    for (;;) {
      const next = queue.next()
      if (next.done) return
      const [index, item] = next.value
      try {
        results[index] = {
          status: 'fulfilled',
          value: await mapper(item, index)
        }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  )
  return results
}
