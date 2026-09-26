// Atomic fixed-window counters in shared Redis; fails open to a per-pod limiter on outage.

import { NextRequest, NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { appCache } from '@tacticus/app-core/app-cache'
import { RATE_LIMIT_CONFIG } from '@/app/lib/middleware/rate-limit-config'

export { RATE_LIMIT_CONFIG } from '@/app/lib/middleware/rate-limit-config'
export { checkApiSecurity } from '@/app/lib/middleware/api-authz'
export { apiSecurityMiddleware } from '@/app/lib/middleware/api-security-middleware'
export { performSecurityChecks } from '@/app/lib/middleware/request-filter'

export interface ActionRateLimitResult {
  allowed: boolean
  remainingTime?: number
}

export async function checkActionRateLimit(
  key: string,
  windowSeconds: number
): Promise<ActionRateLimitResult> {
  const windowMs = windowSeconds * 1000
  const now = Date.now()
  const acquired = await appCache.setNx(key, now, windowSeconds)
  if (acquired) return { allowed: true }

  const lastInvocation = await appCache.get<number>(key)
  if (typeof lastInvocation === 'number') {
    const elapsed = now - lastInvocation
    if (elapsed < windowMs) {
      return {
        allowed: false,
        remainingTime: Math.ceil((windowMs - elapsed) / 1000)
      }
    }
  }

  return { allowed: false, remainingTime: windowSeconds }
}

const rateLimitStore = new Map<
  string,
  {
    buckets: Map<string, number[]>
    violations: number[]
    blocked: boolean
    blockUntil?: number
  }
>()

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetTime: number
  reason?: string
  headers: Record<string, string>
}

/** Canonical client IP; never re-implement inline. `cf-connecting-ip` first: Cloudflare appends to
 * XFF, so XFF hop 0 is caller-controlled and would let an attacker rotate buckets. */
export function getClientIp(request: NextRequest): string {
  const cfIp = request.headers.get('cf-connecting-ip')
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  return cfIp || forwarded?.split(',')[0]?.trim() || realIp || 'unknown'
}

export function getClientId(request: NextRequest, userId?: string): string {
  if (userId) return `user:${userId}`
  return `ip:${getClientIp(request)}`
}

function getEndpointConfig(pathname: string): {
  pattern: string
  config: { limit: number; window: number }
} {
  for (const [pattern, config] of Object.entries(RATE_LIMIT_CONFIG.endpoints)) {
    if (pattern !== 'default' && pathname.startsWith(pattern)) {
      return { pattern, config }
    }
  }

  return { pattern: 'default', config: RATE_LIMIT_CONFIG.endpoints.default }
}

const SHARED_KEY_PREFIX = 'ratelimit:api'

/** Deliberately fails open: a Redis blip must not lock everyone out of login. */
export async function checkRateLimit(
  clientId: string,
  endpoint: string,
  userRole?: string
): Promise<RateLimitResult> {
  try {
    const shared = await checkRateLimitShared(clientId, endpoint, userRole)
    if (shared) return shared
  } catch {
    // Treat a throw as an outage; stay fail-open.
  }
  return checkRateLimitInMemory(clientId, endpoint, userRole)
}

