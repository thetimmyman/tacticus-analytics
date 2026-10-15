import { randomBytes } from 'node:crypto'
import { createServer, type Server, type RequestListener } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSharedFetch } from '@/app/lib/network/undici-agent'
import {
  captureProviderMetrics,
  providerFetch
} from '@/app/lib/network/provider-metrics'

let server: Server | null = null

const listen = async (handler: RequestListener) => {
  server = createServer(handler)
  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  if (!server) return
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  server = null
})

describe('getSharedFetch', () => {
  it('preserves binary response bytes', async () => {
    const imageBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8, 0xff
    ])
    const baseUrl = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(imageBytes)
    })

    const response = await getSharedFetch()(`${baseUrl}/board.png`)
    const body = Buffer.from(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(body.equals(imageBytes)).toBe(true)
  })
})

describe('httpFetch body framing', () => {
  it('sets Content-Length on a DELETE body so it is not parsed as the next request on a keep-alive connection', async () => {
    const requestLines: string[] = []
    const contentLengths: (string | undefined)[] = []
    let requestsSeen = 0

    // A real node:http server frames like a keep-alive proxy, exposing an unframed body.
    const baseUrl = await listen((request, response) => {
      requestsSeen += 1
      requestLines.push(`${request.method} ${request.url}`)
      contentLengths.push(request.headers['content-length'])
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            seenRequestNumber: requestsSeen,
            path: request.url
          })
        )
      })
    })

    const fetchImpl = getSharedFetch()

    const deleteResponse = await fetchImpl(`${baseUrl}/users/123`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ should_soft_delete: false })
    })
    const secondResponse = await fetchImpl(`${baseUrl}/health`, {
      method: 'GET'
    })

    expect(deleteResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)

    const deleteBody = (await deleteResponse.json()) as {
      seenRequestNumber: number
      path: string
    }
    const secondBody = (await secondResponse.json()) as {
      seenRequestNumber: number
      path: string
    }

    expect(requestsSeen).toBe(2)
    expect(requestLines).toEqual(['DELETE /users/123', 'GET /health'])

    const expectedLength = String(
      Buffer.byteLength(JSON.stringify({ should_soft_delete: false }), 'utf-8')
    )
    expect(contentLengths[0]).toBe(expectedLength)

    expect(deleteBody.seenRequestNumber).toBe(1)
    expect(deleteBody.path).toBe('/users/123')
    expect(secondBody.seenRequestNumber).toBe(2)
    expect(secondBody.path).toBe('/health')
  })
})

describe('desktop fetch authority', () => {
  it('adds main-process authority only to its configured local service', async () => {
    let requests = 0
    const transportKey = randomBytes(32).toString('hex')
    const endpoint = await listen((request, response) => {
      requests += 1
      expect(request.headers['x-desktop-transport']).toBe(transportKey)
      response.end('local')
    })
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
    vi.stubEnv('SUPABASE_URL', `${endpoint}/supabase`)
    vi.stubEnv('DESKTOP_TRANSPORT_KEY', transportKey)
    expect(
      await (await getSharedFetch()(`${endpoint}/supabase/rest/v1/`)).text()
    ).toBe('local')
    await expect(getSharedFetch()('https://remote.invalid/')).rejects.toThrow(
      'non-local service'
    )
    expect(requests).toBe(1)
  })
  it('refuses local requests without main-process authority', async () => {
    const endpoint = await listen((_request, response) =>
      response.end('must not reach')
    )
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
    vi.stubEnv('SUPABASE_URL', `${endpoint}/supabase`)
    vi.stubEnv('DESKTOP_TRANSPORT_KEY', '')
    await expect(
      getSharedFetch()(`${endpoint}/supabase/rest/v1/`)
    ).rejects.toThrow('transport key is required')
  })
})

async function bounded<T>(
  operation: Promise<T>,
  label = 'operation'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('native ' + label + ' did not complete')),
          1500
        )
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

