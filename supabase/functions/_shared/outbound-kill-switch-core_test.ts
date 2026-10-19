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
