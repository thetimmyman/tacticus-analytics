import { afterEach, expect, it, vi } from 'vitest'
import {
  createProviderAdmission,
  createProviderAccountLabeler,
  createProviderDispatchResolver,
  ProviderAdmissionError,
  type ProviderDispatch
} from '@/supabase/functions/_shared/provider-admission'

const dispatch: ProviderDispatch = {
  domain: 'official',
  account: 'a'.repeat(64),
  endpoint: '/api/v1/player',
  purpose: 'roster-fetch',
  priority: 'background',
  timeoutMs: 5000
}
const origin = 'https://control.example.invalid'
const token = 'synthetic-control-token'
const playerUrl = 'https://api.tacticusgame.com/api/v1/player'

function authority(
  respond?: (
    operation: string,
    body: Record<string, unknown>
  ) => Response | undefined
) {
  const calls: Array<{
    operation: string
    body: Record<string, unknown>
    authorization: string | null
  }> = []
  const controlFetch: typeof fetch = vi.fn(async (input, init) => {
    const url = new URL(String(input))
    const operation = url.pathname.split('/').at(-1)!
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({
      operation,
      body,
      authorization: new Headers(init?.headers).get('authorization')
    })
    const custom = respond?.(operation, body)
    if (custom) return custom
    if (operation === 'reserve')
      return Response.json({
        status: 'reserved',
        attemptId: body.attemptId,
        claimUntil: new Date(Date.now() + 2000).toISOString(),
        timeoutMs: dispatch.timeoutMs
      })
    if (operation === 'dispatch')
      return Response.json({
        status: 'dispatch',
        attemptId: body.attemptId,
        deadline: new Date(Date.now() + dispatch.timeoutMs).toISOString(),
        timeoutMs: dispatch.timeoutMs
      })
    if (operation === 'check') return Response.json({ status: 'continue' })
    return Response.json({ status: 'complete', idempotent: false })
  })
  return { calls, controlFetch }
}

afterEach(() => vi.useRealTimers())

it('binds official context to the effective wire key and authorized user purpose', async () => {
  const resolve = createProviderDispatchResolver({ key: 'K'.repeat(32) })
  const label = createProviderAccountLabeler('K'.repeat(32))
  const input = new Request(playerUrl, {
    headers: { 'x-api-key': 'synthetic-original' }
  })
  const context = await resolve(
    input,
    { headers: { 'x-api-key': 'synthetic-override' } },
    { purpose: 'roster-fetch', trigger: 'user', timeoutMs: 5000 }
  )
  expect(context).toEqual({
    ...dispatch,
    account: await label('official', 'synthetic-override'),
    priority: 'essential'
  })
  await expect(
    resolve(
      input,
      { headers: { 'x-synthetic': 'replacement' } },
      { purpose: 'roster-fetch', trigger: 'user', timeoutMs: 5000 }
    )
  ).rejects.toBeInstanceOf(ProviderAdmissionError)
})

it('keeps the game account label stable across sessions while hiding path identities', async () => {
  const resolve = createProviderDispatchResolver({ key: 'K'.repeat(32) })
  const operation = {
    purpose: 'roster-fetch',
    trigger: 'scheduled' as const,
    timeoutMs: 5000
  }
  const url = (session: string) =>
    `https://api-live.loki.snowprintstudios.com/player/player2/userId/Synthetic-Account/sessionId/${session}`
  const first = await resolve(
    url('synthetic-first'),
    { method: 'POST' },
    operation
  )
  const second = await resolve(
    url('synthetic-second'),
    { method: 'POST' },
    operation
  )
  expect(first.account).toBe(second.account)
  expect(first.endpoint).toBe(
    '/player/player2/userId/<account>/sessionId/<session>'
  )
  expect(first.priority).toBe('background')
  expect(JSON.stringify(first)).not.toContain('Synthetic-Account')
  expect(JSON.stringify(second)).not.toContain('synthetic-second')
})

it('uses interoperable opaque account labels without exporting credentials', async () => {
  const label = createProviderAccountLabeler('K'.repeat(32))
  const { createHmac } = await import('node:crypto')
  const expected = (subject: string) =>
    createHmac('sha256', 'K'.repeat(32)).update(subject).digest('hex')
  expect(await label('official', 'synthetic-key')).toBe(
    expected('official-credential\0synthetic-key')
  )
  expect(await label('loki', 'Synthetic-Account')).toBe(
    expected('game-account\0Synthetic-Account')
  )
  expect(await label('websocket', 'Synthetic-Account')).toBe(
    await label('loki', 'Synthetic-Account')
  )
  expect(await label('cdn')).toBe(expected('anonymous\0cdn'))
  expect(await label('cdn', 'ignored-synthetic-account')).toBe(
    await label('cdn')
  )
})

