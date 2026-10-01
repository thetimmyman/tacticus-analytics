import { randomBytes } from 'node:crypto'
import { createServer, type Server, type RequestListener } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSharedFetch } from '@/app/lib/network/undici-agent'

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
  if (!server) return
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
