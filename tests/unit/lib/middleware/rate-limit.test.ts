import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// The global test setup neutralizes this middleware; the limiter's own suite opts back in.
vi.unmock('@/app/lib/middleware/api-security-middleware')

/** One fake Redis shared by every module instance; `failing` models an outage. */
const sharedCache = vi.hoisted(() => {
  const counters = new Map<string, { count: number; expiresAt: number }>()
  const values = new Map<string, { value: unknown; expiresAt: number }>()
  const state = { failing: false }
  const calls = { incrFixedWindow: 0, get: 0, set: 0 }
  return { counters, values, state, calls }
})

const authState = vi.hoisted(() => ({ authenticated: false, banned: false }))

vi.mock('@/app/lib/auth/user-bans', () => ({
  findActiveBanForAuthUser: vi.fn(async () =>
    authState.banned ? { id: 'active-ban' } : null
  )
}))

vi.mock('@/app/lib/db', () => ({
  db: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () =>
        authState.authenticated
          ? { data: { user: { id: 'synthetic-user' } }, error: null }
          : { data: { user: null }, error: { message: 'not authenticated' } }
      )
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { role: 'member' },
              error: null
            }))
          }))
        }))
      }))
    }))
  }))
}))

vi.mock('@tacticus/app-core/app-cache', () => ({
  appCache: {
    async incrFixedWindow(key: string, windowSeconds: number) {
      sharedCache.calls.incrFixedWindow += 1
      if (sharedCache.state.failing) return null
      const now = Date.now()
      const entry = sharedCache.counters.get(key)
      if (!entry || entry.expiresAt <= now) {
        sharedCache.counters.set(key, {
          count: 1,
          expiresAt: now + windowSeconds * 1000
        })
        return { count: 1, ttlSeconds: windowSeconds }
      }
      // No interleaving await: the single-op semantics of the real Lua script.
      entry.count += 1
      return {
        count: entry.count,
        ttlSeconds: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000))
      }
    },
    async get(key: string) {
      sharedCache.calls.get += 1
      if (sharedCache.state.failing) return null
      const entry = sharedCache.values.get(key)
      if (!entry || entry.expiresAt <= Date.now()) return null
      return entry.value
    },
    async set(key: string, value: unknown, ttlSeconds = 300) {
      sharedCache.calls.set += 1
      if (sharedCache.state.failing) throw new Error('redis unavailable')
      sharedCache.values.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000
      })
    },
    setNx: vi.fn(),
    del: vi.fn(),
    flush: vi.fn(),
    keyCount: vi.fn()
  }
}))

type RateLimitModule = typeof import('@/app/lib/middleware/rate-limit')

/** A fresh module instance stands in for a separate pod; appCache stays shared. */
async function loadPod(): Promise<RateLimitModule> {
  vi.resetModules()
  return import('@/app/lib/middleware/rate-limit')
}

async function loadCheckRateLimit() {
  return (await loadPod()).checkRateLimit
}

const LOGIN = '/api/auth/login'

beforeEach(() => {
  sharedCache.counters.clear()
  sharedCache.values.clear()
  sharedCache.state.failing = false
  sharedCache.calls.incrFixedWindow = 0
  sharedCache.calls.get = 0
  sharedCache.calls.set = 0
  authState.authenticated = false
  authState.banned = false
})

