import { rejects, strictEqual } from 'node:assert'
import { ProviderAdmissionError } from './provider-admission.ts'
import { edgeProviderFetch } from './provider-fetch.ts'
import {
  resetOutboundKillSwitchCache,
  useOutboundKillSwitchReader
} from './outbound-kill-switch.ts'

// Switch semantics, caching and fail-open behaviour are covered by
// outbound-kill-switch-core_test.ts. This file proves the edge adapter obeys it.
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
      useOutboundKillSwitchReader(() => Promise.resolve('halted'))
      resetOutboundKillSwitchCache()

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
      useOutboundKillSwitchReader(null)
    }
  }
)
