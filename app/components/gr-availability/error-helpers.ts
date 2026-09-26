const extractStructuredErrorMessage = (
  payload: unknown
): string | undefined => {
  if (!payload || typeof payload !== 'object') {
    return undefined
  }

  const base = payload as Record<string, unknown>
  const fields = ['error', 'details', 'message'] as const

  for (const field of fields) {
    const value = base[field]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  if (!Array.isArray(base.errors) || base.errors.length === 0) {
    return undefined
  }

  const firstError = base.errors[0]
  if (typeof firstError === 'string' && firstError.trim().length > 0) {
    return firstError.trim()
  }
  if (
    firstError &&
    typeof firstError === 'object' &&
    'message' in firstError &&
    typeof (firstError as { message?: unknown }).message === 'string'
  ) {
    const message = (firstError as { message?: string }).message
    if (message && message.trim().length > 0) {
      return message.trim()
    }
  }

  return undefined
}

// Not app/lib/utils/error-message.ts's extractErrorMessage and must not delegate:
// callers rely on AppError envelopes falling through to their `fallback`
// (pinned in tests/components/GRAvailability.test.tsx).
export const extractErrorMessage = (
  payload: unknown,
  fallback: string
): string => {
  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    // HTML error pages (e.g. Cloudflare 502) return the fallback.
    if (
      !trimmed ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<html') ||
      trimmed.includes('<head>')
    ) {
      return fallback
    }
    return trimmed
  }

  return extractStructuredErrorMessage(payload) ?? fallback
}

export const getErrorMessage = (
  payload: unknown,
  fallback = 'Unknown error'
): string => {
  if (typeof payload === 'string') {
    return payload.trim() || fallback
  }

  return extractStructuredErrorMessage(payload) ?? fallback
}
