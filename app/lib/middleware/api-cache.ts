// Never caches authenticated requests or `no-store`/`private`/Set-Cookie responses by default.

import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.middleware.api-cache')

interface CacheEntry {
  body: Uint8Array
  headers: Array<[string, string]>
  status: number
  statusText: string
  timestamp: number
  etag: string
}

interface CacheOptions {
  cacheAuthenticated?: boolean
  key?: (req: NextRequest) => string
}

interface RouteCacheConfig {
  maxAge: number
  swr: number
}

const apiCache = new Map<string, CacheEntry>()

const AUTH_HEADER_KEYS = [
  'authorization',
  'cookie',
  'x-supabase-auth',
  'x-supabase-session'
]

const CACHE_CONFIG = {
  DEFAULT_MAX_AGE: 300, // 5 minutes
  STALE_WHILE_REVALIDATE: 86400, // 24 hours
  ROUTE_CONFIGS: {
    '/api/meta-analysis': { maxAge: 600, swr: 7200 }, // 10 min cache, 2 hour SWR
    '/api/discord-webhooks/leaderboard': { maxAge: 300, swr: 1800 } // 5 min cache, 30 min SWR
  } as Record<string, RouteCacheConfig>
}

function getCacheKey(req: NextRequest): string {
  const url = new URL(req.url)
  const searchParams = url.searchParams.toString()
  return `${url.pathname}${searchParams ? `?${searchParams}` : ''}`
}

function generateETag(buffer: Uint8Array): string {
  let hash = 0
  for (const byte of buffer) {
    hash = (hash << 5) - hash + byte
    hash |= 0 // Convert to 32-bit integer
  }
  return `"${Math.abs(hash).toString(36)}"`
}

function getCacheConfig(pathname: string): RouteCacheConfig {
  if (CACHE_CONFIG.ROUTE_CONFIGS[pathname]) {
    return CACHE_CONFIG.ROUTE_CONFIGS[pathname]
  }

  for (const [pattern, config] of Object.entries(CACHE_CONFIG.ROUTE_CONFIGS)) {
    if (pathname.startsWith(pattern)) {
      return config
    }
  }

  return {
    maxAge: CACHE_CONFIG.DEFAULT_MAX_AGE,
    swr: CACHE_CONFIG.STALE_WHILE_REVALIDATE
  }
}

function requestHasAuthHeaders(req: NextRequest): boolean {
  return AUTH_HEADER_KEYS.some((key) => req.headers.has(key))
}

function hasSetCookieHeader(headers: Array<[string, string]>): boolean {
  return headers.some(([key]) => key.toLowerCase() === 'set-cookie')
}

function hasPrivateCacheControl(headers: Array<[string, string]>): boolean {
  const cacheControl = headers.find(
    ([key]) => key.toLowerCase() === 'cache-control'
  )?.[1]
  if (!cacheControl) return false
  return /no-store|private/i.test(cacheControl)
}

function buildCachedResponse(
  entry: CacheEntry,
  cacheState: 'HIT' | 'STALE',
  config: RouteCacheConfig,
  ageSeconds: number
): NextResponse {
  const headers = new Headers(entry.headers)
  headers.set('X-Cache', cacheState)
  headers.set('X-Cache-Age', ageSeconds.toString())
  headers.set('ETag', entry.etag)
  headers.set(
    'Cache-Control',
    `public, max-age=${config.maxAge}, stale-while-revalidate=${config.swr}`
  )

  const response = new NextResponse(entry.body as BodyInit, {
    status: entry.status,
    statusText: entry.statusText,
    headers
  })

  return response
}

async function cacheResponse(
  cacheKey: string,
  response: Response
): Promise<{ etag: string } | null> {
  const cloned = response.clone()
  const arrayBuffer = await cloned.arrayBuffer()
  const body = new Uint8Array(arrayBuffer)
  const headersArray = Array.from(cloned.headers.entries())

  if (
    hasSetCookieHeader(headersArray) ||
    hasPrivateCacheControl(headersArray)
  ) {
    return null
  }

  const etag = generateETag(body)
  apiCache.set(cacheKey, {
    body,
    headers: headersArray,
    status: response.status,
    statusText: response.statusText,
    timestamp: Date.now(),
    etag
  })

  return { etag }
}