it('refuses missing label authority or missing authenticated account identity', async () => {
  expect(() => createProviderAccountLabeler('short-synthetic-key')).toThrow(
    ProviderAdmissionError
  )
  const label = createProviderAccountLabeler('K'.repeat(32))
  await expect(label('official')).rejects.toBeInstanceOf(ProviderAdmissionError)
  await expect(label('loki', '')).rejects.toBeInstanceOf(ProviderAdmissionError)
})

it('admits one physical request and retains ownership until its response ends', async () => {
  const control = authority()
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const physicalFetch: typeof fetch = vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller
          }
        })
      )
  )
  const transport = createProviderAdmission({
    authorityOrigin: origin,
    token,
    controlFetch: control.controlFetch,
    physicalFetch
  })
  const response = await transport.fetch(playerUrl, {}, dispatch)
  expect(physicalFetch).toHaveBeenCalledTimes(1)
  expect(control.calls.map((call) => call.operation)).toEqual([
    'reserve',
    'dispatch'
  ])
  expect(control.calls[0].body).toEqual({
    ...dispatch,
    attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/)
  })
  expect(
    control.calls.every((call) => call.authorization === `Bearer ${token}`)
  ).toBe(true)
  expect(
    new Headers(vi.mocked(physicalFetch).mock.calls[0][1]?.headers).has(
      'authorization'
    )
  ).toBe(false)
  expect(vi.mocked(physicalFetch).mock.calls[0][1]?.redirect).toBe('error')
  stream.enqueue(new TextEncoder().encode('{"ok":true}'))
  stream.close()
  expect(await response.json()).toEqual({ ok: true })
  await vi.waitFor(() =>
    expect(control.calls.at(-1)?.body).toEqual({
      attemptId: control.calls[0].body.attemptId,
      status: 200,
      settled: true
    })
  )
})

it('refuses a shared provider hold without dispatch, retry or fallback', async () => {
  const control = authority(() =>
    Response.json({
      status: 'denied',
      reason: 'provider-hold',
      retryAfterSeconds: 1e100
    })
  )
  const physicalFetch: typeof fetch = vi.fn()
  const transport = createProviderAdmission({
    authorityOrigin: origin,
    token,
    controlFetch: control.controlFetch,
    physicalFetch
  })
  await expect(transport.fetch(playerUrl, {}, dispatch)).rejects.toMatchObject({
    code: 'PROVIDER_ADMISSION_REFUSED',
    status: 503,
    localBackPressure: true,
    retryAfterSeconds: 1e100
  })
  expect(physicalFetch).not.toHaveBeenCalled()
  expect(control.calls).toHaveLength(1)
})

it('bounds an authority response whose unread cleanup never settles', async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}))
  const control = authority(
    () => new Response(new ReadableStream({ cancel }), { status: 503 })
  )
  const physicalFetch: typeof fetch = vi.fn()
  const transport = createProviderAdmission({
    authorityOrigin: origin,
    token,
    controlFetch: control.controlFetch,
    physicalFetch,
    rpcTimeoutMs: 100
  })
  await expect(transport.fetch(playerUrl, {}, dispatch)).rejects.toBeInstanceOf(
    ProviderAdmissionError
  )
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(physicalFetch).not.toHaveBeenCalled()
})

it.each(['attempt', 'fields'])(
  'rejects a mismatched %s grant before sending',
  async (kind) => {
    const control = authority((operation, body) =>
      operation === 'reserve'
        ? Response.json({
            status: 'reserved',
            attemptId:
              kind === 'attempt'
                ? '00000000-0000-4000-8000-000000000099'
                : body.attemptId,
            claimUntil: new Date(Date.now() + 2000).toISOString(),
            timeoutMs: dispatch.timeoutMs,
            ...(kind === 'fields'
              ? { capturedBody: 'synthetic-private-data' }
              : {})
          })
        : undefined
    )
    const physicalFetch: typeof fetch = vi.fn()
    const transport = createProviderAdmission({
      authorityOrigin: origin,
      token,
      controlFetch: control.controlFetch,
      physicalFetch
    })
    const result = await transport
      .fetch(playerUrl, {}, dispatch)
      .catch((error: unknown) => error)
    expect(result).toBeInstanceOf(ProviderAdmissionError)
    expect(String(result)).not.toContain('synthetic-private-data')
    expect(physicalFetch).not.toHaveBeenCalled()
  }
)

it('retains uncertainty when the underlying cancellation never settles', async () => {
  const control = authority()
  const cancel = vi.fn(() => new Promise<void>(() => {}))
  const transport = createProviderAdmission({
    authorityOrigin: origin,
    token,
    controlFetch: control.controlFetch,
    physicalFetch: vi.fn(
      async () => new Response(new ReadableStream({ cancel }))
    )
  })
  const response = await transport.fetch(playerUrl, {}, dispatch)
  await response.body!.cancel()
  expect(cancel).toHaveBeenCalledTimes(1)
  await vi.waitFor(() =>
    expect(control.calls.at(-1)?.operation).toBe('outcome')
  )
  expect(control.calls.at(-1)?.body).toMatchObject({
    status: 200,
    settled: false
  })
})