describe('apiSecurityMiddleware authentication', () => {
  it('does not bypass required authentication during production builds', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build')
    const { apiSecurityMiddleware } = await loadPod()
    const response = await apiSecurityMiddleware(
      new NextRequest('https://tacticusanalytics.com/api/private', {
        method: 'GET'
      }),
      { requireAuth: true, skipRateLimit: true, skipSecurityChecks: true }
    )

    expect(response?.status).toBe(401)
    vi.unstubAllEnvs()
  })

  it('allows an authenticated request through the same build phase', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build')
    authState.authenticated = true
    const { apiSecurityMiddleware } = await loadPod()
    const response = await apiSecurityMiddleware(
      new NextRequest('https://tacticusanalytics.com/api/private', {
        method: 'GET'
      }),
      { requireAuth: true, skipRateLimit: true, skipSecurityChecks: true }
    )

    expect(response).toBeNull()
    vi.unstubAllEnvs()
  })

  it('returns forbidden for an authenticated suspended session', async () => {
    authState.authenticated = true
    authState.banned = true
    const { apiSecurityMiddleware } = await loadPod()

    const response = await apiSecurityMiddleware(
      new NextRequest('https://tacticusanalytics.com/api/private', {
        method: 'GET'
      }),
      { requireAuth: true, skipRateLimit: true, skipSecurityChecks: true }
    )

    expect(response?.status).toBe(403)
  })
})

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-27T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not bleed one endpoint budget into another', async () => {
    const checkRateLimit = await loadCheckRateLimit()

    for (let i = 0; i < 10; i++) {
      expect(
        (await checkRateLimit('user:u1', '/api/validate-api-key', 'member'))
          .allowed
      ).toBe(true)
    }
    expect(
      (await checkRateLimit('user:u1', '/api/validate-api-key', 'member'))
        .allowed
    ).toBe(false)

    expect(
      (await checkRateLimit('user:u1', '/api/guild/create-config', 'member'))
        .allowed
    ).toBe(true)
  })

  it('allows validate-api-key after allowed guild-creation traffic', async () => {
    const checkRateLimit = await loadCheckRateLimit()

    for (let i = 0; i < 10; i++) {
      expect(
        (await checkRateLimit('user:u2', '/api/guild/create-config', 'member'))
          .allowed
      ).toBe(true)
    }

    expect(
      (await checkRateLimit('user:u2', '/api/validate-api-key', 'member'))
        .allowed
    ).toBe(true)
  })

  it('still enforces the per-user total across endpoints', async () => {
    const checkRateLimit = await loadCheckRateLimit()

    for (let i = 0; i < 15; i++) {
      expect(
        (await checkRateLimit('ip:9.9.9.9', '/api/guild/roster')).allowed
      ).toBe(true)
      expect(
        (await checkRateLimit('ip:9.9.9.9', '/api/other-endpoint')).allowed
      ).toBe(true)
    }
    expect(
      (await checkRateLimit('ip:9.9.9.9', '/api/other-endpoint')).allowed
    ).toBe(false)
  })

  it('escalates sustained hammering past the limit to a temporary block', async () => {
    const checkRateLimit = await loadCheckRateLimit()

    for (let i = 0; i < 10; i++) {
      await checkRateLimit('user:u3', '/api/validate-api-key', 'member')
    }
    let lastReason: string | undefined
    for (let i = 0; i < 10; i++) {
      lastReason = (
        await checkRateLimit('user:u3', '/api/validate-api-key', 'member')
      ).reason
    }
    expect(lastReason).toBe('Rate limit exceeded')

    const blocked = await checkRateLimit(
      'user:u3',
      '/api/validate-api-key',
      'member'
    )
    expect(blocked.allowed).toBe(false)
    expect(blocked.reason).toBe('Client temporarily blocked')

    expect(
      (await checkRateLimit('user:u3', '/api/guild/create-config', 'member'))
        .reason
    ).toBe('Client temporarily blocked')
  })

  it('frees the budget once the window slides past', async () => {
    const checkRateLimit = await loadCheckRateLimit()

    for (let i = 0; i < 10; i++) {
      await checkRateLimit('user:u4', '/api/validate-api-key', 'member')
    }
    expect(
      (await checkRateLimit('user:u4', '/api/validate-api-key', 'member'))
        .allowed
    ).toBe(false)

    vi.advanceTimersByTime(61_000)

    expect(
      (await checkRateLimit('user:u4', '/api/validate-api-key', 'member'))
        .allowed
    ).toBe(true)
  })
})