function shouldBypassCache(req: NextRequest, options: CacheOptions): boolean {
  if (req.method !== 'GET') return true
  const allowAuthenticated = options.cacheAuthenticated ?? false
  if (!allowAuthenticated && requestHasAuthHeaders(req)) {
    return true
  }
  return false
}

export function withCache(
  handler: (req: NextRequest) => Promise<Response>,
  options: CacheOptions = {}
) {
  return async (req: NextRequest): Promise<Response> => {
    if (shouldBypassCache(req, options)) {
      return handler(req)
    }

    const cacheKey = options.key ? options.key(req) : getCacheKey(req)
    const cached = apiCache.get(cacheKey)
    const now = Date.now()
    const config = getCacheConfig(new URL(req.url).pathname)
    const maxAgeMs = config.maxAge * 1000
    const swrMs = config.swr * 1000

    const clientETag = req.headers.get('if-none-match')
    if (cached && clientETag === cached.etag) {
      const headers = new Headers({
        ETag: cached.etag,
        'Cache-Control': `public, max-age=${config.maxAge}, stale-while-revalidate=${config.swr}`
      })
      return new NextResponse(null, { status: 304, headers })
    }

    if (cached && now - cached.timestamp < maxAgeMs) {
      logger.debug(`Cache HIT for ${cacheKey}`)
      const ageSeconds = Math.floor((now - cached.timestamp) / 1000)
      return buildCachedResponse(cached, 'HIT', config, ageSeconds)
    }

    if (cached && now - cached.timestamp < maxAgeMs + swrMs) {
      logger.debug(
        `Cache STALE for ${cacheKey}, serving stale while revalidating`
      )
      const ageSeconds = Math.floor((now - cached.timestamp) / 1000)
      const staleResponse = buildCachedResponse(
        cached,
        'STALE',
        config,
        ageSeconds
      )

      handler(req)
        .then(async (revalidationResponse) => {
          if (!revalidationResponse.ok) {
            return
          }

          try {
            const result = await cacheResponse(
              cacheKey,
              revalidationResponse as NextResponse
            )
            if (result) {
              logger.debug(`Cache REVALIDATED for ${cacheKey}`)
            }
          } catch (error) {
            logger.error({ err: error }, 'Failed to revalidate cache entry:')
          }
        })
        .catch((error) => {
          logger.error({ err: error }, 'Background revalidation failed:')
        })

      return staleResponse
    }

    logger.debug(`Cache MISS for ${cacheKey}`)
    const response = await handler(req)

    if (!response.ok) {
      return response
    }

    if (
      response.headers.has('set-cookie') ||
      hasPrivateCacheControl(Array.from(response.headers.entries()))
    ) {
      return response
    }

    try {
      const result = await cacheResponse(cacheKey, response as NextResponse)
      if (result) {
        response.headers.set('X-Cache', 'MISS')
        response.headers.set('ETag', result.etag)
        response.headers.set(
          'Cache-Control',
          `public, max-age=${config.maxAge}, stale-while-revalidate=${config.swr}`
        )
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to cache response:')
    }

    return response
  }
}

export function clearCache(pattern?: string) {
  if (!pattern) {
    apiCache.clear()
    logger.info('Cleared all API cache')
    return
  }

  let cleared = 0
  for (const key of apiCache.keys()) {
    if (key.includes(pattern)) {
      apiCache.delete(key)
      cleared++
    }
  }

  logger.info(`Cleared ${cleared} cache entries matching pattern: ${pattern}`)
}

export function getCacheStats() {
  const stats = {
    size: apiCache.size,
    entries: [] as Array<{
      key: string
      age: number
      size: number
    }>
  }

  const now = Date.now()
  for (const [key, entry] of apiCache.entries()) {
    stats.entries.push({
      key,
      age: Math.floor((now - entry.timestamp) / 1000),
      size: entry.body.length
    })
  }

  return stats
}

if (typeof window === 'undefined') {
  setInterval(
    () => {
      const now = Date.now()
      let cleaned = 0

      for (const [key, entry] of apiCache.entries()) {
        const path = key.split('?')[0] ?? key
        const config = getCacheConfig(path)
        const expiryMs = (config.maxAge + config.swr) * 1000

        if (now - entry.timestamp > expiryMs) {
          apiCache.delete(key)
          cleaned++
        }
      }

      if (cleaned > 0) {
        logger.debug(`Cleaned ${cleaned} expired cache entries`)
      }
    },
    60 * 60 * 1000
  )
}
