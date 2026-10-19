import { strictEqual } from 'node:assert'
import {
  createOutboundKillSwitch,
  isOutboundHaltedStage
} from './outbound-kill-switch-core.ts'

function collector(): {
  warn: (message: string, error: unknown) => void
  seen: unknown[][]
} {
  const seen: unknown[][] = []
  return {
    seen,
    warn: (message, error) => {
      seen.push([message, error])
    }
  }
}

Deno.test('a recorded non-public stage halts outbound dispatch', () => {
  strictEqual(isOutboundHaltedStage('coming_soon'), true)
  strictEqual(isOutboundHaltedStage('halted'), true)
})

Deno.test('public and absent stages leave dispatch open', () => {
  strictEqual(isOutboundHaltedStage('public'), false)
  strictEqual(isOutboundHaltedStage(undefined), false)
  strictEqual(isOutboundHaltedStage(null), false)
  strictEqual(isOutboundHaltedStage(''), false)
})

Deno.test('an unreadable switch resolves open and says so', async () => {
  const log = collector()
  const outbound = createOutboundKillSwitch(
    () => Promise.reject(new Error('db unavailable')),
    log.warn
  )
  strictEqual(await outbound.halted(), false)
  strictEqual(log.seen.length, 1, 'a fail-open switch must be loud')
})

Deno.test(
  'the switch is cached for the poll window, then re-read',
  async () => {
    let reads = 0
    const outbound = createOutboundKillSwitch(() => {
      reads += 1
      return Promise.resolve('coming_soon')
    }, collector().warn)

    strictEqual(await outbound.halted(1_000), true)
    strictEqual(await outbound.halted(2_000), true)
    strictEqual(reads, 1, 'a call inside the window must not re-read')

    strictEqual(await outbound.halted(31_001), true)
    strictEqual(reads, 2, 'a call past the window must re-read')
  }
)

Deno.test('an operator clearing the flag reopens dispatch', async () => {
  let stage: unknown = 'coming_soon'
  const outbound = createOutboundKillSwitch(
    () => Promise.resolve(stage),
    collector().warn
  )

  strictEqual(await outbound.halted(1_000), true)
  stage = 'public'
  strictEqual(await outbound.halted(31_001), false)
})

Deno.test('reset forces the next call to re-read the flag', async () => {
  let reads = 0
  const outbound = createOutboundKillSwitch(() => {
    reads += 1
    return Promise.resolve('public')
  }, collector().warn)

  strictEqual(await outbound.halted(1_000), false)
  outbound.reset()
  strictEqual(await outbound.halted(1_001), false)
  strictEqual(reads, 2)
})

Deno.test('an absent row resolves open and says so', async () => {
  const log = collector()
  const outbound = createOutboundKillSwitch(
    () => Promise.resolve(undefined),
    log.warn
  )
  strictEqual(await outbound.halted(), false)
  strictEqual(log.seen.length, 1, 'a missing switch row must be loud')
})

Deno.test(
  'a read that never settles is abandoned and aborted, resolving open',
  async () => {
    const log = collector()
    let aborted = false
    const outbound = createOutboundKillSwitch(
      (signal) =>
        new Promise(() => {
          signal.addEventListener('abort', () => {
            aborted = true
          })
        }),
      log.warn,
      { timeoutMs: 20 }
    )

    strictEqual(await outbound.halted(), false)
    strictEqual(aborted, true, 'the stalled query must be cancelled')
    strictEqual(log.seen.length, 1)
  }
)

Deno.test('a stalled refresh keeps an earlier halt in force', async () => {
  const log = collector()
  let stalled = false
  const outbound = createOutboundKillSwitch(
    () => (stalled ? new Promise(() => {}) : Promise.resolve('coming_soon')),
    log.warn,
    { timeoutMs: 20 }
  )

  strictEqual(await outbound.halted(1_000), true)
  stalled = true
  strictEqual(
    await outbound.halted(40_000),
    true,
    'database trouble must not lift a stop an operator engaged'
  )
  strictEqual(log.seen.length, 1)
})

Deno.test('a failed refresh keeps an earlier open state open', async () => {
  let failing = false
  const outbound = createOutboundKillSwitch(
    () =>
      failing ? Promise.reject(new Error('down')) : Promise.resolve('public'),
    collector().warn
  )

  strictEqual(await outbound.halted(1_000), false)
  failing = true
  strictEqual(await outbound.halted(40_000), false)
})

Deno.test('concurrent callers share one in-flight read', async () => {
  let reads = 0
  let release: (stage: unknown) => void = () => {}
  const outbound = createOutboundKillSwitch(() => {
    reads += 1
    return new Promise((resolve) => {
      release = resolve
    })
  }, collector().warn)

  const callers = Array.from({ length: 5 }, () => outbound.halted(1_000))
  strictEqual(reads, 1, 'a burst must trigger exactly one database read')
  release('coming_soon')
  const results = await Promise.all(callers)
  strictEqual(
    results.every((halted) => halted === true),
    true
  )
  strictEqual(reads, 1)
})

Deno.test(
  'an expired window triggers one shared refresh, not one per caller',
  async () => {
    let reads = 0
    const outbound = createOutboundKillSwitch(() => {
      reads += 1
      return Promise.resolve('public')
    }, collector().warn)

    await outbound.halted(1_000)
    await Promise.all(Array.from({ length: 4 }, () => outbound.halted(40_000)))
    strictEqual(reads, 2)
  }
)

Deno.test('a failed shared read does not wedge later refreshes', async () => {
  let attempts = 0
  const outbound = createOutboundKillSwitch(() => {
    attempts += 1
    return attempts === 1
      ? Promise.reject(new Error('transient'))
      : Promise.resolve('coming_soon')
  }, collector().warn)

  strictEqual(await outbound.halted(1_000), false)
  strictEqual(await outbound.halted(40_000), true)
})
