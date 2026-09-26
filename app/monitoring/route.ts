import {
  createEnvelope,
  dsnFromString,
  getEnvelopeEndpointWithUrlEncodedAuth
} from '@sentry/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FORWARD_TIMEOUT_MS = 5000
export const MAX_ENVELOPE_BYTES = 1024 * 1024

async function readEnvelopeWithLimit(request: Request): Promise<Uint8Array> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength)
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_ENVELOPE_BYTES
    ) {
      throw new RangeError('Monitoring envelope exceeds the byte limit')
    }
  }

  if (!request.body) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_ENVELOPE_BYTES) {
        await reader.cancel('Monitoring envelope exceeds the byte limit')
        throw new RangeError('Monitoring envelope exceeds the byte limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const envelope = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    envelope.set(chunk, offset)
    offset += chunk.byteLength
  }
  return envelope
}

function getPrimaryDsn(): string | undefined {
  return (
    process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || undefined
  )
}

function getBackupDsn(): string | undefined {
  return (
    process.env.GLITCHTIP_DSN ||
    process.env.NEXT_PUBLIC_GLITCHTIP_DSN ||
    undefined
  )
}

function buildEnvelopeEndpoint(dsn: string): string | undefined {
  const validated = dsnFromString(dsn)
  if (!validated) return undefined
  return getEnvelopeEndpointWithUrlEncodedAuth(validated, undefined)
}

function overrideEnvelopeDsn(
  envelope: Uint8Array,
  dsnOverride: string
): Uint8Array {
  if (!dsnOverride) return envelope

  // Rewrite the header's `dsn` so each target accepts the envelope for its project.
  const newlineIdx = envelope.indexOf(0x0a) // \n
  if (newlineIdx === -1) return envelope

  const headerEnd =
    newlineIdx > 0 && envelope[newlineIdx - 1] === 0x0d
      ? newlineIdx - 1
      : newlineIdx // preserve CRLF
  const headerBytes = envelope.slice(0, headerEnd)
  const rest = envelope.slice(headerEnd)

  try {
    const header = JSON.parse(
      Buffer.from(headerBytes).toString('utf8').trim()
    ) as Record<string, unknown>
    const newHeader = createEnvelope(
      {
        ...header,
        dsn: dsnOverride
      },
      []
    )[0]

    const newHeaderLine = Buffer.from(JSON.stringify(newHeader), 'utf8')
    return Buffer.concat([newHeaderLine, Buffer.from(rest)])
  } catch {
    return envelope
  }
}

async function forwardEnvelope({
  url,
  body,
  requestHeaders,
  signal
}: {
  url: string
  body: Uint8Array
  requestHeaders: Headers
  signal: AbortSignal
}): Promise<{
  statusCode: number
  rateLimits: string | null
  retryAfter: string | null
}> {
  const headers: Record<string, string> = {
    'content-type':
      requestHeaders.get('content-type') || 'application/x-sentry-envelope'
  }

  const contentEncoding = requestHeaders.get('content-encoding')
  if (contentEncoding) headers['content-encoding'] = contentEncoding

  // `buffer` may expose a larger backing store; forward the exact slice.
  const requestBody = body.slice()

  const res = await fetch(url, {
    method: 'POST',
    body: requestBody,
    headers,
    signal
  })

  return {
    statusCode: res.status,
    rateLimits: res.headers.get('X-Sentry-Rate-Limits'),
    retryAfter: res.headers.get('Retry-After')
  }
}

async function forwardEnvelopeWithTimeout(args: {
  url: string
  body: Uint8Array
  requestHeaders: Headers
}): Promise<{
  statusCode: number
  rateLimits: string | null
  retryAfter: string | null
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS)
  try {
    return await forwardEnvelope({ ...args, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export function GET(): Response {
  return new Response('ok', { status: 200 })
}

export async function POST(request: Request): Promise<Response> {
  const primaryDsn = getPrimaryDsn()
  const backupDsn = getBackupDsn()

  if (!primaryDsn && !backupDsn) {
    return new Response('Sentry DSN not configured', { status: 404 })
  }

  let rawBody: Uint8Array
  try {
    rawBody = await readEnvelopeWithLimit(request)
  } catch (error) {
    if (error instanceof RangeError) {
      return new Response('Monitoring envelope is too large', { status: 413 })
    }
    return new Response('Invalid monitoring envelope', { status: 400 })
  }

  const primaryUrl = primaryDsn ? buildEnvelopeEndpoint(primaryDsn) : undefined
  const backupUrl = backupDsn ? buildEnvelopeEndpoint(backupDsn) : undefined

  if (!primaryUrl && !backupUrl) {
    return new Response('Invalid DSN configuration', { status: 500 })
  }

  try {
    const primaryPromise = primaryUrl
      ? forwardEnvelopeWithTimeout({
          url: primaryUrl,
          body: overrideEnvelopeDsn(rawBody, primaryDsn!),
          requestHeaders: request.headers
        })
      : Promise.resolve({ statusCode: 200, rateLimits: null, retryAfter: null })

    // Best-effort backup; never blocks or fails the request.
    if (backupUrl) {
      void forwardEnvelopeWithTimeout({
        url: backupUrl,
        body: overrideEnvelopeDsn(rawBody, backupDsn!),
        requestHeaders: request.headers
      }).catch(() => undefined)
    }

    const primary = await primaryPromise

    const resHeaders: Record<string, string> = {}
    if (primary.rateLimits)
      resHeaders['X-Sentry-Rate-Limits'] = primary.rateLimits
    if (primary.retryAfter) resHeaders['Retry-After'] = primary.retryAfter

    return new Response('', {
      status: primary.statusCode || 200,
      headers: resHeaders
    })
  } catch {
    // Hide tunnel failures from users; the SDK retries.
    return new Response('', { status: 200 })
  }
}
