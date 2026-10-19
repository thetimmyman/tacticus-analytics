import { rejects, strictEqual } from 'node:assert'
import { ProviderAdmissionError } from './provider-admission.ts'
import { edgeProviderFetch } from './provider-fetch.ts'
import {
  isOutboundHaltedStage,
  outboundHalted,
  resetOutboundKillSwitchCache
} from './outbound-kill-switch.ts'

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
  resetOutboundKillSwitchCache()
  const warnings: unknown[][] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args)
  try {
    const halted = await outboundHalted(Date.now(), () =>
      Promise.reject(new Error('db unavailable'))
    )
    strictEqual(halted, false)
    strictEqual(warnings.length, 1)
  } finally {
    console.warn = original
    resetOutboundKillSwitchCache()
  }
})

Deno.test(
  'the switch is cached for the poll window, then re-read',
  async () => {
    resetOutboundKillSwitchCache()
    let reads = 0
    const read = () => {
      reads += 1
      return Promise.resolve('coming_soon')
    }

    strictEqual(await outboundHalted(1_000, read), true)
    strictEqual(await outboundHalted(2_000, read), true)
    strictEqual(reads, 1, 'second call inside the window must not re-read')

    strictEqual(await outboundHalted(31_001, read), true)
    strictEqual(reads, 2, 'a call past the window must re-read')
    resetOutboundKillSwitchCache()
  }
)

Deno.test('an operator clearing the flag reopens dispatch', async () => {
  resetOutboundKillSwitchCache()
  let stage: unknown = 'coming_soon'
  const read = () => Promise.resolve(stage)

  strictEqual(await outboundHalted(1_000, read), true)
  stage = 'public'
  strictEqual(await outboundHalted(31_001, read), false)
  resetOutboundKillSwitchCache()
})

Deno.test(
  'a halted switch refuses the dispatch before the provider is reached',
  async () => {
    const names = [
      'PROVIDER_ADMISSION_MODE',
      'PROVIDER_ADMISSION_ORIGIN',
      'PROVIDER_ADMISSION_TOKEN',
      'PROVIDER_ACCOUNT_LABEL_KEY'
    ]
    const previous = names.map((name) => Deno.env.get(name))
    const original = globalThis.fetch
    const requested: string[] = []
    try {
      ;[
        'enforce',
        'http://authority.example.invalid',
        'synthetic-token',
        'K'.repeat(32)
      ].forEach((value, i) => Deno.env.set(names[i], value))
      globalThis.fetch = (input) => {
        const raw = input instanceof Request ? input.url : String(input)
        requested.push(new URL(raw).hostname)
        return Promise.resolve(Response.json({ status: 'denied' }))
      }

      const providerUrl = 'https://api.tacticusgame.com/api/v1/guild'
      const providerHost = new URL(providerUrl).hostname

      resetOutboundKillSwitchCache()
      strictEqual(
        await outboundHalted(Date.now(), () => Promise.resolve('halted')),
        true,
        'the cache must be primed halted for this test to mean anything'
      )

      await rejects(
        () =>
          edgeProviderFetch(
            providerUrl,
            { headers: { 'x-api-key': 'synthetic-key' } },
            { purpose: 'guild-sync', trigger: 'scheduled', timeoutMs: 5000 }
          ),
        ProviderAdmissionError
      )
      strictEqual(
        requested.filter((host) => host === providerHost).length,
        0,
        'no provider request may leave this runtime while the switch is halted'
      )
    } finally {
      globalThis.fetch = original
      names.forEach((name, i) => {
        const before = previous[i]
        if (before === undefined) Deno.env.delete(name)
        else Deno.env.set(name, before)
      })
      resetOutboundKillSwitchCache()
    }
  }
)