function admittedLoopback(
  endpoint: string,
  outcomes: Array<Record<string, unknown>> = []
) {
  vi.stubEnv('PROVIDER_ADMISSION_MODE', 'enforce')
  vi.stubEnv('PROVIDER_ADMISSION_ORIGIN', 'https://synthetic-control.invalid')
  vi.stubEnv('PROVIDER_ADMISSION_TOKEN', 'synthetic-control-token')
  vi.stubEnv('PROVIDER_ACCOUNT_LABEL_KEY', 'K'.repeat(32))
  const native = getSharedFetch()
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin === 'https://synthetic-control.invalid') {
        const operation = url.pathname.split('/').at(-1)
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (operation === 'reserve')
          return Response.json({
            status: 'reserved',
            attemptId: body.attemptId,
            claimUntil: new Date(Date.now() + 2000).toISOString(),
            timeoutMs: 5000
          })
        if (operation === 'dispatch')
          return Response.json({
            status: 'dispatch',
            attemptId: body.attemptId,
            deadline: new Date(Date.now() + 5000).toISOString(),
            timeoutMs: 5000
          })
        if (operation === 'outcome') outcomes.push(body)
        if (operation === 'check') return Response.json({ status: 'continue' })
        return Response.json({ status: 'complete', idempotent: false })
      }
      expect(url.hostname).toBe('api-live.loki.snowprintstudios.com')
      return native(
        input instanceof Request ? new Request(endpoint, input) : endpoint,
        init
      )
    }
  )
}

describe('Request transport compatibility', () => {
  it('sends exact Request bytes, method and headers without consuming an independent clone', async () => {
    const expected = new Uint8Array([0, 255, 128, 13, 10, 65])
    let received: Buffer | undefined
    let method: string | undefined
    let marker: string | undefined
    const endpoint = await listen((request, response) => {
      method = request.method
      marker = String(request.headers['x-synthetic-marker'])
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        received = Buffer.concat(chunks)
        response.end('ok')
      })
    })
    const input = new Request(endpoint, {
      method: 'POST',
      headers: { 'x-synthetic-marker': 'body-check' },
      body: expected
    })
    const independent = input.clone()
    const response = await getSharedFetch()(input)
    expect(await response.text()).toBe('ok')
    expect(method).toBe('POST')
    expect(marker).toBe('body-check')
    expect(received).toEqual(Buffer.from(expected))
    expect(input.bodyUsed).toBe(true)
    expect(new Uint8Array(await independent.arrayBuffer())).toEqual(expected)
  })

  it('uses an init body override without consuming the original Request body', async () => {
    let received = ''
    const endpoint = await listen((request, response) => {
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        received += chunk
      })
      request.on('end', () => response.end('ok'))
    })
    const input = new Request(endpoint, {
      method: 'POST',
      body: 'original-synthetic'
    })
    await (
      await getSharedFetch()(input, { body: 'replacement-synthetic' })
    ).text()
    expect(received).toBe('replacement-synthetic')
    expect(input.bodyUsed).toBe(false)
    expect(await input.text()).toBe('original-synthetic')
  })

  it('refuses a pre-aborted Request without consuming or sending its body', async () => {
    let sends = 0
    const endpoint = await listen((_request, response) => {
      sends++
      response.end()
    })
    const controller = new AbortController()
    const input = new Request(endpoint, {
      method: 'POST',
      body: 'synthetic',
      signal: controller.signal
    })
    controller.abort()
    await expect(getSharedFetch()(input)).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(sends).toBe(0)
    expect(input.bodyUsed).toBe(false)
  })

  it('uses Request.signal to stop a pending native response', async () => {
    let entered!: () => void
    const accepted = new Promise<void>((resolve) => {
      entered = resolve
    })
    const endpoint = await listen(() => entered())
    const controller = new AbortController()
    const pending = getSharedFetch()(
      new Request(endpoint, { signal: controller.signal })
    )
    void pending.catch(() => undefined)
    await bounded(accepted)
    controller.abort()
    await expect(bounded(pending)).rejects.toMatchObject({
      name: 'AbortError'
    })
  })

  it('streams a Request upload and cancels a blocked source when aborted', async () => {
    let entered!: () => void
    const accepted = new Promise<void>((resolve) => {
      entered = resolve
    })
    const endpoint = await listen((request) =>
      request.on('data', () => entered())
    )
    let cancelled = false
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
      },
      cancel() {
        cancelled = true
      }
    })
    const controller = new AbortController()
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body: source,
      signal: controller.signal,
      duplex: 'half'
    }
    const pending = getSharedFetch()(new Request(endpoint, init))
    void pending.catch(() => undefined)
    await bounded(accepted)
    controller.abort()
    await expect(bounded(pending)).rejects.toMatchObject({
      name: 'AbortError'
    })
    await vi.waitFor(() => expect(cancelled).toBe(true))
  })

  it('preserves admitted POST JSON through the actual Node transport and counts one attempt', async () => {
    const expected = JSON.stringify({ synthetic: 'admitted-body' })
    let received = ''
    let method: string | undefined
    let marker: string | undefined
    const endpoint = await listen((request, response) => {
      method = request.method
      marker = String(request.headers['x-synthetic-marker'])
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        received += chunk
      })
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        response.end('{}')
      })
    })
    admittedLoopback(endpoint)
    const measured = await captureProviderMetrics(async () => {
      const response = await providerFetch(
        'https://api-live.loki.snowprintstudios.com/player/player2/userId/Synthetic-Account',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-synthetic-marker': 'admitted'
          },
          body: expected
        },
        false,
        {
          purpose: 'game-config-refresh',
          trigger: 'scheduled',
          timeoutMs: 5000
        }
      )
      return response.json()
    })
    expect(received).toBe(expected)
    expect(method).toBe('POST')
    expect(marker).toBe('admitted')
    expect(measured.metrics).toEqual({
      api_calls: 1,
      api_errors: 0,
      api_retry_count: 0
    })
  })
})

