import { afterEach, expect, it, vi } from 'vitest'
import { ProviderAdmissionError } from '@/supabase/functions/_shared/provider-admission'
import { withRetry } from '@/app/lib/resilience/with-retry'
import {
  CircuitBreaker,
  fetchTacticusApi
} from '@/app/lib/sync/tacticus-api-client'
import { withProviderOperation } from '@/app/lib/network/provider-metrics'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('does not let a local admission refusal enter any configured retry ladder', async () => {
  vi.useFakeTimers()
  const refusal = new ProviderAdmissionError(1e100)
  const operation = vi.fn(async () => {
    throw refusal
  })
  const pending = expect(
    withRetry(operation, {
      maxAttempts: 3,
      retryOn: () => true,
      baseDelayMs: 1,
      jitter: false
    })
  ).rejects.toBe(refusal)
  await vi.runAllTimersAsync()
  await pending
  expect(operation).toHaveBeenCalledTimes(1)
})

it('does not open a shared provider circuit after local admission refusals', async () => {
  const breaker = new CircuitBreaker(1, 30000)
  const refusal = new ProviderAdmissionError(60)
  await expect(
    breaker.execute(async () => {
      throw refusal
    })
  ).rejects.toBe(refusal)
  expect(await breaker.execute(async () => 'available')).toBe('available')
})

it('does not repeat a refused worker attempt inside its manual retry loop', async () => {
  vi.stubEnv('PROVIDER_ADMISSION_MODE', 'enforce')
  vi.stubEnv('PROVIDER_ADMISSION_ORIGIN', 'http://authority.example.invalid')
  vi.stubEnv('PROVIDER_ADMISSION_TOKEN', 'synthetic-token')
  vi.stubEnv('PROVIDER_ACCOUNT_LABEL_KEY', 'K'.repeat(32))
  const wire = vi.fn(async () =>
    Response.json({
      status: 'denied',
      reason: 'disabled',
      retryAfterSeconds: 60
    })
  )
  vi.stubGlobal('fetch', wire)
  const pending = expect(
    withProviderOperation(
      { purpose: 'guild-sync', trigger: 'scheduled', timeoutMs: 5000 },
      () => fetchTacticusApi('/guild', 'synthetic-key', 'synthetic')
    )
  ).rejects.toBeInstanceOf(ProviderAdmissionError)
  await pending
  expect(wire).toHaveBeenCalledTimes(1)
})

it('keeps shared application circuits available after local refusals', async () => {
  const { CircuitBreaker: ApplicationCircuit } =
    await import('@/app/lib/resilience/circuit-breaker')
  const circuit = new ApplicationCircuit({
    name: 'synthetic-admission',
    failureThreshold: 1,
    successThreshold: 1,
    timeout: 30000,
    registerInRegistry: false
  })
  const refusal = new ProviderAdmissionError(60)
  await expect(
    circuit.execute(async () => {
      throw refusal
    })
  ).rejects.toBe(refusal)
  expect(await circuit.execute(async () => 'available')).toBe('available')
})

it('attributes public API methods and propagates refusal without reporting an invalid credential', async () => {
  vi.stubEnv('PROVIDER_ADMISSION_MODE', 'enforce')
  vi.stubEnv('PROVIDER_ADMISSION_ORIGIN', 'http://authority.example.invalid')
  vi.stubEnv('PROVIDER_ADMISSION_TOKEN', 'synthetic-token')
  vi.stubEnv('PROVIDER_ACCOUNT_LABEL_KEY', 'K'.repeat(32))
  const purposes: string[] = []
  const wire = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    purposes.push(JSON.parse(String(init?.body)).purpose)
    return Response.json({
      status: 'denied',
      reason: 'disabled',
      retryAfterSeconds: 60
    })
  })
  vi.stubGlobal('fetch', wire)
  const { TacticusAPIClient } = await import('@/app/lib/api/tacticus-client')
  const client = new TacticusAPIClient()
  const reads = [
    () => client.validateApiKey('synthetic-key'),
    () => client.getPlayerResult('synthetic-key'),
    () => client.getPlayerWithRetry('synthetic-key'),
    () => client.getGuild('synthetic-key'),
    () => client.getCurrentGuildRaid('synthetic-key'),
    () => client.getGuildRaidBySeason('synthetic-key', 1)
  ]
  for (const read of reads)
    await expect(read()).rejects.toBeInstanceOf(ProviderAdmissionError)
  expect(purposes).toEqual([
    'credential-check',
    'roster-fetch',
    'roster-fetch',
    'guild-sync',
    'guild-sync',
    'guild-sync'
  ])
  expect(wire).toHaveBeenCalledTimes(reads.length)
})

it('stops Loki retries and session repair on a local refusal', async () => {
  const { createLokiClient } = await import('@/app/lib/loki/client')
  const refusal = new ProviderAdmissionError(1e100)
  const fetchImpl = vi.fn(() => Promise.reject(refusal))
  const client = createLokiClient(
    {
      userId: 'synthetic-account',
      sessionId: 'synthetic-session',
      clientSecret: 'synthetic-secret'
    },
    { fetchImpl, retryAttempts: 0 }
  )
  await expect(client.getPlayerInfo('synthetic-target')).rejects.toBe(refusal)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  await expect(client.refreshSession()).rejects.toBe(refusal)
  expect(fetchImpl).toHaveBeenCalledTimes(2)
})

it('releases the unused provider body after credential validation at headers', async () => {
  let cancelled = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled++
            }
          })
        )
    )
  )
  const { TacticusAPIClient } = await import('@/app/lib/api/tacticus-client')
  expect(await new TacticusAPIClient().validateApiKey('synthetic-key')).toBe(
    true
  )
  expect(cancelled).toBe(1)
})
