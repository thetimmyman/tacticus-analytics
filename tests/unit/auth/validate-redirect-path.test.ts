import { describe, it, expect } from 'vitest'
import { validateRedirectPath } from '@/app/lib/auth/redirect'

describe('validateRedirectPath (WI-588)', () => {
  describe('accepts legitimate internal paths', () => {
    it('accepts /home', () => {
      expect(validateRedirectPath('/home')).toBe('/home')
    })

    it('accepts nested paths', () => {
      expect(validateRedirectPath('/profile/settings')).toBe(
        '/profile/settings'
      )
    })

    it('accepts paths with query strings', () => {
      expect(validateRedirectPath('/onboarding?step=2')).toBe(
        '/onboarding?step=2'
      )
    })

    it('accepts paths with encoded spaces', () => {
      expect(validateRedirectPath('/search?q=hello%20world')).toBe(
        '/search?q=hello world'
      )
    })

    it('accepts paths with hash fragments', () => {
      expect(validateRedirectPath('/docs#section-1')).toBe('/docs#section-1')
    })
  })

  describe('rejects control characters the browser would strip', () => {
    it.each([
      ['/%0A/evil.com'],
      ['/%09/evil.com'],
      ['/%0D/evil.com'],
      ['/%00/home']
    ])('rejects %s', (raw) => {
      expect(validateRedirectPath(raw)).toBeNull()
    })

    it('rejects the double-encoded newline LoginForm receives from useSearchParams', () => {
      // ?redirectTo=/%250A/evil.com -> useSearchParams() -> "/%0A/evil.com"
      const fromSearchParams = new URLSearchParams(
        'redirectTo=/%250A/evil.com'
      ).get('redirectTo')
      expect(validateRedirectPath(fromSearchParams)).toBeNull()
    })
  })

  describe('rejects protocol-relative bypasses', () => {
    it('rejects raw //evil.com', () => {
      expect(validateRedirectPath('//evil.com')).toBeNull()
    })

    it('rejects URL-encoded %2F%2Fevil.com', () => {
      expect(validateRedirectPath('%2F%2Fevil.com')).toBeNull()
    })

    it('rejects mixed-encoded /%2Fevil.com', () => {
      expect(validateRedirectPath('/%2Fevil.com')).toBeNull()
    })
  })

  describe('rejects backslash bypasses', () => {
    it('rejects /\\evil.com', () => {
      expect(validateRedirectPath('/\\evil.com')).toBeNull()
    })

    it('rejects URL-encoded /%5Cevil.com', () => {
      expect(validateRedirectPath('/%5Cevil.com')).toBeNull()
    })

    it('rejects double-backslash /\\\\evil.com', () => {
      expect(validateRedirectPath('/\\\\evil.com')).toBeNull()
    })
  })

  describe('rejects absolute URLs', () => {
    it('rejects https://evil.com', () => {
      expect(validateRedirectPath('https://evil.com')).toBeNull()
    })

    it('rejects javascript: scheme', () => {
      expect(validateRedirectPath('javascript:alert(1)')).toBeNull()
    })

    it('rejects data: scheme', () => {
      expect(validateRedirectPath('data:text/html,evil')).toBeNull()
    })
  })

  describe('handles edge cases gracefully', () => {
    it('returns null for null input', () => {
      expect(validateRedirectPath(null)).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(validateRedirectPath('')).toBeNull()
    })

    it('returns null for malformed percent-encoding without throwing', () => {
      expect(validateRedirectPath('%ZZ')).toBeNull()
    })

    it('returns null for lone percent sign', () => {
      expect(validateRedirectPath('/%')).toBeNull()
    })
  })
})
