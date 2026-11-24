import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hardenSessionCookieOptions,
  isLoopbackOrigin
} from '@/app/lib/auth/session-cookies'

// Supabase SSR needs browser-readable cookies, so only SameSite/Secure may be forced.
describe('hardenSessionCookieOptions', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('forces secure and lax in production on a real host without changing httpOnly', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const hardened = hardenSessionCookieOptions(
      { path: '/', httpOnly: false, maxAge: 3600 },
      'tacticusanalytics.com'
    )

    expect(hardened).toEqual({
      path: '/',
      httpOnly: false,
      maxAge: 3600,
      sameSite: 'lax',
      secure: true
    })
  })

  it('overrides an explicit insecure value from the SDK', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const hardened = hardenSessionCookieOptions(
      { httpOnly: false, sameSite: 'none', secure: false },
      'https://tacticusanalytics.com'
    )

    expect(hardened.sameSite).toBe('lax')
    expect(hardened.secure).toBe(true)
  })

  it('keeps secure off on loopback even in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(
      hardenSessionCookieOptions({ httpOnly: false }, 'localhost').secure
    ).toBe(false)
    expect(
      hardenSessionCookieOptions({ httpOnly: false }, 'http://127.0.0.1:3000')
        .secure
    ).toBe(false)
  })

  it('keeps secure off outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(
      hardenSessionCookieOptions({ httpOnly: false }, 'tacticusanalytics.com')
        .secure
    ).toBe(false)
  })

  it('never downgrades an explicit secure flag outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(
      hardenSessionCookieOptions({ secure: true }, 'localhost').secure
    ).toBe(true)
  })

  it('treats a missing host as non-loopback only outside production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(hardenSessionCookieOptions({ httpOnly: false }, '').secure).toBe(
      true
    )
  })
})

describe('isLoopbackOrigin', () => {
  it.each([
    ['localhost', true],
    ['localhost:3000', true],
    ['http://localhost:3000', true],
    ['http://127.0.0.1:3000', true],
    ['https://[::1]:3000', true],
    ['https://app.localhost', true],
    ['https://tacticusanalytics.com', false],
    ['https://localhost.evil.com', false],
    ['not a url', false],
    ['', false]
  ])('classifies %s as loopback=%s', (value, expected) => {
    expect(isLoopbackOrigin(value)).toBe(expected)
  })
})
