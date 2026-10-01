type PendingRequest<T> = Promise<T>
type RequestKey = string

const pendingRequests = new Map<RequestKey, PendingRequest<unknown>>()

export function deduplicateRequest<T>(
  key: RequestKey,
  requestFn: () => Promise<T>,
  ttl: number = 5000 // 5 second deduplication window
): Promise<T> {
  const existing = pendingRequests.get(key) as PendingRequest<T> | undefined

  if (existing) {
    return existing
  }

  const promise = requestFn()

  pendingRequests.set(key, promise)

  const cleanup = () => {
    pendingRequests.delete(key)
  }

  const timeoutId = setTimeout(cleanup, ttl)

  promise
    .then(cleanup)
    .catch(cleanup)
    .finally(() => clearTimeout(timeoutId))

  return promise
}

export function createRequestKey(
  operation: string,
  params: Record<string, unknown> = {}
): RequestKey {
  const paramString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${JSON.stringify(params[key])}`)
    .join('&')

  return paramString ? `${operation}?${paramString}` : operation
}

export function clearPendingRequests(): void {
  pendingRequests.clear()
}

export function getPendingRequestStats(): {
  count: number
  keys: string[]
} {
  return {
    count: pendingRequests.size,
    keys: Array.from(pendingRequests.keys())
  }
}
