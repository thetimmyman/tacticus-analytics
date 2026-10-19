import { rejects, strictEqual } from 'node:assert'
import { ProviderAdmissionError } from './provider-admission.ts'
import { edgeProviderFetch } from './provider-fetch.ts'
import {
  resetOutboundKillSwitchCache,
  useOutboundKillSwitchReader
} from './outbound-kill-switch.ts'

// Switch semantics, caching, timeout and fail-open behaviour are covered by
// outbound-kill-switch-core_test.ts. This file proves the edge adapter obeys it.
// Admission runs in its default off mode so no other control can refuse the
// dispatch: the switch is the only thing that differs between the two tests.
const providerUrl = 'https://api.tacticusgame.com/api/v1/guild'
const providerHost = new URL(providerUrl).hostname
const admissionNames = [
  'PROVIDER_ADMISSION_MODE',
  'PROVIDER_ADMISSION_ORIGIN',
  'PROVIDER_ADMISSION_TOKEN',
  'PROVIDER_ACCOUNT_LABEL_KEY'
]

async function withSwitchedProvider(
  stage: string,
  run: (requested: string[]) => Promise<void>
): Promise<void> {
  const previous = admissionNames.map((name) => Deno.env.get(name))
  const original = globalThis.fetch
  const requested: string[] = []
  try {
    admissionNames.forEach((name) => Deno.env.delete(name))
    globalThis.fetch = (input) => {
      const raw = input instanceof Request ? input.url : String(input)
      requested.push(new URL(raw).hostname)
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    useOutboundKillSwitchReader(() => Promise.resolve(stage))
    resetOutboundKillSwitchCache()
    await run(requested)
  } finally {
    globalThis.fetch = original
    admissionNames.forEach((name, i) => {
      const before = previous[i]
      if (before === undefined) Deno.env.delete(name)
      else Deno.env.set(name, before)
    })
    useOutboundKillSwitchReader(null)
  }
}

function dispatch(): Promise<Response> {
  return edgeProviderFetch(
    providerUrl,
    { headers: { 'x-api-key': 'synthetic-key' } },
    { purpose: 'guild-sync', trigger: 'scheduled', timeoutMs: 5000 }
  )
}

Deno.test(
  'a halted switch refuses the dispatch before the provider is reached',
  async () => {
    await withSwitchedProvider('coming_soon', async (requested) => {
      await rejects(dispatch, ProviderAdmissionError)
      strictEqual(
        requested.filter((host) => host === providerHost).length,
        0,
        'no provider request may leave this runtime while the switch is halted'
      )
    })
  }
)

Deno.test(
  'an open switch lets the same dispatch reach the provider',
  async () => {
    await withSwitchedProvider('public', async (requested) => {
      const response = await dispatch()
      strictEqual(response.status, 204)
      strictEqual(
        requested.filter((host) => host === providerHost).length,
        1,
        'the only difference from the halted case is the switch'
      )
    })
  }
)
