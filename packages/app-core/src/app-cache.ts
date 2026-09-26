/**
 * Distributed cache (Redis via ioredis, or Upstash REST) with an in-memory fallback.
 * ioredis is Node-only: loaded via createRequire, since computed requires fail under Turbopack.
 */

import 'server-only'
import { createRequire } from 'node:module'
import { Redis } from '@upstash/redis'
import { legacyConsoleLogger as logger } from './logger'

// Turbopack runs this module as ESM, so synthesize a require bound to this file.
const nodeRequire = createRequire(import.meta.url)

type IORedisClient = import('ioredis').Redis

type CacheValue = { value: unknown; expires: number }

export interface FixedWindowHit {
  count: number
  ttlSeconds: number
}

interface CacheBackend {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>
  setNx(key: string, value: unknown, ttlSeconds: number): Promise<boolean>
  /**
   * Atomic fixed-window counter (INCR + guaranteed TTL; get + set races across replicas). Null only
   * when a distributed backend errored, so each limiter picks fail-open or fail-closed.
   */
  incrFixedWindow(
    key: string,
    windowSeconds: number
  ): Promise<FixedWindowHit | null>
  del(key: string): Promise<void>
  flush(): Promise<void>
  keyCount(): Promise<number>
}

// Single atomic script: INCR, set the expiry on first creation or lost TTL.
const INCR_FIXED_WINDOW_LUA = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`

class InMemoryCache implements CacheBackend {
  private cache = new Map<string, CacheValue>()

  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now()
    const item = this.cache.get(key)

    if (!item) {
      logger.debug('App cache miss (in-memory)', {
        operation: 'get',
        keyPrefix: key.split(':')[0],
        latencyMs: Date.now() - startTime,
        result: 'miss'
      })
      return null
    }

    if (Date.now() > item.expires) {
      this.cache.delete(key)
      logger.debug('App cache expired (in-memory)', {
        operation: 'get',
        keyPrefix: key.split(':')[0],
        latencyMs: Date.now() - startTime,
        result: 'expired'
      })
      return null
    }

    logger.debug('App cache hit (in-memory)', {
      operation: 'get',
      keyPrefix: key.split(':')[0],
      latencyMs: Date.now() - startTime,
      result: 'hit'
    })
    return item.value as T
  }

  async set(
    key: string,
    value: unknown,
    ttlSeconds: number = 300
  ): Promise<void> {
    const startTime = Date.now()
    const expires = Date.now() + ttlSeconds * 1000
    this.cache.set(key, { value, expires })

    logger.debug('App cache set (in-memory)', {
      operation: 'set',
      keyPrefix: key.split(':')[0],
      latencyMs: Date.now() - startTime,
      result: 'success',
      ttlSeconds
    })
  }

  async setNx(
    key: string,
    value: unknown,
    ttlSeconds: number
  ): Promise<boolean> {
    const item = this.cache.get(key)
    if (item && Date.now() < item.expires) return false
    const expires = Date.now() + ttlSeconds * 1000
    this.cache.set(key, { value, expires })
    return true
  }

  async incrFixedWindow(
    key: string,
    windowSeconds: number
  ): Promise<FixedWindowHit> {
    // Single-threaded JS: nothing to interleave within a process. Never null.
    const now = Date.now()
    const item = this.cache.get(key)
    if (!item || now > item.expires || typeof item.value !== 'number') {
      this.cache.set(key, { value: 1, expires: now + windowSeconds * 1000 })
      return { count: 1, ttlSeconds: windowSeconds }
    }
    const count = item.value + 1
    item.value = count
    return {
      count,
      ttlSeconds: Math.max(1, Math.ceil((item.expires - now) / 1000))
    }
  }

  async del(key: string): Promise<void> {
    const startTime = Date.now()
    this.cache.delete(key)

    logger.debug('App cache delete (in-memory)', {
      operation: 'del',
      keyPrefix: key.split(':')[0],
      latencyMs: Date.now() - startTime,
      result: 'success'
    })
  }

  async flush(): Promise<void> {
    const startTime = Date.now()
    this.cache.clear()

    logger.debug('App cache flush (in-memory)', {
      operation: 'flush',
      keyPrefix: 'all',
      latencyMs: Date.now() - startTime,
      result: 'success'
    })
  }

  async keyCount(): Promise<number> {
    return this.cache.size
  }
}

class RedisCache implements CacheBackend {
  constructor(private readonly client: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now()
    try {
      const value = await this.client.get<T | null>(key)
      const latencyMs = Date.now() - startTime

      logger.debug('App cache operation (Redis)', {
        operation: 'get',
        keyPrefix: key.split(':')[0],
        latencyMs,
        result: value === null ? 'miss' : 'hit'
      })

      return value === null ? null : value
    } catch (error) {
      logger.error('App cache get error (Redis)', {
        operation: 'get',
        keyPrefix: key.split(':')[0],
        latencyMs: Date.now() - startTime,
        result: 'error',
        error
      })
      return null
    }
  }

  async setNx(
    key: string,
    value: unknown,
    ttlSeconds: number
  ): Promise<boolean> {
    try {
      const result = await this.client.set(key, value, {
        nx: true,
        ex: ttlSeconds
      })
      return result === 'OK'
    } catch (error) {
      logger.error('App cache setNx error (Redis)', {
        operation: 'setNx',
        keyPrefix: key.split(':')[0],
        result: 'error',
        error
      })
      return false
    }
  }

  async incrFixedWindow(
    key: string,
    windowSeconds: number
  ): Promise<FixedWindowHit | null> {
    try {
      const res = (await this.client.eval(
        INCR_FIXED_WINDOW_LUA,
        [key],
        [String(windowSeconds)]
      )) as [number | string, number | string]
      return { count: Number(res[0]), ttlSeconds: Number(res[1]) }
    } catch (error) {
      // null: distributed backend unavailable; the caller picks fail-open or closed.
      logger.error('App cache incrFixedWindow error (Redis)', {
        operation: 'incrFixedWindow',
        keyPrefix: key.split(':')[0],
        result: 'error',
        error
      })
      return null
    }
  }

  async set(
    key: string,
    value: unknown,
    ttlSeconds: number = 300
  ): Promise<void> {
    const startTime = Date.now()
    try {
      await this.client.set(key, value, { ex: ttlSeconds })

      logger.debug('App cache operation (Redis)', {
        operation: 'set',
        keyPrefix: key.split(':')[0],
        latencyMs: Date.now() - startTime,
        result: 'success',
        ttlSeconds
      })
    } catch (error) {
      logger.error('App cache set error (Redis)', {
        operation: 'set',
        keyPrefix: key.split(':')[0],
        latencyMs: Date.now() - startTime,
        result: 'error',
        error
      })
      throw error
    }
  }

  async del(key: string): Promise<void> {
    const startTime = Date.now()
    try {
      await this.client.del(key)

      logger.debug('App cache operation (Redis)', {
        operation: 'del',
        keyPrefix: key.split(':')[0],
        latencyMs: Date.now() - startTime,
        result: 'success'
      })
    } catch (error) {
      logger.error('App cache delete error (Redis)', {
        operation: 'del',
        keyPrefix: key.split(':')[0],
        latencyMs: Date.now() - startTime,
        result: 'error',
        error
      })
      throw error
    }
  }

  async flush(): Promise<void> {
    const startTime = Date.now()
    try {
      await this.client.flushdb()

      logger.debug('App cache operation (Redis)', {
        operation: 'flush',
        keyPrefix: 'all',
        latencyMs: Date.now() - startTime,
        result: 'success'
      })
    } catch (error) {
      logger.warn(
        'Failed to flush Redis cache - command not supported on current plan',
        {
          operation: 'flush',
          keyPrefix: 'all',
          latencyMs: Date.now() - startTime,
          result: 'unsupported',
          error: error as Error
        }
      )
    }
  }

  async keyCount(): Promise<number> {
    try {
      return await this.client.dbsize()
    } catch (error) {
      logger.warn('Failed to determine Redis key count, defaulting to 0', {
        operation: 'keyCount',
        result: 'error',
        error: error as Error
      })
      return 0
    }
  }
}

class IORedisBackend implements CacheBackend {
  constructor(private readonly client: IORedisClient) {}

  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now()
    try {
      const raw = await this.client.get(key)
      const latencyMs = Date.now() - startTime
      if (raw === null) {
        logger.debug('App cache miss (ioredis)', {
          operation: 'get',
          keyPrefix: key.split(':')[0],
          latencyMs,
          result: 'miss'
        })
        return null
      }
      logger.debug('App cache hit (ioredis)', {
        operation: 'get',
        keyPrefix: key.split(':')[0],
        latencyMs,
        result: 'hit'
      })
      try {
        return JSON.parse(raw) as T
      } catch {
        return raw as unknown as T
      }
    } catch (error) {
      logger.error('App cache get error (ioredis)', {
        operation: 'get',
        keyPrefix: key.split(':')[0],
        latencyMs: Date.now() - startTime,
        result: 'error',
        error
      })
      return null
    }
  }

  async set(
    key: string,
    value: unknown,
    ttlSeconds: number = 300
  ): Promise<void> {
    const startTime = Date.now()
    try {
      const serialized =
        typeof value === 'string' ? value : JSON.stringify(value)
      await this.client.set(key, serialized, 'EX', ttlSeconds)
      logger.debug('App cache set (ioredis)', {
        operation: 'set',
        keyPrefix: key.split(':')[0],
        latencyMs: Date.now() - startTime,
        result: 'success',
        ttlSeconds
      })
    } catch (error) {
      logger.error('App cache set error (ioredis)', {
        operation: 'set',
        keyPrefix: key.split(':')[0],
        latencyMs: Date.now() - startTime,
        result: 'error',
        error
      })
    }
  }

  async setNx(
    key: string,
    value: unknown,
    ttlSeconds: number
  ): Promise<boolean> {
    try {
      const serialized =
        typeof value === 'string' ? value : JSON.stringify(value)
      const result = await this.client.set(
        key,
        serialized,
        'EX',
        ttlSeconds,
        'NX'
      )
      return result === 'OK'
    } catch (error) {
      logger.error('App cache setNx error (ioredis)', {
        operation: 'setNx',
        keyPrefix: key.split(':')[0],
        result: 'error',
        error
      })
      return false
    }
  }

  async incrFixedWindow(
    key: string,
    windowSeconds: number
  ): Promise<FixedWindowHit | null> {
    try {
      const res = (await this.client.eval(
        INCR_FIXED_WINDOW_LUA,
        1,
        key,
        String(windowSeconds)
      )) as [number | string, number | string]
      return { count: Number(res[0]), ttlSeconds: Number(res[1]) }
    } catch (error) {
      // null: distributed backend unavailable; the caller picks fail-open or closed.
      logger.error('App cache incrFixedWindow error (ioredis)', {
        operation: 'incrFixedWindow',
        keyPrefix: key.split(':')[0],
        result: 'error',
        error
      })
      return null
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key)
    } catch (error) {
      logger.error('App cache delete error (ioredis)', {
        operation: 'del',
        keyPrefix: key.split(':')[0],
        result: 'error',
        error
      })
    }
  }

  async flush(): Promise<void> {
    logger.warn(
      'IORedisBackend.flush() is a no-op (shared in-cluster Redis hosts other namespaces like conformance:*)'
    )
  }

  async keyCount(): Promise<number> {
    try {
      return await this.client.dbsize()
    } catch {
      return 0
    }
  }
}

const createBackend = (): CacheBackend => {
  const redisUrl = process.env.REDIS_URL
  if (
    redisUrl &&
    (redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://'))
  ) {
    try {
      // Real Node require, opaque to Turbopack (see the module header).
      const ioredisMod = nodeRequire('ioredis')
      const IORedis = (ioredisMod.default ??
        ioredisMod) as typeof import('ioredis').default
      const client = new IORedis(redisUrl, {
        lazyConnect: false,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 2,
        connectTimeout: 5000,
        commandTimeout: 3000,
        reconnectOnError: () => true
      })
      client.on('error', (err: Error) => {
        logger.warn(
          'ioredis connection error (cache reads will return null until reconnect)',
          {
            error: err.message
          }
        )
      })
      client.on('ready', () => {
        logger.info('ioredis client ready (in-cluster Redis)')
      })
      logger.info(
        'Application cache initialised with in-cluster Redis (ioredis wire protocol)'
      )
      return new IORedisBackend(client)
    } catch (error) {
      // warn, not error: the Upstash REST fallback covers this path.
      logger.warn(
        'Failed to initialise ioredis client, trying Upstash REST fallback',
        { error: (error as Error)?.message }
      )
    }
  }

  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    const missingReason =
      !url && !token ? 'credentials' : !url ? 'URL' : 'token'
    logger.info(
      `Application cache initialised with in-memory backend (no REDIS_URL; ${missingReason} missing for Upstash/Vercel KV)`
    )
    return new InMemoryCache()
  }

  try {
    const client = new Redis({ url, token })
    logger.info(
      'Application cache initialised with Upstash Redis backend (REST)'
    )
    return new RedisCache(client)
  } catch (error) {
    logger.error(
      'Failed to initialise Upstash Redis client, falling back to in-memory cache',
      error as Error
    )
    return new InMemoryCache()
  }
}

const backend = createBackend()

export const appCache = {
  get: <T>(key: string): Promise<T | null> => backend.get<T>(key),
  set: (key: string, value: unknown, ttl?: number): Promise<void> =>
    backend.set(key, value, ttl),
  setNx: (key: string, value: unknown, ttlSeconds: number): Promise<boolean> =>
    backend.setNx(key, value, ttlSeconds),
  /** Atomic fixed-window counter; null only when a distributed backend errored. */
  incrFixedWindow: (
    key: string,
    windowSeconds: number
  ): Promise<FixedWindowHit | null> =>
    backend.incrFixedWindow(key, windowSeconds),
  del: (key: string): Promise<void> => backend.del(key),
  flush: (): Promise<void> => backend.flush(),
  keyCount: (): Promise<number> => backend.keyCount()
}
