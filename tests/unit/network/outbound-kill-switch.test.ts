import { afterEach, beforeEach, expect, it } from 'vitest'
import { ProviderAdmissionError } from '@/supabase/functions/_shared/provider-admission'
import { providerFetch } from '@/app/lib/network/provider-metrics'
import { useOutboundKillSwitchReader } from '@/app/lib/network/outbound-kill-switch'

const originalFetch = globalThis.fetch
const url = 'https://api.tacticusgame.com/api/v1/player'

beforeEach(() => {
  // Admission unset means pass-through, so the switch is the only variable.
  delete process.env.PROVIDER_ADMISSION_MODE
})

afterEach(() => {
  globalThis.fetch = originalFetch
  useOutboundKillSwitchReader(null)
})

it('refuses a provider dispatch while the switch is halted', async () => {
  useOutboundKillSwitchReader(async () => 'halted')
  const called: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    called.push(
      new URL(input instanceof Request ? input.url : String(input)).hostname
    )
    return new Response(null, { status: 204 })
  }) as typeof fetch

  await expect(providerFetch(url, {})).rejects.toBeInstanceOf(
    ProviderAdmissionError
  )
  expect(called).toEqual([])
})

it('lets the dispatch through when the flag is public', async () => {
  useOutboundKillSwitchReader(async () => 'public')
  let called = 0
  globalThis.fetch = (async () => {
    called += 1
    return new Response(null, { status: 204 })
  }) as typeof fetch

  const response = await providerFetch(url, {})
  expect(called).toBe(1)
  expect(response.status).toBe(204)
})