it('retains uncertainty after shutdown while the physical request is still waiting for headers', async () => {
  vi.useFakeTimers()
  const control = authority((operation) =>
    operation === 'check'
      ? Response.json({
          status: 'denied',
          reason: 'disabled',
          retryAfterSeconds: 60
        })
      : undefined
  )
  let physicalSignal: AbortSignal | undefined
  const physicalFetch: typeof fetch = vi.fn(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        physicalSignal = init?.signal ?? undefined
        physicalSignal?.addEventListener(
          'abort',
          () => reject(physicalSignal!.reason),
          { once: true }
        )
      })
  )
  const transport = createProviderAdmission({
    authorityOrigin: origin,
    token,
    controlFetch: control.controlFetch,
    physicalFetch,
    pollMs: 100
  })
  const result = transport
    .fetch(playerUrl, {}, dispatch)
    .catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(300)
  expect(physicalSignal?.aborted).toBe(true)
  expect(await result).toBeInstanceOf(ProviderAdmissionError)
  expect(physicalFetch).toHaveBeenCalledTimes(1)
  expect(control.calls.at(-1)?.body).toMatchObject({
    status: 0,
    settled: false
  })
})

it('records the full provider hold at headers before an unread error body ends', async () => {
  const control = authority((operation, body) =>
    operation === 'outcome' && body.responseOnly === true
      ? Response.json({ status: 'continue' })
      : undefined
  )
  const physicalFetch: typeof fetch = vi.fn(
    async () =>
      new Response(new ReadableStream(), {
        status: 429,
        headers: { 'retry-after': '1' + '0'.repeat(100) }
      })
  )
  const transport = createProviderAdmission({
    authorityOrigin: origin,
    token,
    controlFetch: control.controlFetch,
    physicalFetch
  })
  const response = await transport.fetch(playerUrl, {}, dispatch)
  expect(control.calls.at(-1)?.body).toEqual({
    attemptId: control.calls[0].body.attemptId,
    status: 429,
    settled: false,
    responseOnly: true,
    retryAfterSeconds: 1e100
  })
  await response.body!.cancel()
  await vi.waitFor(() => expect(control.calls.at(-1)?.body.settled).toBe(true))
  expect(physicalFetch).toHaveBeenCalledTimes(1)
})

it('bounds authority JSON reading even if the control fetch ignores abort', async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}))
  const control = authority(() => new Response(new ReadableStream({ cancel })))
  const physicalFetch: typeof fetch = vi.fn()
  const transport = createProviderAdmission({
    authorityOrigin: origin,
    token,
    controlFetch: control.controlFetch,
    physicalFetch,
    rpcTimeoutMs: 100
  })
  await expect(transport.fetch(playerUrl, {}, dispatch)).rejects.toBeInstanceOf(
    ProviderAdmissionError
  )
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(physicalFetch).not.toHaveBeenCalled()
})

it.each([
  ['https://unrelated.example.invalid/api/v1/player', {}],
  ['https://api.tacticusgame.com/api/v1/guild', {}],
  [playerUrl, { method: 'POST' }],
  ['https://api.tacticusgame.com/api/v1/guild/synthetic/members', {}]
])(
  'refuses an unbound physical target %s before asking for permission',
  async (url, init) => {
    const control = authority()
    const physicalFetch: typeof fetch = vi.fn()
    const transport = createProviderAdmission({
      authorityOrigin: origin,
      token,
      controlFetch: control.controlFetch,
      physicalFetch
    })

    await expect(transport.fetch(url, init, dispatch)).rejects.toBeInstanceOf(
      ProviderAdmissionError
    )
    expect(control.calls).toHaveLength(0)
    expect(physicalFetch).not.toHaveBeenCalled()
  }
)

it('preserves a Request body through validation and the admitted send', async () => {
  const control = authority()
  const input = new Request(
    'https://api-live.loki.snowprintstudios.com/player/player2/userId/synthetic',
    { method: 'POST', body: 'synthetic-request' }
  )
  const bodies: string[] = []
  const physicalFetch: typeof fetch = vi.fn(async (request, init) => {
    bodies.push(await new Request(request, init).text())
    return new Response('ok')
  })
  const transport = createProviderAdmission({
    authorityOrigin: origin,
    token,
    controlFetch: control.controlFetch,
    physicalFetch
  })
  const response = await transport.fetch(
    input,
    {},
    {
      ...dispatch,
      domain: 'loki',
      endpoint: '/player/player2/userId/<account>'
    }
  )
  expect(await response.text()).toBe('ok')
  expect(bodies).toEqual(['synthetic-request'])
  expect(physicalFetch).toHaveBeenCalledTimes(1)
})
