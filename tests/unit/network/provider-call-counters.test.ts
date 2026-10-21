import { afterEach, expect, it } from 'vitest'
import { register } from '@/app/lib/metrics/registry'
import {
  captureProviderMetrics,
  providerFetch
} from '@/app/lib/network/provider-metrics'
import { useOutboundKillSwitchReader } from '@/app/lib/network/outbound-kill-switch'

const originalFetch = globalThis.fetch
const url = 'https://api.tacticusgame.com/api/v1/player'

afterEach(() => {
  globalThis.fetch = originalFetch
  useOutboundKillSwitchReader(null)
  delete process.env.PROVIDER_ADMISSION_MODE
})

async function sample(
  name: string,
  labels: Record<string, string>
): Promise<number> {
  const metric = register.getSingleMetric(name)
  if (!metric) return 0
  const json = await metric.get()
  return (
    json.values.find((value) =>
      Object.entries(labels).every(([key, want]) => value.labels[key] === want)
    )?.value ?? 0
  )
}

const labels = {
  domain: 'official',
  endpoint: '/api/v1/player',
  purpose: 'roster-fetch'
}
const operation = {
  purpose: 'roster-fetch',
  trigger: 'user' as const,
  timeoutMs: 5000
}

it('counts an admitted dispatch by reviewed endpoint and purpose', async () => {
  delete process.env.PROVIDER_ADMISSION_MODE
  useOutboundKillSwitchReader(async () => 'public')
  globalThis.fetch = (async () =>
    new Response(null, { status: 204 })) as typeof fetch

  const before = await sample('tacticus_app_provider_calls_total', labels)
  await providerFetch(url, {}, false, operation)
  const after = await sample('tacticus_app_provider_calls_total', labels)

  expect(after - before).toBe(1)
})

it('counts a refused dispatch as neither a call nor a failure', async () => {
  delete process.env.PROVIDER_ADMISSION_MODE
  useOutboundKillSwitchReader(async () => 'halted')
  globalThis.fetch = (async () =>
    new Response(null, { status: 204 })) as typeof fetch

  const callsBefore = await sample('tacticus_app_provider_calls_total', labels)
  const failuresBefore = await sample(
    'tacticus_app_provider_failures_total',
    labels
  )

  await expect(providerFetch(url, {}, false, operation)).rejects.toThrow()

  expect(await sample('tacticus_app_provider_calls_total', labels)).toBe(
    callsBefore
  )
  expect(await sample('tacticus_app_provider_failures_total', labels)).toBe(
    failuresBefore
  )
})

it('counts an error status as a failure', async () => {
  delete process.env.PROVIDER_ADMISSION_MODE
  useOutboundKillSwitchReader(async () => 'public')
  globalThis.fetch = (async () =>
    new Response(null, { status: 500 })) as typeof fetch

  const before = await sample('tacticus_app_provider_failures_total', labels)
  await providerFetch(url, {}, false, operation)
  const after = await sample('tacticus_app_provider_failures_total', labels)

  expect(after - before).toBe(1)
})

it('labels nothing with an account or caller-supplied path', async () => {
  delete process.env.PROVIDER_ADMISSION_MODE
  useOutboundKillSwitchReader(async () => 'public')
  globalThis.fetch = (async () =>
    new Response(null, { status: 204 })) as typeof fetch

  await providerFetch(
    'https://api.tacticusgame.com/api/v1/player?a=1',
    {},
    false,
    operation
  )

  const metric = register.getSingleMetric('tacticus_app_provider_calls_total')
  const json = await metric!.get()
  for (const value of json.values) {
    expect(Object.keys(value.labels).sort()).toEqual([
      'domain',
      'endpoint',
      'purpose'
    ])
  }
})

it('collapses an unreviewed purpose to unknown', async () => {
  delete process.env.PROVIDER_ADMISSION_MODE
  useOutboundKillSwitchReader(async () => 'public')
  globalThis.fetch = (async () =>
    new Response(null, { status: 204 })) as typeof fetch

  const unknown = { ...labels, purpose: 'unknown' }
  const before = await sample('tacticus_app_provider_calls_total', unknown)
  await providerFetch(url, {}, false, {
    ...operation,
    purpose: 'caller-made-up-purpose-1'
  })
  const after = await sample('tacticus_app_provider_calls_total', unknown)

  expect(after - before).toBe(1)
  const metric = register.getSingleMetric('tacticus_app_provider_calls_total')
  const json = await metric!.get()
  expect(
    json.values.some(
      (value) => value.labels.purpose === 'caller-made-up-purpose-1'
    )
  ).toBe(false)
})

const brokenBody = () =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error('stream broke'))
      }
    }),
    { status: 200 }
  )

it('counts one failure when an OK response fails while its body is read', async () => {
  delete process.env.PROVIDER_ADMISSION_MODE
  useOutboundKillSwitchReader(async () => 'public')
  globalThis.fetch = (async () => brokenBody()) as typeof fetch

  const before = await sample('tacticus_app_provider_failures_total', labels)
  await captureProviderMetrics(async () => {
    const response = await providerFetch(url, {}, false, operation)
    await expect(response.text()).rejects.toThrow()
    await expect(response.text()).rejects.toThrow()
  })
  const after = await sample('tacticus_app_provider_failures_total', labels)

  expect(after - before).toBe(1)
})

it('does not count an error status twice when its body also fails', async () => {
  delete process.env.PROVIDER_ADMISSION_MODE
  useOutboundKillSwitchReader(async () => 'public')
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('stream broke'))
        }
      }),
      { status: 502 }
    )) as typeof fetch

  const before = await sample('tacticus_app_provider_failures_total', labels)
  await captureProviderMetrics(async () => {
    const response = await providerFetch(url, {}, false, operation)
    await expect(response.text()).rejects.toThrow()
  })
  const after = await sample('tacticus_app_provider_failures_total', labels)

  expect(after - before).toBe(1)
})