/** Null when Redis is unavailable. Rejected attempts tick counters harmlessly (TTL pinned at first incr). */
async function checkRateLimitShared(
  clientId: string,
  endpoint: string,
  userRole?: string
): Promise<RateLimitResult | null> {
  const now = Date.now()
  const { pattern: bucketKey, config: endpointConfig } =
    getEndpointConfig(endpoint)
  const userConfig =
    RATE_LIMIT_CONFIG.userLimits[
      userRole as keyof typeof RATE_LIMIT_CONFIG.userLimits
    ] || RATE_LIMIT_CONFIG.userLimits.default

  // A read error reads as not blocked; the incr calls below are the authoritative outage signal.
  const blockKey = `${SHARED_KEY_PREFIX}:block:${clientId}`
  const blockUntil = await appCache.get<number>(blockKey)
  if (typeof blockUntil === 'number' && now < blockUntil) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: blockUntil,
      reason: 'Client temporarily blocked',
      headers: {
        'X-RateLimit-Blocked': 'true',
        'X-RateLimit-Reset': Math.ceil(blockUntil / 1000).toString()
      }
    }
  }

  const bucketHit = await appCache.incrFixedWindow(
    `${SHARED_KEY_PREFIX}:req:${clientId}:${bucketKey}`,
    Math.ceil(endpointConfig.window / 1000)
  )
  if (bucketHit === null) return null

  // Window length is in the key so a role change starts a fresh window.
  const userHit = await appCache.incrFixedWindow(
    `${SHARED_KEY_PREFIX}:user:${clientId}:${userConfig.window}`,
    Math.ceil(userConfig.window / 1000)
  )
  if (userHit === null) return null

  // `count` includes this request, so `count > limit` admits exactly `limit`.
  const rejectScope =
    bucketHit.count > endpointConfig.limit
      ? {
          limit: endpointConfig.limit,
          window: endpointConfig.window,
          ttlSeconds: bucketHit.ttlSeconds
        }
      : userHit.count > userConfig.limit
        ? {
            limit: userConfig.limit,
            window: userConfig.window,
            ttlSeconds: userHit.ttlSeconds
          }
        : null

  if (rejectScope) {
    const violationHit = await appCache.incrFixedWindow(
      `${SHARED_KEY_PREFIX}:viol:${clientId}`,
      Math.ceil(rejectScope.window / 1000)
    )
    if (violationHit !== null && violationHit.count >= rejectScope.limit) {
      const until = now + RATE_LIMIT_CONFIG.security.blockDuration
      try {
        await appCache.set(
          blockKey,
          until,
          Math.ceil(RATE_LIMIT_CONFIG.security.blockDuration / 1000)
        )
      } catch {
        // Best-effort: the 429 is already decided.
      }
    }

    const resetTime = now + rejectScope.ttlSeconds * 1000

    return {
      allowed: false,
      remaining: 0,
      resetTime,
      reason: 'Rate limit exceeded',
      headers: {
        'X-RateLimit-Limit': rejectScope.limit.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': Math.ceil(resetTime / 1000).toString(),
        'X-RateLimit-Window': Math.ceil(rejectScope.window / 1000).toString()
      }
    }
  }

  const endpointRemaining = endpointConfig.limit - bucketHit.count
  const userRemaining = userConfig.limit - userHit.count
  const endpointBinding = endpointRemaining <= userRemaining
  const binding = endpointBinding
    ? {
        limit: endpointConfig.limit,
        window: endpointConfig.window,
        ttlSeconds: bucketHit.ttlSeconds
      }
    : {
        limit: userConfig.limit,
        window: userConfig.window,
        ttlSeconds: userHit.ttlSeconds
      }
  const remaining = Math.max(
    0,
    endpointBinding ? endpointRemaining : userRemaining
  )
  const resetTime = now + binding.ttlSeconds * 1000

  return {
    allowed: true,
    remaining,
    resetTime,
    headers: {
      'X-RateLimit-Limit': binding.limit.toString(),
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': Math.ceil(resetTime / 1000).toString(),
      'X-RateLimit-Window': Math.ceil(binding.window / 1000).toString()
    }
  }
}

