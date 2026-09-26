import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dsnFromString,
  getEnvelopeEndpointWithUrlEncodedAuth
} from '@sentry/core'

const PRIMARY_DSN =
  'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@example.sentry.io/123456'
const BACKUP_DSN =
  'https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@glitchtip.local/654321'

const createEnvelopePayload = () =>
  [
    '{"dsn":"https://legacy-key@example.invalid/1","sent_at":"2026-02-13T00:00:00.000Z"}',
    '{"type":"event"}',
    '{"message":"monitoring route test"}'
  ].join('\n')

const toExpectedEndpoint = (dsn: string) => {
  const parsed = dsnFromString(dsn)
  if (!parsed) throw new Error(`Invalid test DSN: ${dsn}`)
  return getEnvelopeEndpointWithUrlEncodedAuth(parsed, undefined)
}

const bodyToUtf8 = (body: unknown): string => {
  if (typeof body === 'string') return body
  if (!body) return ''
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8')
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString(
      'utf8'
    )
  }
  return String(body)
}

describe('/monitoring route fanout', () => {
  let GET: () => Response
  let POST: (request: Request) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()

    delete process.env.SENTRY_DSN
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    delete process.env.GLITCHTIP_DSN
    delete process.env.NEXT_PUBLIC_GLITCHTIP_DSN

    const routeModule = await import('@/app/monitoring/route')
    GET = routeModule.GET
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns ok from GET healthcheck', () => {
    const response = GET()
    expect(response.status).toBe(200)
  })

  it('returns 404 when no DSN is configured', async () => {
    const response = await POST(
      new Request('http://localhost/monitoring', {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body: createEnvelopePayload()
      })
    )

    expect(response.status).toBe(404)
  })

  it('returns 500 for invalid DSN configuration', async () => {
    vi.stubEnv('SENTRY_DSN', 'not-a-valid-dsn')

    const response = await POST(
      new Request('http://localhost/monitoring', {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body: createEnvelopePayload()
      })
    )

    expect(response.status).toBe(500)
  })

  it('rejects a declared oversized envelope before forwarding', async () => {
    vi.stubEnv('SENTRY_DSN', PRIMARY_DSN)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as typeof fetch)

    const request = new Request('http://localhost/monitoring', {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope' },
      body: createEnvelopePayload()
    })
    request.headers.set('content-length', String(1024 * 1024 + 1))

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an oversized envelope when content-length is omitted', async () => {
    vi.stubEnv('SENTRY_DSN', PRIMARY_DSN)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as typeof fetch)

    const response = await POST(
      new Request('http://localhost/monitoring', {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body: 'x'.repeat(1024 * 1024 + 1)
      })
    )

    expect(response.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards to both primary and backup DSNs and preserves primary response metadata', async () => {
    vi.stubEnv('SENTRY_DSN', PRIMARY_DSN)
    vi.stubEnv('GLITCHTIP_DSN', BACKUP_DSN)

    const primaryUrl = toExpectedEndpoint(PRIMARY_DSN)
    const backupUrl = toExpectedEndpoint(BACKUP_DSN)

    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url) === primaryUrl) {
        return {
          status: 202,
          headers: new Headers({
            'X-Sentry-Rate-Limits': '120:error:organization',
            'Retry-After': '120'
          })
        } as Response
      }

      if (String(url) === backupUrl) {
        return {
          status: 200,
          headers: new Headers()
        } as Response
      }

      throw new Error(`Unexpected URL: ${String(url)}`)
    })
    vi.stubGlobal('fetch', fetchMock as typeof fetch)

    const response = await POST(
      new Request('http://localhost/monitoring', {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body: createEnvelopePayload()
      })
    )

    expect(response.status).toBe(202)
    expect(response.headers.get('X-Sentry-Rate-Limits')).toBe(
      '120:error:organization'
    )
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const primaryCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === primaryUrl
    )
    const backupCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === backupUrl
    )

    expect(primaryCall).toBeDefined()
    expect(backupCall).toBeDefined()

    const primaryHeaderLine = bodyToUtf8(primaryCall?.[1]?.body).split(
      /\r?\n/,
      1
    )[0]
    const backupHeaderLine = bodyToUtf8(backupCall?.[1]?.body).split(
      /\r?\n/,
      1
    )[0]

    expect(JSON.parse(primaryHeaderLine).dsn).toBe(PRIMARY_DSN)
    expect(JSON.parse(backupHeaderLine).dsn).toBe(BACKUP_DSN)
  })

  it('keeps request successful when backup forwarding fails', async () => {
    vi.stubEnv('SENTRY_DSN', PRIMARY_DSN)
    vi.stubEnv('GLITCHTIP_DSN', BACKUP_DSN)

    const primaryUrl = toExpectedEndpoint(PRIMARY_DSN)
    const backupUrl = toExpectedEndpoint(BACKUP_DSN)

    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url) === primaryUrl) {
        return { status: 201, headers: new Headers() } as Response
      }
      if (String(url) === backupUrl) {
        throw new Error('backup offline')
      }
      throw new Error(`Unexpected URL: ${String(url)}`)
    })
    vi.stubGlobal('fetch', fetchMock as typeof fetch)

    const response = await POST(
      new Request('http://localhost/monitoring', {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body: createEnvelopePayload()
      })
    )

    expect(response.status).toBe(201)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails open with 200 when primary forwarding throws', async () => {
    vi.stubEnv('SENTRY_DSN', PRIMARY_DSN)

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(
          new Error('network timeout')
        ) as unknown as typeof fetch
    )

    const response = await POST(
      new Request('http://localhost/monitoring', {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body: createEnvelopePayload()
      })
    )

    expect(response.status).toBe(200)
  })

  it('uses backup DSN as the only destination when primary is not configured', async () => {
    vi.stubEnv('GLITCHTIP_DSN', BACKUP_DSN)

    const backupUrl = toExpectedEndpoint(BACKUP_DSN)
    const fetchMock = vi.fn().mockResolvedValue({
      status: 204,
      headers: new Headers()
    } as Response)
    vi.stubGlobal('fetch', fetchMock as typeof fetch)

    const response = await POST(
      new Request('http://localhost/monitoring', {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body: createEnvelopePayload()
      })
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(backupUrl)
  })
})
