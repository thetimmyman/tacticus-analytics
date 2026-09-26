import { describe, expect, it } from 'vitest'
import {
  extractErrorMessage,
  getErrorMessage
} from '@/app/components/gr-availability/error-helpers'

describe('GR availability error helpers', () => {
  it.each([
    [{ error: 'primary' }, 'primary'],
    [{ error: ' ', details: 'detail' }, 'detail'],
    [{ message: 'message' }, 'message'],
    [{ errors: ['first'] }, 'first'],
    [{ errors: [{ message: 'nested' }] }, 'nested']
  ])(
    'uses the shared structured payload policy for %o',
    (payload, expected) => {
      expect(extractErrorMessage(payload, 'fallback')).toBe(expected)
      expect(getErrorMessage(payload, 'fallback')).toBe(expected)
    }
  )

  it('preserves the curated extractor HTML fallback policy', () => {
    expect(extractErrorMessage('<html>bad gateway</html>', 'fallback')).toBe(
      'fallback'
    )
    expect(getErrorMessage('<html>bad gateway</html>', 'fallback')).toBe(
      '<html>bad gateway</html>'
    )
  })

  it('falls back for empty or unsupported payloads', () => {
    expect(extractErrorMessage({ errors: [] }, 'fallback')).toBe('fallback')
    expect(getErrorMessage(null, 'fallback')).toBe('fallback')
  })
})
