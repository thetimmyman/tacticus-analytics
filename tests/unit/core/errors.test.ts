import { describe, it, expect } from 'vitest'
import {
  isParsedError,
  isDatabaseError,
  isApiError,
  isAuthError,
  parseError
} from '@tacticus/app-core/errors'

describe('App-core errors', () => {
  it('identifies parsed errors by code', () => {
    const error = Object.assign(new Error('oops'), { code: 'APP' })
    expect(isParsedError(error)).toBe(true)
  })

  it('identifies database errors', () => {
    const error = Object.assign(new Error('db'), { code: '23505' })
    expect(isDatabaseError(error)).toBe(true)
  })

  it('identifies api errors', () => {
    const error = Object.assign(new Error('api'), {
      code: 'API',
      statusCode: 400
    })
    expect(isApiError(error)).toBe(true)
  })

  it('identifies auth errors by code', () => {
    const error = Object.assign(new Error('auth'), { code: 'UNAUTHORIZED' })
    expect(isAuthError(error)).toBe(true)
    const invalid = Object.assign(new Error('auth'), { code: 'INVALID' })
    expect(isAuthError(invalid)).toBe(false)
  })

  it('passes through existing app errors', () => {
    const error = Object.assign(new Error('pass through'), { code: 'APP' })
    expect(parseError(error)).toBe(error)
  })

  it('parses standard Error objects', () => {
    const error = new Error('plain')
    const parsed = parseError(error)
    expect(parsed).not.toBe(error)
    expect(parsed.message).toBe('plain')
    expect(parsed.name).toBe('Error')
  })

  it('parses string errors', () => {
    const parsed = parseError('bad input')
    expect(parsed.message).toBe('bad input')
  })

  it('handles unknown error shapes', () => {
    const parsed = parseError(42)
    expect(parsed.message).toBe('An unknown error occurred')
  })
})
