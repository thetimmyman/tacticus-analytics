interface CacheEntry<T> {
  data: T
  timestamp: number
}

class SimpleCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private ttl: number

  constructor(ttlMs: number = 5 * 60 * 1000) {
    this.ttl = ttlMs
  }

  get(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      return null
    }

    return entry.data
  }

  set(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    })

    if (this.cache.size > 100) {
      const oldestKeys = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 20)
        .map(([key]) => key)

      oldestKeys.forEach((key) => this.cache.delete(key))
    }
  }

  clear(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }
}

export function memoize<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: {
    ttl?: number // Time to live in ms
    keyGenerator?: (...args: Parameters<T>) => string
  } = {}
): T {
  const cache = new SimpleCache<Awaited<ReturnType<T>>>(options.ttl)

  const generateKey =
    options.keyGenerator ||
    ((...args) => {
      try {
        return JSON.stringify(args)
      } catch {
        return args.map((arg) => String(arg)).join(':')
      }
    })

  return (async (...args: Parameters<T>) => {
    const key = generateKey(...args)

    const cached = cache.get(key)
    if (cached !== null) {
      return cached
    }

    const result = await fn(...args)
    cache.set(key, result)

    return result
  }) as T
}

export function memoizeSync<T extends (...args: any[]) => any>(
  fn: T,
  options: {
    ttl?: number
    keyGenerator?: (...args: Parameters<T>) => string
  } = {}
): T {
  const cache = new SimpleCache<ReturnType<T>>(options.ttl)

  const generateKey =
    options.keyGenerator ||
    ((...args) => {
      try {
        return JSON.stringify(args)
      } catch {
        return args.map((arg) => String(arg)).join(':')
      }
    })

  return ((...args: Parameters<T>) => {
    const key = generateKey(...args)

    const cached = cache.get(key)
    if (cached !== null) {
      return cached
    }

    const result = fn(...args)
    cache.set(key, result)

    return result
  }) as T
}

export { SimpleCache }
