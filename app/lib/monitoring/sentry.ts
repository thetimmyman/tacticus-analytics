import {
  captureException as sentryCaptureException,
  captureMessage as sentryCaptureMessage,
  getClient
} from '@sentry/nextjs'
import {
  redactObservabilityText,
  sanitizeObservabilityValue
} from './sentry-privacy'

interface CaptureContext {
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  level?: 'error' | 'warning' | 'info' | 'debug' | 'fatal'
}

const SENTRY_CONFIGURED = Boolean(
  process.env.SENTRY_DSN ||
  process.env.NEXT_PUBLIC_SENTRY_DSN ||
  process.env.GLITCHTIP_DSN ||
  process.env.NEXT_PUBLIC_GLITCHTIP_DSN
)

const hasClient = (): boolean => {
  try {
    return Boolean(getClient())
  } catch {
    return false
  }
}

export const isSentryEnabled = (): boolean => SENTRY_CONFIGURED && hasClient()

type NonErrorLike =
  | { message?: string | null; name?: string | null }
  | string
  | number
  | boolean
  | null
  | undefined

function serializeNonError(value: NonErrorLike): string {
  try {
    const json =
      typeof value === 'string'
        ? value
        : JSON.stringify(sanitizeObservabilityValue(value))
    const text = json ?? String(value)
    const safeText = redactObservabilityText(text)
    return safeText.length > 2000 ? `${safeText.slice(0, 2000)}…` : safeText
  } catch {
    return redactObservabilityText(String(value))
  }
}

/** Wraps a non-Error so Sentry does not title it "Non-error exception captured". */
function normalizeNonError(value: NonErrorLike): Error {
  const shaped = typeof value === 'object' && value !== null ? value : undefined
  const err = new Error('Application error')
  err.name =
    shaped?.name != null
      ? redactObservabilityText(String(shaped.name))
      : 'NonError'
  return err
}

export function captureSentryException(
  error: unknown,
  context?: CaptureContext
): void {
  if (!isSentryEnabled()) return
  try {
    const safeContext = sanitizeObservabilityValue(context) as
      CaptureContext | undefined
    if (error instanceof Error) {
      // Pass the original so beforeSend can classify it; sanitizeSentryEvent scrubs the event afterwards.
      sentryCaptureException(error, {
        level: safeContext?.level,
        tags: safeContext?.tags,
        extra: safeContext?.extra
      })
      return
    }
    const nonError = error as NonErrorLike
    sentryCaptureException(normalizeNonError(nonError), {
      level: safeContext?.level,
      tags: safeContext?.tags,
      extra: {
        ...safeContext?.extra,
        nonErrorValue: serializeNonError(nonError)
      }
    })
  } catch {
    // Capture failures are swallowed.
  }
}

export function captureSentryMessage(
  message: string,
  context?: CaptureContext
): void {
  if (!isSentryEnabled()) return
  try {
    const safeContext = sanitizeObservabilityValue(context) as
      CaptureContext | undefined
    sentryCaptureMessage(redactObservabilityText(message), {
      level: safeContext?.level,
      tags: safeContext?.tags,
      extra: safeContext?.extra
    })
  } catch {
    // Capture failures are swallowed.
  }
}