describe('Request transport boundaries', () => {
  it('applies init method, headers and signal overrides without reading the replaced body', async () => {
    let actual:
      | { method?: string; old?: string; replacement?: string; body: string }
      | undefined
    const endpoint = await listen((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        actual = {
          method: request.method,
          old: request.headers['x-original'] as string | undefined,
          replacement: request.headers['x-replacement'] as string | undefined,
          body
        }
        response.end('ok')
      })
    })
    const original = new AbortController()
    const input = new Request(endpoint, {
      method: 'POST',
      headers: { 'x-original': 'synthetic-old' },
      body: 'original',
      signal: original.signal
    })
    original.abort()
    await (
      await getSharedFetch()(input, {
        method: 'DELETE',
        headers: { 'x-replacement': 'synthetic-new' },
        body: 'replacement',
        signal: new AbortController().signal
      })
    ).text()
    expect(actual).toEqual({
      method: 'DELETE',
      old: undefined,
      replacement: 'synthetic-new',
      body: 'replacement'
    })
    expect(input.bodyUsed).toBe(false)
    expect(await input.text()).toBe('original')
  })

  it('refuses a consumed Request without another physical send', async () => {
    let sends = 0
    const endpoint = await listen((request, response) => {
      sends++
      request.resume()
      request.on('end', () => response.end('ok'))
    })
    const input = new Request(endpoint, {
      method: 'POST',
      body: 'synthetic-once'
    })
    await (await getSharedFetch()(input)).text()
    await expect(getSharedFetch()(input)).rejects.toBeInstanceOf(TypeError)
    expect(sends).toBe(1)
  })

  it('stops a streaming upload on an early response even when source cancellation never settles', async () => {
    let closed!: () => void
    const connectionClosed = new Promise<void>((resolve) => {
      closed = resolve
    })
    const endpoint = await listen((request, response) => {
      request.socket.once('close', closed)
      response.writeHead(413)
      response.end('early')
    })
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
      },
      cancel() {
        cancelled = true
        return new Promise<void>(() => {})
      }
    })
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body,
      duplex: 'half'
    }
    const response = await bounded(
      getSharedFetch()(new Request(endpoint, init))
    )
    expect(response.status).toBe(413)
    expect(await response.text()).toBe('early')
    expect(cancelled).toBe(true)
    await bounded(connectionClosed, 'connection close')
  })

  it('preserves redirect and null-body statuses without following another target', async () => {
    const paths: string[] = []
    const endpoint = await listen((request, response) => {
      paths.push(request.url ?? '')
      if (request.url === '/redirect') {
        response.writeHead(302, { location: endpoint + '/must-not-follow' })
        response.end('redirect')
      } else {
        response.writeHead(Number(request.url?.slice(1)))
        response.end()
      }
    })
    const redirect = await getSharedFetch()(
      new Request(endpoint + '/redirect'),
      { redirect: 'error' }
    )
    expect(redirect.status).toBe(302)
    expect(await redirect.text()).toBe('redirect')
    for (const status of [204, 205, 304]) {
      const response = await getSharedFetch()(
        new Request(endpoint + '/' + status)
      )
      expect(response.status).toBe(status)
      expect(response.body).toBe(null)
    }
    expect(paths).toEqual(['/redirect', '/204', '/205', '/304'])
  })

  it('rejects a failed Request source instead of sending an empty successful body', async () => {
    const endpoint = await listen((_request, response) =>
      response.end('unexpected')
    )
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('synthetic upload failure'))
      }
    })
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body,
      duplex: 'half'
    }
    await expect(
      bounded(getSharedFetch()(new Request(endpoint, init)))
    ).rejects.toThrow('synthetic upload failure')
  })

  it('retains admitted uncertainty after native cancellation while waiting for headers', async () => {
    let entered!: () => void
    const accepted = new Promise<void>((resolve) => {
      entered = resolve
    })
    const endpoint = await listen(() => entered())
    const outcomes: Array<Record<string, unknown>> = []
    admittedLoopback(endpoint, outcomes)
    const controller = new AbortController()
    const measured = captureProviderMetrics(async () => {
      const pending = providerFetch(
        'https://api-live.loki.snowprintstudios.com/player/player2/userId/Synthetic-Account',
        {
          method: 'POST',
          body: JSON.stringify({ synthetic: true }),
          signal: controller.signal
        },
        false,
        { purpose: 'session-connect', trigger: 'scheduled', timeoutMs: 5000 }
      )
      void pending.catch(() => undefined)
      await bounded(accepted)
      controller.abort()
      await expect(bounded(pending)).rejects.toBeInstanceOf(Error)
    })
    expect((await measured).metrics).toEqual({
      api_calls: 1,
      api_errors: 1,
      api_retry_count: 0
    })
    await vi.waitFor(() =>
      expect(outcomes.some((outcome) => outcome.settled === false)).toBe(true)
    )
    expect(outcomes.some((outcome) => outcome.settled === true)).toBe(false)
  })
})

