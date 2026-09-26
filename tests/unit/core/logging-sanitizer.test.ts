import { describe, it, expect } from 'vitest'
import {
  maskSensitive,
  sanitizeErrorForLog
} from '@tacticus/app-core/logging-sanitizer'

const stripeLikeSecret = () =>
  ['sk', 'live', '1234567890abcdefghijklmnop'].join('_')
const jwtLikeSecret = () =>
  ['eyJhbGciOiJIUzI1NiIs', 'InR5cCI6IkpXVCJ9'].join('')
const keyLikeSecret = (prefix = 'sk') =>
  [prefix, '1234567890abcdefghijklmnop'].join('_')

describe('Logging Sanitizer', () => {
  describe('maskSensitive', () => {
    describe('string masking', () => {
      it('masks long alphanumeric strings (potential secrets)', () => {
        const secret = stripeLikeSecret()
        expect(maskSensitive(secret)).toBe('[REDACTED]')
      })

      it('masks API keys in strings', () => {
        const apiKey = jwtLikeSecret()
        expect(maskSensitive(apiKey)).toBe('[REDACTED]')
      })

      it('preserves short strings', () => {
        expect(maskSensitive('hello')).toBe('hello')
        expect(maskSensitive('short123')).toBe('short123')
      })

      it('masks multiple secrets in one string', () => {
        const str = `Key1: ${keyLikeSecret()} and Key2: ${keyLikeSecret('pk')}`
        const result = maskSensitive(str) as string
        expect(result).toBe('Key1: [REDACTED] and Key2: [REDACTED]')
      })

      it('preserves normal text around secrets', () => {
        const str = `Error with key ${keyLikeSecret()} in request`
        const result = maskSensitive(str) as string
        expect(result).toContain('Error with key')
        expect(result).toContain('in request')
        expect(result).toContain('[REDACTED]')
      })
    })

    describe('array handling', () => {
      it('masks secrets in array elements', () => {
        const arr = ['normal', keyLikeSecret(), 'also normal']
        const result = maskSensitive(arr) as string[]
        expect(result[0]).toBe('normal')
        expect(result[1]).toBe('[REDACTED]')
        expect(result[2]).toBe('also normal')
      })

      it('handles nested arrays', () => {
        const arr = [[keyLikeSecret()]]
        const result = maskSensitive(arr) as string[][]
        expect(result[0][0]).toBe('[REDACTED]')
      })

      it('handles empty arrays', () => {
        expect(maskSensitive([])).toEqual([])
      })
    })

    describe('object handling', () => {
      it('sanitizes objects using sanitizeErrorForLog', () => {
        const obj = { message: keyLikeSecret() }
        const result = maskSensitive(obj) as Record<string, unknown>
        expect(result.message).toBe('[REDACTED]')
      })
    })

    describe('primitive handling', () => {
      it('returns numbers unchanged', () => {
        expect(maskSensitive(123)).toBe(123)
        expect(maskSensitive(0)).toBe(0)
        expect(maskSensitive(-456)).toBe(-456)
      })

      it('returns booleans unchanged', () => {
        expect(maskSensitive(true)).toBe(true)
        expect(maskSensitive(false)).toBe(false)
      })

      it('returns null unchanged', () => {
        expect(maskSensitive(null)).toBeNull()
      })

      it('returns undefined unchanged', () => {
        expect(maskSensitive(undefined)).toBeUndefined()
      })
    })
  })

  describe('sanitizeErrorForLog', () => {
    describe('Error object handling', () => {
      it('extracts name, message, and stack from Error', () => {
        const error = new Error('Test error message')
        const result = sanitizeErrorForLog(error)

        expect(result.name).toBe('Error')
        expect(result.message).toBe('Test error message')
        expect(result.stack).toBeDefined()
      })

      it('masks secrets in error message', () => {
        const error = new Error(`Failed with key ${keyLikeSecret()}`)
        const result = sanitizeErrorForLog(error)

        expect(result.message).toContain('[REDACTED]')
        expect(result.message).not.toContain('sk_1234567890')
      })

      it('masks secrets in error stack', () => {
        const error = new Error('Error')
        error.stack = `Error: ${keyLikeSecret()}\n    at test.js:1:1`
        const result = sanitizeErrorForLog(error)

        expect(result.stack).toContain('[REDACTED]')
      })

      it('handles errors without stack', () => {
        const error = new Error('Test')
        error.stack = undefined
        const result = sanitizeErrorForLog(error)

        expect(result.stack).toBeUndefined()
      })
    })

    describe('Object handling', () => {
      it('masks string values containing secrets', () => {
        const obj = {
          key: keyLikeSecret(),
          normal: 'hello'
        }
        const result = sanitizeErrorForLog(obj)

        expect(result.key).toBe('[REDACTED]')
        expect(result.normal).toBe('hello')
      })

      it('redacts api_key fields regardless of value', () => {
        const obj = {
          api_key: 'short',
          apiKey: 'also short',
          'api-key': 'another'
        }
        const result = sanitizeErrorForLog(obj)

        expect(result.api_key).toBe('[REDACTED]')
        expect(result.apiKey).toBe('[REDACTED]')
        expect(result['api-key']).toBe('[REDACTED]')
      })

      it('handles nested objects', () => {
        const obj = {
          outer: {
            inner: {
              secret: keyLikeSecret()
            }
          }
        }
        const result = sanitizeErrorForLog(obj)

        expect((result.outer as any).inner.secret).toBe('[REDACTED]')
      })

      it('preserves non-string, non-object values', () => {
        const obj = {
          count: 42,
          active: true,
          data: null
        }
        const result = sanitizeErrorForLog(obj)

        expect(result.count).toBe(42)
        expect(result.active).toBe(true)
        expect(result.data).toBeNull()
      })

      it('handles circular references', () => {
        const obj: any = { name: 'test' }
        obj.self = obj

        const result = sanitizeErrorForLog(obj)

        expect(result.name).toBe('test')
        expect((result.self as any).message).toBe('[Circular reference]')
      })
    })

    describe('String handling', () => {
      it('wraps string in message object', () => {
        const result = sanitizeErrorForLog('Simple error string')
        expect(result.message).toBe('Simple error string')
      })

      it('masks secrets in string errors', () => {
        const result = sanitizeErrorForLog(`Error with ${keyLikeSecret()}`)
        expect(result.message).toContain('[REDACTED]')
      })
    })

    describe('Primitive handling', () => {
      it('wraps number in value object', () => {
        const result = sanitizeErrorForLog(404)
        expect(result.value).toBe(404)
      })

      it('wraps boolean in value object', () => {
        const result = sanitizeErrorForLog(false)
        expect(result.value).toBe(false)
      })

      it('returns unknown error for undefined', () => {
        const result = sanitizeErrorForLog(undefined)
        expect(result.message).toBe('Unknown error')
      })

      it('returns unknown error for null', () => {
        const result = sanitizeErrorForLog(null)
        expect(result.message).toBe('Unknown error')
      })
    })

    describe('Edge cases', () => {
      it('handles empty object', () => {
        const result = sanitizeErrorForLog({})
        expect(result.message).toBe('Unknown error')
      })

      it('handles object with only message field', () => {
        const result = sanitizeErrorForLog({ message: 'Custom message' })
        expect(result.message).toBe('Custom message')
      })

      it('handles arrays as objects', () => {
        const arr = ['a', 'b', 'c']
        const result = sanitizeErrorForLog(arr)
        expect(result['0']).toBe('a')
        expect(result['1']).toBe('b')
        expect(result['2']).toBe('c')
      })

      it('handles deeply nested structures', () => {
        const deep = {
          level1: {
            level2: {
              level3: {
                secret: keyLikeSecret()
              }
            }
          }
        }
        const result = sanitizeErrorForLog(deep)
        expect((result.level1 as any).level2.level3.secret).toBe('[REDACTED]')
      })
    })
  })
})
