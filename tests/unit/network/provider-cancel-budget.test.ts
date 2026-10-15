import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController()
    setTimeout(
      () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
      milliseconds
    )
    return controller.signal
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each(
  (['worker', 'guild-raid', 'player'] as const).flatMap((caller) =>
    (['pending', 'rejected'] as const).map((cancellationOutcome) => ({
      caller,
      cancellationOutcome
    }))
  )
)(
  '$caller retries a 503 despite $cancellationOutcome error-body cancellation',
  async ({ caller, cancellationOutcome }) => {
    let finishCancellation!: () => void
    const cancellation = new Promise<void>((resolve) => {
      finishCancellation = resolve
    })
    const cancel = vi.fn(() =>
      cancellationOutcome === 'pending'
        ? cancellation
        : Promise.reject(new Error('Synthetic cleanup failure'))
    )
    const rejected = new Response(new ReadableStream({ cancel }), {
      status: 503
    })
    const player = { details: { name: 'Synthetic', powerLevel: 1 } }
    const abortedAtDispatch: boolean[] = []
    const wire = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal
        if (!signal) throw new Error('Expected a timed provider request')
        abortedAtDispatch.push(signal.aborted)
        signal.throwIfAborted()
        return abortedAtDispatch.length === 1
          ? rejected
          : Response.json({ player })
      }
    )
    vi.stubGlobal('fetch', wire)

    let operation: Promise<number | null>
    if (caller === 'worker') {
      const { fetchTacticusApi } =
        await import('@/app/lib/sync/tacticus-api-client')
      operation = fetchTacticusApi('/guild', 'synthetic-key', 'SYNTHETIC').then(
        (response) => response.status
      )
    } else if (caller === 'guild-raid') {
      const { fetchGuildRaidData } = await import('@/app/lib/sync/tacticus-api')
      operation = fetchGuildRaidData('synthetic-key', 'SYNTHETIC').then(
        (response) => response.status
      )
    } else {
      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      operation = new TacticusAPIClient()
        .getPlayerWithRetry('synthetic-key', { timeoutMs: 100, maxRetries: 1 })
        .then((result) => (result ? 200 : null))
    }

    let settled = false
    let outcome: number | null | string = 'pending'
    const observed = operation.then(
      (result) => {
        settled = true
        outcome = result
      },
      (error: unknown) => {
        settled = true
        outcome = error instanceof Error ? error.name : 'error'
      }
    )
    try {
      const elapsedMs = caller === 'player' ? 2_000 : 120_000
      await vi.advanceTimersByTimeAsync(elapsedMs)
      expect(wire).toHaveBeenCalledTimes(2)
      expect(abortedAtDispatch).toEqual([false, false])
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(settled).toBe(true)
      expect(outcome).toBe(200)
    } finally {
      finishCancellation()
      await vi.advanceTimersByTimeAsync(10_000)
      await observed
    }
  }
)
