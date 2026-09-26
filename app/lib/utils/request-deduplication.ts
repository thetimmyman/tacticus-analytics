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

/** Batches ids into one fetcher call, deduplicating in-flight fetches. */
export function createBatchedFetcher<T>(
  fetcher: (ids: string[]) => Promise<Map<string, T>>,
  options: {
    batchSize?: number
    batchDelay?: number
  } = {}
) {
  const batchSize = options.batchSize ?? 10
  const batchDelay = options.batchDelay ?? 50
  let batch: Array<{
    key: string
    resolve: (value: T) => void
    reject: (error: unknown) => void
  }> = []
  let timer: NodeJS.Timeout | null = null

  const processBatch = async () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    const currentBatch = batch
    batch = []
    if (currentBatch.length === 0) return

    try {
      const keys = currentBatch.map((item) => item.key)
      const results = await fetcher(keys)
      currentBatch.forEach(({ key, resolve, reject }) => {
        const result = results.get(key)
        if (result !== undefined) {
          resolve(result)
        } else {
          reject(new Error(`No result for key: ${key}`))
        }
      })
    } catch (error) {
      currentBatch.forEach(({ reject }) => reject(error))
    }
  }

  const scheduleBatch = () => {
    if (timer) return
    timer = setTimeout(processBatch, batchDelay)
  }

  const queueRequest = (key: string): Promise<T> =>
    new Promise((resolve, reject) => {
      batch.push({ key, resolve, reject })
      if (batch.length >= batchSize) {
        void processBatch()
      } else {
        scheduleBatch()
      }
    })

  return {
    fetch: (id: string) =>
      deduplicateRequest(`batch:${id}`, () => queueRequest(id)),
    fetchDirect: (id: string) =>
      deduplicateRequest(`direct:${id}`, async () => {
        const map = await fetcher([id])
        const result = map.get(id)
        if (result === undefined) {
          throw new Error(`No result for id: ${id}`)
        }
        return result
      })
  }
}

export function createCachedFetcher<T>(
  fetcher: (key: string) => Promise<T>,
  options: {
    cacheKey: (key: string) => string
    ttl?: number
    cache?: Map<string, { value: T; expiry: number }>
  }
) {
  const cache = options.cache ?? new Map<string, { value: T; expiry: number }>()
  const ttl = options.ttl ?? 60000

  return async (key: string): Promise<T> => {
    const cacheKey = options.cacheKey(key)
    const cached = cache.get(cacheKey)
    if (cached && cached.expiry > Date.now()) {
      return cached.value
    }

    const value = await deduplicateRequest(cacheKey, () => fetcher(key))
    cache.set(cacheKey, { value, expiry: Date.now() + ttl })
    return value
  }
}

export function createThrottledFetcher<T>(
  fetcher: (key: string) => Promise<T>,
  maxConcurrent: number = 5
) {
  let activeCount = 0
  const queue: Array<() => void> = []

  const processQueue = () => {
    while (queue.length > 0 && activeCount < maxConcurrent) {
      const next = queue.shift()
      if (next) next()
    }
  }

  return (key: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const execute = async () => {
        activeCount++
        try {
          const result = await fetcher(key)
          resolve(result)
        } catch (error) {
          reject(error)
        } finally {
          activeCount--
          processQueue()
        }
      }

      if (activeCount < maxConcurrent) {
        void execute()
      } else {
        queue.push(execute)
      }
    })
}
