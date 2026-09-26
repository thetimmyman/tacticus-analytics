/** User-facing message from any error response shape; never "[object Object]". */
export function extractErrorMessage(
  errorData: unknown,
  fallback = 'An error occurred'
): string {
  if (errorData == null) {
    return fallback
  }

  if (typeof errorData === 'string') {
    // HTML error pages (e.g. a proxy 502) fall back instead of showing raw HTML.
    if (
      !errorData ||
      errorData.trimStart().startsWith('<!DOCTYPE') ||
      errorData.trimStart().startsWith('<html') ||
      errorData.includes('<head>')
    ) {
      return fallback
    }
    return errorData
  }

  if (errorData instanceof Error) {
    return errorData.message || fallback
  }

  if (typeof errorData !== 'object') {
    return fallback
  }

  const data = errorData as Record<string, unknown>

  if (typeof data.error === 'string') {
    return data.error || fallback
  }

  if (
    typeof data.error === 'object' &&
    data.error !== null &&
    'message' in data.error
  ) {
    const errorObj = data.error as Record<string, unknown>
    if (typeof errorObj.message === 'string') {
      return errorObj.message || fallback
    }
    if (typeof errorObj.details === 'string') {
      return errorObj.details
    }
  }

  if (typeof data.message === 'string') {
    return data.message || fallback
  }

  if (typeof data.details === 'string') {
    return data.details || fallback
  }

  if (typeof data.reason === 'string') {
    return data.reason || fallback
  }

  return fallback
}

// Deliberately minimal (no object extraction, no HTML suppression): the output
// is persisted to work_queue.last_error and callers depend on it verbatim.
export function coerceErrorMessage(
  error: unknown,
  fallback = 'Unknown error'
): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return fallback
}
