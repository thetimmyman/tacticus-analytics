import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/auth/login/route'

vi.mock('@/app/lib/auth', () => {
  // Defined inside the factory to avoid hoisting issues.
  class AuthError extends Error {
    code: 'UNAUTHENTICATED' | 'ONBOARDING_REQUIRED' | 'INSUFFICIENT_ROLE'
    requiredRole?: string
    currentRole?: string
    constructor(
      message: string,
      code: 'UNAUTHENTICATED' | 'ONBOARDING_REQUIRED' | 'INSUFFICIENT_ROLE',
      requiredRole?: string,
      currentRole?: string
    ) {
      super(message)
      this.name = 'AuthError'
      this.code = code
      this.requiredRole = requiredRole
      this.currentRole = currentRole
    }
  }
  return {
    signInWithPassword: vi.fn(),
    AuthError
  }
})

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

const rateLimitMocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 10,
    resetTime: Date.now() + 60000,
    headers: {}
  }))
}))

// `getClientIp` stays real so the bucket key comes from the hardened implementation.
vi.mock('@/app/lib/middleware/rate-limit', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/lib/middleware/rate-limit')>()
  return {
    ...actual,
    performSecurityChecks: vi.fn(() => ({ passed: true, severity: 'low' })),
    checkRateLimit: rateLimitMocks.checkRateLimit
  }
})

describe('POST /api/auth/login', () => {
  let signInWithPassword: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const authModule = await import('@/app/lib/auth')
    signInWithPassword = vi.mocked(authModule.signInWithPassword)
  })

  const createRequest = (body: unknown) => {
    return new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  describe('validation', () => {
    it('returns 400 when email is missing', async () => {
      const request = createRequest({ password: 'password123' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(2001)
      expect(body.error.message).toContain('Email and password are required')
    })

    it('returns 400 when password is missing', async () => {
      const request = createRequest({ email: 'test@example.com' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(2001)
    })

    it('returns 400 when body is empty', async () => {
      const request = createRequest({})
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001)
    })

    it('returns 400 when body is invalid JSON', async () => {
      const request = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001)
    })
  })

  describe('successful login', () => {
    it('returns user and session on successful authentication', async () => {
      const mockUser = { id: 'user-123', email: 'test@example.com' }
      const mockSession = { access_token: 'token', refresh_token: 'refresh' }

      signInWithPassword.mockResolvedValue({
        user: mockUser,
        session: mockSession,
        error: null
      })

      const request = createRequest({
        email: 'test@example.com',
        password: 'password123'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.user).toEqual(mockUser)
      expect(body.session).toBeUndefined()
    })

    it('normalizes email to lowercase', async () => {
      signInWithPassword.mockResolvedValue({
        user: { id: 'user-123' },
        session: {},
        error: null
      })

      const request = createRequest({
        email: '  TEST@EXAMPLE.COM  ',
        password: 'password123'
      })
      await POST(request)

      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        rememberMe: false
      })
    })

    it('passes rememberMe flag to signIn', async () => {
      signInWithPassword.mockResolvedValue({
        user: { id: 'user-123' },
        session: {},
        error: null
      })

      const request = createRequest({
        email: 'test@example.com',
        password: 'password123',
        rememberMe: true
      })
      await POST(request)

      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        rememberMe: true
      })
    })
  })

  describe('authentication errors', () => {
    it('returns 401 for invalid credentials', async () => {
      signInWithPassword.mockResolvedValue({
        user: null,
        session: null,
        error: { message: 'Invalid login credentials' }
      })

      const request = createRequest({
        email: 'test@example.com',
        password: 'wrongpassword'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(1001)
    })

    it('returns 403 for unconfirmed email', async () => {
      signInWithPassword.mockResolvedValue({
        user: null,
        session: null,
        error: { message: 'Email not confirmed' }
      })

      const request = createRequest({
        email: 'test@example.com',
        password: 'password123'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(1002)
    })

    it('returns 403 for generic auth failure', async () => {
      signInWithPassword.mockResolvedValue({
        user: null,
        session: null,
        error: { message: 'Account disabled' }
      })

      const request = createRequest({
        email: 'test@example.com',
        password: 'password123'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(1002)
    })

    it('handles null error message', async () => {
      signInWithPassword.mockResolvedValue({
        user: null,
        session: null,
        error: { message: null }
      })

      const request = createRequest({
        email: 'test@example.com',
        password: 'password123'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.code).toBe(1002)
    })
  })

  describe('rate-limit client identity', () => {
    const loginWithHeaders = async (headers: Record<string, string>) => {
      signInWithPassword.mockResolvedValue({
        user: { id: 'user-123' },
        session: {},
        error: null
      })
      await POST(
        new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'password123'
          })
        })
      )
      return rateLimitMocks.checkRateLimit.mock.calls.at(-1) as unknown as [
        string,
        string,
        string
      ]
    }

    it('keys the login bucket on cf-connecting-ip, not the client-controlled xff', async () => {
      const [clientId, endpoint] = await loginWithHeaders({
        'cf-connecting-ip': '203.0.113.30',
        'x-forwarded-for': '10.0.0.9, 203.0.113.30',
        'x-real-ip': '172.16.0.9'
      })

      expect(endpoint).toBe('/api/auth/login')
      expect(clientId).toBe('auth:203.0.113.30')
    })

    it('cannot be shifted off its bucket by spoofing x-forwarded-for', async () => {
      const [first] = await loginWithHeaders({
        'cf-connecting-ip': '203.0.113.31',
        'x-forwarded-for': '1.1.1.1'
      })
      const [second] = await loginWithHeaders({
        'cf-connecting-ip': '203.0.113.31',
        'x-forwarded-for': '2.2.2.2'
      })

      // One bucket: a credential-stuffing client cannot rotate XFF to dodge the budget.
      expect(first).toBe(second)
      expect(first).toBe('auth:203.0.113.31')
    })

    it('falls back to the xff hop when no Cloudflare header is present', async () => {
      const [clientId] = await loginWithHeaders({
        'x-forwarded-for': '203.0.113.32, 10.0.0.9'
      })
      expect(clientId).toBe('auth:203.0.113.32')
    })
  })

  describe('error handling', () => {
    it('returns 500 when signInWithPassword throws', async () => {
      signInWithPassword.mockRejectedValue(new Error('Network error'))

      const request = createRequest({
        email: 'test@example.com',
        password: 'password123'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(5001)
    })
  })
})