describe('checkRateLimit across replicas (shared Redis counter)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-27T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts two pods into ONE bucket instead of one bucket each', async () => {
    const podA = await loadPod()
    const podB = await loadPod()
    expect(podA.checkRateLimitInMemory).not.toBe(podB.checkRateLimitInMemory)

    const admitted: boolean[] = []
    for (let i = 0; i < 6; i++) {
      const pod = i % 2 === 0 ? podA : podB
      admitted.push(
        (await pod.checkRateLimit('auth:203.0.113.7', LOGIN, 'default')).allowed
      )
    }

    expect(admitted).toEqual([true, true, true, true, true, false])
  })

  it('counts with an atomic INCR, not a read-modify-write', async () => {
    const pod = await loadPod()
    sharedCache.calls.incrFixedWindow = 0
    sharedCache.calls.set = 0

    await pod.checkRateLimit('auth:203.0.113.8', LOGIN, 'default')

    // INCR only: a get-then-set lets two replicas both observe 0.
    expect(sharedCache.calls.incrFixedWindow).toBe(2)
    expect(sharedCache.calls.set).toBe(0)
  })

  it('shares the 15-minute block across pods and survives a fresh instance', async () => {
    const podA = await loadPod()

    for (let i = 0; i < 5; i++) {
      await podA.checkRateLimit('auth:203.0.113.9', LOGIN, 'default')
    }
    for (let i = 0; i < 5; i++) {
      await podA.checkRateLimit('auth:203.0.113.9', LOGIN, 'default')
    }

    // A pod that never saw this client (fresh rollout) still honours the block.
    const podB = await loadPod()
    const onFreshPod = await podB.checkRateLimit(
      'auth:203.0.113.9',
      LOGIN,
      'default'
    )
    expect(onFreshPod.allowed).toBe(false)
    expect(onFreshPod.reason).toBe('Client temporarily blocked')
  })
})

describe('checkRateLimit fail-open behaviour', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-27T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('still limits per instance when the shared backend errors', async () => {
    sharedCache.state.failing = true
    const podA = await loadPod()
    const podB = await loadPod()

    // Fails open: requests are still served, but the per-pod ceiling below still applies.
    for (let i = 0; i < 5; i++) {
      expect(
        (await podA.checkRateLimit('auth:198.51.100.4', LOGIN, 'default'))
          .allowed
      ).toBe(true)
    }
    expect(
      (await podA.checkRateLimit('auth:198.51.100.4', LOGIN, 'default')).allowed
    ).toBe(false)

    expect(
      (await podB.checkRateLimit('auth:198.51.100.4', LOGIN, 'default')).allowed
    ).toBe(true)
  })

  it('never rejects purely because the shared backend is down', async () => {
    sharedCache.state.failing = true
    const pod = await loadPod()

    const first = await pod.checkRateLimit(
      'auth:198.51.100.5',
      LOGIN,
      'default'
    )
    expect(first.allowed).toBe(true)
    expect(first.reason).toBeUndefined()
  })
})

describe('getClientIp / getClientId header preference', () => {
  const build = (headers: Record<string, string>) =>
    new NextRequest('https://tacticusanalytics.com/api/auth/login', {
      method: 'POST',
      headers
    })

  it('prefers cf-connecting-ip over a client-controlled x-forwarded-for', async () => {
    const { getClientIp } = await loadPod()
    expect(
      getClientIp(
        build({
          'cf-connecting-ip': '203.0.113.10',
          'x-forwarded-for': '10.0.0.1, 203.0.113.10',
          'x-real-ip': '172.16.0.1'
        })
      )
    ).toBe('203.0.113.10')
  })

  it('falls back to the first x-forwarded-for hop, then x-real-ip, then unknown', async () => {
    const { getClientIp } = await loadPod()
    expect(
      getClientIp(
        build({
          'x-forwarded-for': ' 203.0.113.11 , 10.0.0.2',
          'x-real-ip': '172.16.0.1'
        })
      )
    ).toBe('203.0.113.11')
    expect(getClientIp(build({ 'x-real-ip': '172.16.0.2' }))).toBe('172.16.0.2')
    expect(getClientIp(build({}))).toBe('unknown')
  })

  it('keys authenticated callers on the user id and anonymous ones on the hardened ip', async () => {
    const { getClientId } = await loadPod()
    const request = build({
      'cf-connecting-ip': '203.0.113.12',
      'x-forwarded-for': '10.0.0.3'
    })
    expect(getClientId(request, 'user-abc')).toBe('user:user-abc')
    expect(getClientId(request)).toBe('ip:203.0.113.12')
  })

  it('cannot be moved off a bucket by a spoofed x-forwarded-for', async () => {
    const { getClientIp } = await loadPod()
    const a = getClientIp(
      build({
        'cf-connecting-ip': '203.0.113.13',
        'x-forwarded-for': '1.1.1.1'
      })
    )
    const b = getClientIp(
      build({
        'cf-connecting-ip': '203.0.113.13',
        'x-forwarded-for': '2.2.2.2'
      })
    )
    expect(a).toBe(b)
    expect(a).toBe('203.0.113.13')
  })
})
