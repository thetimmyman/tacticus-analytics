import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ProviderAdmissionError } from '@/supabase/functions/_shared/provider-admission'
import {
  captureProviderMetrics,
  providerFetch
} from '@/app/lib/network/provider-metrics'
import { useOutboundKillSwitchReader } from '@/app/lib/network/outbound-kill-switch'

const originalFetch = globalThis.fetch
const url = 'https://api.tacticusgame.com/api/v1/player'

beforeEach(() => {
  // Admission unset means pass-through, so the switch is the only variable.
  delete process.env.PROVIDER_ADMISSION_MODE
})

afterEach(() => {
  vi.useRealTimers()
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

function countingFetch(): { calls: () => number } {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return new Response(null, { status: 204 })
  }) as typeof fetch
  return { calls: () => calls }
}

it('treats a missing switch row as open', async () => {
  useOutboundKillSwitchReader(async () => undefined)
  const sent = countingFetch()

  const response = await providerFetch(url, {})

  expect(response.status).toBe(204)
  expect(sent.calls()).toBe(1)
})

it('reads the switch once for a burst of concurrent dispatches', async () => {
  let reads = 0
  useOutboundKillSwitchReader(async () => {
    reads += 1
    return 'public'
  })
  const sent = countingFetch()

  await Promise.all(Array.from({ length: 5 }, () => providerFetch(url, {})))

  expect(reads).toBe(1)
  expect(sent.calls()).toBe(5)
})

it('abandons a stalled read and dispatches, aborting the query', async () => {
  vi.useFakeTimers()
  let aborted = false
  useOutboundKillSwitchReader(
    (signal) =>
      new Promise(() => {
        signal.addEventListener('abort', () => {
          aborted = true
        })
      })
  )
  const sent = countingFetch()

  const pending = providerFetch(url, {})
  await vi.advanceTimersByTimeAsync(2_000)
  const response = await pending

  expect(aborted).toBe(true)
  expect(response.status).toBe(204)
  expect(sent.calls()).toBe(1)
})

it('keeps a halt in force when a later refresh stalls', async () => {
  vi.useFakeTimers()
  let stall = false
  useOutboundKillSwitchReader((signal) =>
    stall
      ? new Promise(() => {
          signal.addEventListener('abort', () => {})
        })
      : Promise.resolve('coming_soon')
  )
  const sent = countingFetch()

  await expect(providerFetch(url, {})).rejects.toBeInstanceOf(
    ProviderAdmissionError
  )
  stall = true
  await vi.advanceTimersByTimeAsync(31_000)
  const refused = expect(providerFetch(url, {})).rejects.toBeInstanceOf(
    ProviderAdmissionError
  )
  await vi.advanceTimersByTimeAsync(2_000)
  await refused

  expect(sent.calls()).toBe(0)
})

it('does not count or send a dispatch cancelled while the switch is read', async () => {
  vi.useFakeTimers()
  useOutboundKillSwitchReader(
    (signal) =>
      new Promise(() => {
        signal.addEventListener('abort', () => {})
      })
  )
  const sent = countingFetch()
  const controller = new AbortController()

  let thrown: unknown
  const run = captureProviderMetrics(async () => {
    try {
      await providerFetch(url, { signal: controller.signal })
    } catch (error) {
      thrown = error
    }
  })
  controller.abort()
  await vi.advanceTimersByTimeAsync(2_000)
  const { metrics } = await run

  expect(thrown).toMatchObject({ name: 'AbortError' })
  expect(metrics.api_calls).toBe(0)
  expect(sent.calls()).toBe(0)
})