/** Exported for tests only; production callers go through `checkRateLimit`. */
export function checkRateLimitInMemory(
  clientId: string,
  endpoint: string,
  userRole?: string
): RateLimitResult {
  const now = Date.now()
  const { pattern: bucketKey, config: endpointConfig } =
    getEndpointConfig(endpoint)
  const userConfig =
    RATE_LIMIT_CONFIG.userLimits[
      userRole as keyof typeof RATE_LIMIT_CONFIG.userLimits
    ] || RATE_LIMIT_CONFIG.userLimits.default

  let clientData = rateLimitStore.get(clientId)
  if (!clientData) {
    clientData = { buckets: new Map(), violations: [], blocked: false }
    rateLimitStore.set(clientId, clientData)
  }

  if (
    clientData.blocked &&
    clientData.blockUntil &&
    now < clientData.blockUntil
  ) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: clientData.blockUntil,
      reason: 'Client temporarily blocked',
      headers: {
        'X-RateLimit-Blocked': 'true',
        'X-RateLimit-Reset': Math.ceil(clientData.blockUntil / 1000).toString()
      }
    }
  }

  const bucketCutoff = now - endpointConfig.window
  const bucketRequests = (clientData.buckets.get(bucketKey) ?? []).filter(
    (timestamp) => timestamp > bucketCutoff
  )
  clientData.buckets.set(bucketKey, bucketRequests)

  const userCutoff = now - userConfig.window
  let userCount = 0
  let userOldest = Number.POSITIVE_INFINITY
  for (const timestamps of clientData.buckets.values()) {
    for (let i = timestamps.length - 1; i >= 0; i--) {
      const timestamp = timestamps[i]
      if (timestamp === undefined || timestamp <= userCutoff) break
      userCount++
      if (timestamp < userOldest) userOldest = timestamp
    }
  }

  const rejectScope =
    bucketRequests.length >= endpointConfig.limit
      ? {
          limit: endpointConfig.limit,
          window: endpointConfig.window,
          oldest: bucketRequests[0] ?? now
        }
      : userCount >= userConfig.limit
        ? {
            limit: userConfig.limit,
            window: userConfig.window,
            oldest: Number.isFinite(userOldest) ? userOldest : now
          }
        : null

  if (rejectScope) {
    const violationCutoff = now - rejectScope.window
    clientData.violations = clientData.violations.filter(
      (timestamp) => timestamp > violationCutoff
    )
    clientData.violations.push(now)
    if (clientData.violations.length >= rejectScope.limit) {
      clientData.blocked = true
      clientData.blockUntil = now + RATE_LIMIT_CONFIG.security.blockDuration
    }

    const resetTime = rejectScope.oldest + rejectScope.window

    return {
      allowed: false,
      remaining: 0,
      resetTime,
      reason: 'Rate limit exceeded',
      headers: {
        'X-RateLimit-Limit': rejectScope.limit.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': Math.ceil(resetTime / 1000).toString(),
        'X-RateLimit-Window': Math.ceil(rejectScope.window / 1000).toString()
      }
    }
  }

  bucketRequests.push(now)

  const endpointRemaining = endpointConfig.limit - bucketRequests.length
  const userRemaining = userConfig.limit - (userCount + 1)
  const endpointBinding = endpointRemaining <= userRemaining
  const remaining = Math.max(
    0,
    endpointBinding ? endpointRemaining : userRemaining
  )
  const resetTime = endpointBinding
    ? (bucketRequests[0] ?? now) + endpointConfig.window
    : (Number.isFinite(userOldest) ? userOldest : now) + userConfig.window
  const limit = endpointBinding ? endpointConfig.limit : userConfig.limit
  const window = endpointBinding ? endpointConfig.window : userConfig.window

  return {
    allowed: true,
    remaining,
    resetTime,
    headers: {
      'X-RateLimit-Limit': limit.toString(),
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': Math.ceil(resetTime / 1000).toString(),
      'X-RateLimit-Window': Math.ceil(window / 1000).toString()
    }
  }
}

export function cleanupRateLimitStore(): void {
  const now = Date.now()
  const maxAge = 24 * 60 * 60 * 1000 // 24 hours

  for (const [clientId, data] of rateLimitStore.entries()) {
    let hasRecentActivity = false
    for (const timestamps of data.buckets.values()) {
      const last = timestamps[timestamps.length - 1]
      if (last !== undefined && now - last < maxAge) {
        hasRecentActivity = true
        break
      }
    }

    if (!hasRecentActivity && (!data.blockUntil || now > data.blockUntil)) {
      rateLimitStore.delete(clientId)
    }
  }
}

if (typeof window === 'undefined') {
  setInterval(cleanupRateLimitStore, 60 * 60 * 1000)
}

export function getRateLimitStats() {
  const now = Date.now()
  const stats = {
    totalClients: rateLimitStore.size,
    blockedClients: 0,
    activeClients: 0,
    totalRequests: 0,
    recentRequests: 0
  }

  const recentCutoff = now - 5 * 60 * 1000
  for (const data of rateLimitStore.values()) {
    if (data.blocked && data.blockUntil && now < data.blockUntil) {
      stats.blockedClients++
    }

    let clientRequests = 0
    for (const timestamps of data.buckets.values()) {
      clientRequests += timestamps.length
      stats.recentRequests += timestamps.filter(
        (timestamp) => timestamp > recentCutoff
      ).length
    }

    if (clientRequests > 0) {
      stats.activeClients++
      stats.totalRequests += clientRequests
    }
  }

  return stats
}

// Legacy no-ops kept for compatibility; use apiSecurityMiddleware.
export async function rateLimit(
  _request: NextRequest,
  _endpoint: string,
  _limit: number,
  _window: number
): Promise<void> {
  void _request
  void _endpoint
  void _limit
  void _window
}

export function addRateLimitHeaders(
  response: NextResponse,
  _stats?: never
): NextResponse {
  void _stats
  return response
}

declare module 'next/server' {
  interface NextRequest {
    rateLimitHeaders?: Record<string, string>
    user?: User
    userRole?: string
  }
}
