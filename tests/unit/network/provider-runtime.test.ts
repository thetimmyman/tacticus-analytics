import { afterEach, expect, it, vi } from 'vitest'
import { createProviderRuntime } from '@/supabase/functions/_shared/provider-admission'
import { ProviderAdmissionError } from '@/supabase/functions/_shared/provider-admission'

const url = 'https://api.tacticusgame.com/api/v1/player'
const operation = {
  purpose: 'roster-fetch',
  trigger: 'user' as const,
  timeoutMs: 5000
}
afterEach(() => vi.useRealTimers())

it('keeps ordinary traffic available without consulting admission', async () => {
  const wire = vi.fn(async () => new Response('local'))
  const settings = vi.fn(() => {
    throw new Error('unavailable settings')
  })
  const control = vi.fn()
  const runtime = createProviderRuntime({
    settings,
    physicalFetch: wire,
    controlFetch: control
  })
  expect(
    await (await runtime.fetch('https://local.example.invalid/health')).text()
  ).toBe('local')
  expect(settings).not.toHaveBeenCalled()
  expect(control).not.toHaveBeenCalled()
  expect(wire).toHaveBeenCalledTimes(1)
})

it('has explicit reversible enrollment and never falls back after enforcement', async () => {
  let mode = 'off'
  const wire = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('provider')
  )
  const control = vi.fn()
  const runtime = createProviderRuntime({
    settings: () => ({ mode }),
    physicalFetch: wire,
    controlFetch: control
  })
  await runtime.fetch(url)
  expect(wire).toHaveBeenCalledTimes(1)
  expect(wire.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({ redirect: 'error' })
  )
  mode = 'enforce'
  await expect(runtime.fetch(url, {}, operation)).rejects.toBeInstanceOf(
    ProviderAdmissionError
  )
  expect(wire).toHaveBeenCalledTimes(1)
  expect(control).not.toHaveBeenCalled()
  mode = 'typo'
  await expect(runtime.fetch(url, {}, operation)).rejects.toBeInstanceOf(
    ProviderAdmissionError
  )
  expect(wire).toHaveBeenCalledTimes(1)
})

it('refuses unattributed work and preserves a denied authority hold without a provider send', async () => {
  const wire = vi.fn()
  const control = vi.fn(async () =>
    Response.json({
      status: 'denied',
      reason: 'provider-hold',
      retryAfterSeconds: 1e100
    })
  )
  const runtime = createProviderRuntime({
    settings: () => ({
      mode: 'enforce',
      authorityOrigin: 'http://authority.example.invalid',
      token: 'synthetic-control',
      accountLabelKey: 'K'.repeat(32)
    }),
    physicalFetch: wire,
    controlFetch: control
  })
  await expect(
    runtime.fetch(url, { headers: { 'x-api-key': 'synthetic-key' } })
  ).rejects.toBeInstanceOf(ProviderAdmissionError)
  expect(control).not.toHaveBeenCalled()
  await expect(
    runtime.fetch(url, { headers: { 'x-api-key': 'synthetic-key' } }, operation)
  ).rejects.toMatchObject({ localBackPressure: true, retryAfterSeconds: 1e100 })
  expect(control).toHaveBeenCalledTimes(1)
  expect(wire).not.toHaveBeenCalled()
})

it('binds account admission to an immutable snapshot of the request sent on the wire', async () => {
  const headers = new Headers({ 'x-api-key': 'synthetic-original' })
  let sentKey: string | null = null
  const runtime = createProviderRuntime({
    settings: () => ({
      mode: 'enforce',
      authorityOrigin: 'http://authority.example.invalid',
      token: 'synthetic-control',
      accountLabelKey: 'K'.repeat(32)
    }),
    controlFetch: async (input, init) => {
      const operation = String(input).split('/').at(-1)
      const body = JSON.parse(String(init?.body))
      if (operation === 'reserve' || operation === 'dispatch')
        return Response.json({
          status: operation === 'reserve' ? 'reserved' : 'dispatch',
          attemptId: body.attemptId,
          timeoutMs: 5000,
          [operation === 'reserve' ? 'claimUntil' : 'deadline']: new Date(
            Date.now() + 2000
          ).toISOString()
        })
      return Response.json({ status: 'continue' })
    },
    physicalFetch: async (input, init) => {
      sentKey = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      ).get('x-api-key')
      return new Response('synthetic')
    }
  })
  const pending = runtime.fetch(url, { headers }, operation)
  headers.set('x-api-key', 'synthetic-replaced')
  const response = await pending
  await response.text()
  expect(sentKey).toBe('synthetic-original')
})
