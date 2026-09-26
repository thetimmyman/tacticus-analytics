import { describe, it, expect, afterEach, vi } from 'vitest'

// authConfig is mostly a static literal; only derived fields and security invariants are tested.
describe('Auth Configuration', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
  })

  describe('cookies.secure is derived from NODE_ENV', () => {
    it('is true in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.resetModules()
      const { authConfig } = await import('@/app/lib/auth/config')
      expect(authConfig.cookies.secure).toBe(true)
    })

    it('is false outside production', async () => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.resetModules()
      const { authConfig } = await import('@/app/lib/auth/config')
      expect(authConfig.cookies.secure).toBe(false)
    })

    it('is false under the test environment', async () => {
      vi.stubEnv('NODE_ENV', 'test')
      vi.resetModules()
      const { authConfig } = await import('@/app/lib/auth/config')
      expect(authConfig.cookies.secure).toBe(false)
    })
  })

  describe('security-relevant invariants', () => {
    it('keeps a non-trivial password floor and CSRF token length', async () => {
      const { authConfig } = await import('@/app/lib/auth/config')
      expect(authConfig.email.passwordMinLength).toBeGreaterThanOrEqual(8)
      expect(authConfig.csrf.tokenLength).toBeGreaterThanOrEqual(32)
    })

    it('rate-limits signup at least as strictly as login', async () => {
      const { authConfig } = await import('@/app/lib/auth/config')
      const { login, signup } = authConfig.rateLimit
      // Signup is more abusable than login: no shorter window, no larger budget.
      expect(signup.windowMs).toBeGreaterThanOrEqual(login.windowMs)
      expect(signup.attempts).toBeLessThanOrEqual(login.attempts)
    })

    it('marks the session cookie httpOnly with a bounded lifetime', async () => {
      const { authConfig } = await import('@/app/lib/auth/config')
      expect(authConfig.cookies.httpOnly).toBe(true)
      expect(authConfig.cookies.maxAge).toBeGreaterThan(0)
      expect(authConfig.cookies.maxAge).toBeLessThanOrEqual(60 * 60 * 24 * 30)
    })
  })
})
