import { captureRouterTransitionStart, init } from '@sentry/nextjs'
import { sanitizeSentryEvent } from './app/lib/monitoring/sentry-privacy'
import { initChunkReloadListeners } from './app/lib/client/chunk-reload'

const dsn =
  process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.NEXT_PUBLIC_GLITCHTIP_DSN

const parseSampleRate = (raw: string | undefined, fallback: number) => {
  const parsed = Number(raw ?? fallback)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : fallback
}

const tracesSampleRate = parseSampleRate(
  process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ??
    process.env.SENTRY_TRACES_SAMPLE_RATE,
  0.1
)
// auth-js processLock acquire timeout. The SDK swallows its own background
// refresh timeouts, so one reaching Sentry is a real stalled user-facing call.
export const isProcessLockTimeout = (name: string, message: string): boolean =>
  /processlockacquiretimeout/i.test(name) ||
  (/acquiring .*lock/i.test(message) && /timed out/i.test(message))

/** True only when the whole exception chain is the lock timeout; a wrapping real error keeps its severity. */
export function isProcessLockTimeoutEvent(event: {
  exception?: { values?: Array<{ type?: string; value?: string }> }
}): boolean {
  const values = event.exception?.values
  if (!values || values.length === 0) return false
  return values.every((v) => isProcessLockTimeout(v.type ?? '', v.value ?? ''))
}

const sentryEnabled =
  process.env.NEXT_PUBLIC_RUNTIME_PROFILE !== 'desktop' &&
  Boolean(dsn) &&
  (process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV) === 'production'
init({
  dsn,
  enabled: sentryEnabled,
  // Local tunnel so the server fans envelopes out to Sentry and GlitchTip.
  tunnel: '/monitoring',
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_BUILD_SHA,
  tracesSampleRate,
  // Session Replay is deliberately excluded.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Keep automatic user and request data out of browser telemetry.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false
  },

  beforeSend(event, hint) {
    const error = hint.originalException

    // AbortErrors are expected; check metadata first (a DOMException may fail instanceof Error).
    const exceptionType = event.exception?.values?.[0]?.type
    const exceptionValue = event.exception?.values?.[0]?.value || ''
    if (
      exceptionType === 'AbortError' ||
      exceptionValue.toLowerCase().includes('aborted') ||
      exceptionValue.includes('signal is aborted')
    ) {
      return null
    }

    // Keep lock timeouts as one fingerprinted warning issue, not an error.
    if (isProcessLockTimeoutEvent(event)) {
      event.level = 'warning'
      event.fingerprint = ['supabase-auth-processlock-timeout']
      return sanitizeSentryEvent(event)
    }

    if (error instanceof Error) {
      if (
        error.name === 'AbortError' ||
        error.message.toLowerCase().includes('aborted') ||
        error.message.includes('The operation was aborted') ||
        error.message.includes('signal is aborted')
      ) {
        return null
      }

      // Schema cache errors are temporary and resolve on retry.
      if (
        error.message.includes('schema cache') ||
        (error.message.includes('does not exist') &&
          error.message.includes('function'))
      ) {
        return null
      }

      if (
        error.message.includes('fetch failed') ||
        error.message.includes('failed to pipe response') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('socket hang up')
      ) {
        return null
      }

      // Boss/team validation errors are user input errors.
      if (
        error.message.includes('Invalid boss') ||
        error.message.includes('Invalid team') ||
        error.message.includes('VALIDATION')
      ) {
        return null
      }
    }

    return sanitizeSentryEvent(event)
  }
})

// One guarded reload recovers from stale chunks after a deploy.
initChunkReloadListeners()

export const onRouterTransitionStart = captureRouterTransitionStart