it.each(['DELETE', 'OPTIONS'])(
  'frames an unknown-length %s Request body without corrupting the next request',
  async (method) => {
    const expected = new Uint8Array([0, 255, 128, 13, 10, 65])
    const seen: Array<{ method?: string; path?: string; bytes: Buffer }> = []
    const endpoint = await listen((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        seen.push({
          method: request.method,
          path: request.url,
          bytes: Buffer.concat(chunks)
        })
        response.end('ok')
      })
    })
    const fetchImpl = getSharedFetch()
    const response = await bounded(
      fetchImpl(new Request(endpoint + '/body', { method, body: expected }))
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(await (await fetchImpl(endpoint + '/next')).text()).toBe('ok')
    expect(seen).toEqual([
      { method, path: '/body', bytes: Buffer.from(expected) },
      { method: 'GET', path: '/next', bytes: Buffer.alloc(0) }
    ])
  }
)

const explicitRequestFraming: Array<Record<string, string>> = [
  { 'cOnTeNt-LeNgTh': '6' },
  { 'tRaNsFeR-EnCoDiNg': 'chunked' }
]

it.each(explicitRequestFraming)(
  'preserves caller-supplied Request framing %j',
  async (headers) => {
    const expected = new Uint8Array([0, 255, 128, 13, 10, 65])
    let received: Buffer | undefined
    const endpoint = await listen((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        received = Buffer.concat(chunks)
        response.end('ok')
      })
    })
    const input = new Request(endpoint, { method: 'DELETE', body: expected })
    const response = await bounded(getSharedFetch()(input, { headers }))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(received).toEqual(Buffer.from(expected))
  }
)
