import { describe, it, expect } from 'vitest'

// authConfig is mostly a static literal; only security invariants are tested here.
describe('Auth Configuration', () => {
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

    it('defines no dead cookie block: Supabase SSR owns session cookies', async () => {
      const { authConfig } = await import('@/app/lib/auth/config')
      expect('cookies' in authConfig).toBe(false)
    })
  })
})
