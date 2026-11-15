import { captureRouterTransitionStart, init } from '@sentry/nextjs'
import { sanitizeSentryEvent } from './app/lib/monitoring/sentry-privacy'
import { hasTransientCause } from './app/lib/monitoring/transient-error'
import {
  consumeCapturedChunkReloadDuplicate,
  initChunkReloadListeners,
  isChunkLoadError,
  peekChunkReloadOutcome,
  recordProcessedChunkEvent
} from './app/lib/client/chunk-reload'
import { unwrapCapturedOriginalException } from './app/lib/monitoring/sentry'

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

// A browser extension's injected page script is always named inpage.js; the app ships no such file.
const isExtensionInpageFrame = (filename: string | undefined): boolean =>
  typeof filename === 'string' &&
  !filename.includes('/_next/') &&
  /(?:^|\/)inpage\.js(?:[?#].*)?$/.test(filename)

/** True only when every frame of every exception in the chain is an extension inpage script. */
export function isExtensionInpageEvent(event: {
  exception?: {
    values?: Array<{ stacktrace?: { frames?: Array<{ filename?: string }> } }>
  }
}): boolean {
  const values = event.exception?.values
  if (!values || values.length === 0) return false
  return values.every((v) => {
    const frames = v.stacktrace?.frames
    return (
      Array.isArray(frames) &&
      frames.length > 0 &&
      frames.every((f) => isExtensionInpageFrame(f.filename))
    )
  })
}

const BROWSER_NETWORK_FETCH_ERROR_MESSAGE_PATTERN =
  /^(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/iu

function isChunkLoadErrorEvent(
  event: {
    exception?: {
      values?: Array<{
        type?: string
        value?: string
      }>
    }
  },
  error: unknown
): boolean {
  if (isChunkLoadError(error)) {
    return true
  }
  const values = event.exception?.values
  if (!values || values.length === 0) {
    return false
  }
  return values.some((v) => v.type === 'ChunkLoadError')
}

function isBrowserNetworkFetchTypeError(error: Error): boolean {
  if (error.name !== 'TypeError' || isChunkLoadError(error)) {
    return false
  }
  return BROWSER_NETWORK_FETCH_ERROR_MESSAGE_PATTERN.test(error.message.trim())
}

// Register chunk listeners before init() so tagged captures run ahead of Sentry global handlers.
initChunkReloadListeners()

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

    // An error raised entirely inside an extension's injected script is not ours.
    if (isExtensionInpageEvent(event)) {
      return null
    }

    // Keep lock timeouts as one fingerprinted warning issue, not an error.
    if (isProcessLockTimeoutEvent(event)) {
      event.level = 'warning'
      event.fingerprint = ['supabase-auth-processlock-timeout']
      return sanitizeSentryEvent(event)
    }

    // Classify chunk reload telemetry without dropping the sole SDK capture when
    // Sentry global handlers catch an error before handleChunkLoadError runs.
    const existingChunkReloadTag = (
      event.tags as Record<string, unknown> | undefined
    )?.chunk_reload
    const isChunkEvent = isChunkLoadErrorEvent(event, error)
    const mechanismType = event.exception?.values?.[0]?.mechanism?.type
    const isGlobalHandler =
      mechanismType === 'auto.browser.global_handlers.onunhandledrejection' ||
      mechanismType === 'auto.browser.global_handlers.onerror'

    if (isChunkEvent || typeof existingChunkReloadTag === 'string') {
      const chunkErrorKey = unwrapCapturedOriginalException(error)

      if (
        existingChunkReloadTag === undefined &&
        isGlobalHandler &&
        consumeCapturedChunkReloadDuplicate(chunkErrorKey, 'tagged')
      ) {
        return null
      }

      if (
        typeof existingChunkReloadTag === 'string' &&
        consumeCapturedChunkReloadDuplicate(chunkErrorKey, 'global')
      ) {
        return null
      }

      const resolvedChunkReloadTag =
        typeof existingChunkReloadTag === 'string'
          ? existingChunkReloadTag
          : isGlobalHandler
            ? peekChunkReloadOutcome(chunkErrorKey)
            : undefined

      if (resolvedChunkReloadTag !== undefined) {
        event.tags = {
          ...(event.tags as Record<string, unknown> | undefined),
          chunk_reload: resolvedChunkReloadTag
        }
      }

      const eventSource =
        typeof existingChunkReloadTag === 'string' ? 'tagged' : 'global'

      if (resolvedChunkReloadTag === 'attempted') {
        recordProcessedChunkEvent(chunkErrorKey, eventSource)
        event.level = 'warning'
        event.fingerprint = ['client-chunk-reload-attempted']
        return sanitizeSentryEvent(event)
      }

      if (resolvedChunkReloadTag === 'suppressed') {
        recordProcessedChunkEvent(chunkErrorKey, eventSource)
        return sanitizeSentryEvent(event)
      }
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

      if (
        /invalid signature|permission denied|access denied|unauthorized|forbidden/i.test(
          error.message
        )
      ) {
        return sanitizeSentryEvent(event)
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
        error.message.includes('socket hang up') ||
        isBrowserNetworkFetchTypeError(error)
      ) {
        return null
      }

      // A transient failure behind a fail-closed wrapper is the same event.
      if (hasTransientCause(error)) {
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

export const onRouterTransitionStart = captureRouterTransitionStart
