import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  ADMIN_ALLOWED_ORIGINS,
  isAllowedOrigin,
  normalizeOrigin
} from '@/app/lib/middleware/origin-allowlist'
import { performSecurityChecks } from '@/app/lib/middleware/request-filter'

const build = (origin: string | null) => {
  const headers = new Headers({ 'user-agent': 'vitest-client' })
  if (origin !== null) headers.set('origin', origin)
  return new NextRequest('https://tacticusanalytics.com/api/admin/users', {
    method: 'POST',
    headers
  })
}

describe('exact-origin matching', () => {
  it('accepts an allowlisted origin exactly', () => {
    expect(
      isAllowedOrigin('https://tacticusanalytics.com', ADMIN_ALLOWED_ORIGINS)
    ).toBe(true)
    expect(
      isAllowedOrigin(
        'https://www.tacticusanalytics.com',
        ADMIN_ALLOWED_ORIGINS
      )
    ).toBe(true)
  })

  it('rejects the prefix bypass that the old startsWith check allowed', () => {
    // `https://www.tacticusanalytics.com.evil.example`.startsWith('https://www.tacticusanalytics.com')
    expect(
      isAllowedOrigin(
        'https://tacticusanalytics.com.evil.example',
        ADMIN_ALLOWED_ORIGINS
      )
    ).toBe(false)
    expect(
      isAllowedOrigin(
        'https://www.tacticusanalytics.com.evil',
        ADMIN_ALLOWED_ORIGINS
      )
    ).toBe(false)
  })

  it('rejects the opaque `null` origin and a missing origin', () => {
    expect(isAllowedOrigin('null', ADMIN_ALLOWED_ORIGINS)).toBe(false)
    expect(isAllowedOrigin(null, ADMIN_ALLOWED_ORIGINS)).toBe(false)
  })

  it('rejects a look-alike scheme, port or trailing path', () => {
    expect(
      isAllowedOrigin('http://tacticusanalytics.com', ADMIN_ALLOWED_ORIGINS)
    ).toBe(false)
    expect(
      isAllowedOrigin(
        'https://tacticusanalytics.com:8443',
        ADMIN_ALLOWED_ORIGINS
      )
    ).toBe(false)
    expect(
      isAllowedOrigin(
        'https://tacticusanalytics.com/api/admin',
        ADMIN_ALLOWED_ORIGINS
      )
    ).toBe(false)
  })

  it('rejects malformed origins', () => {
    expect(isAllowedOrigin('not a url', ADMIN_ALLOWED_ORIGINS)).toBe(false)
    expect(normalizeOrigin('not a url')).toBeNull()
  })
})

describe('performSecurityChecks rejects a cross-site admin origin', () => {
  it('fails a state-changing prefix bypass with critical severity', () => {
    const result = performSecurityChecks(
      build('https://tacticusanalytics.com.evil.example')
    )
    expect(result.passed).toBe(false)
    expect(result.severity).toBe('critical')
  })

  it('fails an opaque null origin', () => {
    const result = performSecurityChecks(build('null'))
    expect(result.passed).toBe(false)
  })

  it('passes an exact allowlisted origin', () => {
    expect(
      performSecurityChecks(build('https://www.tacticusanalytics.com')).passed
    ).toBe(true)
  })

  it('passes an origin-less server-to-server call', () => {
    expect(performSecurityChecks(build(null)).passed).toBe(true)
  })
})
