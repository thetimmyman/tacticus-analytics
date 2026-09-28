import * as Sentry from '@sentry/nextjs'
import type { Log } from '@sentry/core'
import {
  createEnvelope,
  dsnFromString,
  getEnvelopeEndpointWithUrlEncodedAuth
} from '@sentry/core'
import { makeNodeTransport } from '@sentry/node'
import {
  sanitizeObservabilityValue,
  sanitizeSentryEvent
} from './app/lib/monitoring/sentry-privacy'

const primaryDsn = process.env.SENTRY_DSN
const backupDsn = process.env.GLITCHTIP_DSN
const dsns = [primaryDsn, backupDsn].filter(Boolean) as string[]
const dsn = primaryDsn || backupDsn
const tracesSampleRate = (() => {
  const parsed = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1')
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1
})()

function overrideEnvelopeDsn(envelope: any, dsnOverride: string): any {
  return createEnvelope(
    dsnOverride
      ? {
          ...envelope[0],
          dsn: dsnOverride
        }
      : envelope[0],
    envelope[1]
  )
}

function makeBestEffortFanoutTransport(
  createTransport: (options: any) => {
    send: (env: any) => PromiseLike<any>
    flush: (t?: number) => PromiseLike<any>
  },
  routingDsns: string[]
) {
  return (options: any) => {
    // The throwing `??` gives `primary` a definite type in the closures; only called with 2+ DSNs.
    const primary =
      routingDsns[0] ??
      (() => {
        throw new Error(
          'makeBestEffortFanoutTransport requires at least one DSN'
        )
      })()
    const primaryTransport = createTransport(options)
    const otherTransports: Map<
      string,
      ReturnType<typeof createTransport>
    > = new Map()

    function getTransport(dsnToUse: string) {
      if (dsnToUse === primary) {
        return primaryTransport
      }

      let transport = otherTransports.get(dsnToUse)
      if (!transport) {
        const validatedDsn = dsnFromString(dsnToUse)
        if (!validatedDsn) {
          return undefined
        }
        const url = getEnvelopeEndpointWithUrlEncodedAuth(
          validatedDsn,
          options.tunnel
        )
        transport = createTransport({ ...options, url })
        otherTransports.set(dsnToUse, transport)
      }
      return transport
    }

    async function send(envelope: any) {
      const primaryPromise = primaryTransport.send(
        overrideEnvelopeDsn(envelope, primary)
      )

      for (const secondary of routingDsns.slice(1)) {
        const secondaryTransport = getTransport(secondary)
        if (!secondaryTransport) continue
        // `send` returns PromiseLike, which has no `.catch`.
        void Promise.resolve(
          secondaryTransport.send(overrideEnvelopeDsn(envelope, secondary))
        ).catch(() => ({ statusCode: 0 }))
      }

      return primaryPromise
    }

    async function flush(timeout: number | undefined) {
      const all = [primaryTransport, ...otherTransports.values()]
      const results = await Promise.all(
        all.map((t) => Promise.resolve(t.flush(timeout)).catch(() => false))
      )
      return results.every(Boolean)
    }

    return {
      send,
      flush
    }
  }
}

Sentry.init({
  dsn,
  enabled:
    Boolean(dsn) &&
    (process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV) === 'production',
  transport:
    dsns.length > 1
      ? makeBestEffortFanoutTransport(makeNodeTransport, dsns)
      : undefined,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,

  tracesSampleRate,

  // Keep automatic user and request data out of telemetry.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false
  },

  // Structured logs bypass beforeSend, so redact here too and fail closed on errors.
  beforeSendLog(log: Log): Log | null {
    try {
      return sanitizeObservabilityValue(log) as Log
    } catch {
      return null
    }
  },

  beforeSend(event, hint) {
    const error = hint.originalException

    // A local production build passes the NODE_ENV gate, so drop loopback requests.
    const requestUrl = event.request?.url
    if (
      requestUrl &&
      /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(requestUrl)
    ) {
      return null
    }

    const exceptionType = event.exception?.values?.[0]?.type
    const exceptionValue = event.exception?.values?.[0]?.value || ''
    if (
      exceptionType === 'AbortError' ||
      exceptionValue.toLowerCase().includes('aborted') ||
      exceptionValue.includes('signal is aborted')
    ) {
      return null // Don't send to Sentry
    }

    if (error instanceof Error) {
      if (
        error.name === 'AbortError' ||
        error.message.toLowerCase().includes('aborted') ||
        error.message.includes('The operation was aborted')
      ) {
        return null // Don't send to Sentry
      }

      // Schema cache errors are temporary and resolve on retry.
      if (
        error.message.includes('schema cache') ||
        (error.message.includes('does not exist') &&
          error.message.includes('function'))
      ) {
        return null // Don't send to Sentry
      }

      if (
        error.message.includes('fetch failed') ||
        error.message.includes('failed to pipe response') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('socket hang up')
      ) {
        return null // Don't send to Sentry
      }

      if (
        error.message.includes('Invalid boss') ||
        error.message.includes('Invalid team') ||
        error.message.includes('VALIDATION')
      ) {
        return null // Don't send to Sentry
      }
    }

    return sanitizeSentryEvent(event)
  }
})
