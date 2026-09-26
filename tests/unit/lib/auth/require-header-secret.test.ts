import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import {
  safeEqual,
  requireHeaderSecret,
  requireBearerSecret
} from '@/app/lib/auth/require-header-secret'
import { AppError } from '@/app/lib/errors/AppError'

const makeReq = (headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/x', { method: 'POST', headers })

const statusOf = (fn: () => void): number => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(AppError)
    return (e as AppError).statusCode
  }
  throw new Error('expected the call to throw, but it did not')
}

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('s3cr3t-value', 's3cr3t-value')).toBe(true)
  })

  it('returns false for same-length but different strings', () => {
    expect(safeEqual('abc123', 'abc124')).toBe(false)
  })

  it('returns false for different-length strings without throwing', () => {
    // timingSafeEqual throws on unequal lengths; the guard must short-circuit.
    expect(safeEqual('short', 'a-much-longer-secret')).toBe(false)
  })

  it('returns false for empty vs non-empty', () => {
    expect(safeEqual('', 'x')).toBe(false)
  })

  it('returns false (not RangeError) for equal string length but unequal UTF-8 byte length', () => {
    // 'é' is 2 UTF-8 bytes: a string-length check would let timingSafeEqual throw (a 500).
    expect(safeEqual('aé', 'abc')).toBe(false)
    expect(safeEqual('éé', 'ab')).toBe(false)
  })
})

describe('requireHeaderSecret', () => {
  const headerName = 'x-webhook-secret'
  const endpoint = '/api/test'

  it('fails closed (500) when the server secret is unset', () => {
    expect(
      statusOf(() =>
        requireHeaderSecret(makeReq({ 'x-webhook-secret': 'anything' }), {
          secret: undefined,
          headerName,
          endpoint
        })
      )
    ).toBe(500)
  })

  it('fails closed (500) when the server secret is an empty string', () => {
    expect(
      statusOf(() =>
        requireHeaderSecret(makeReq({ 'x-webhook-secret': 'anything' }), {
          secret: '',
          headerName,
          endpoint
        })
      )
    ).toBe(500)
  })

  it('rejects (401) when the header is absent', () => {
    expect(
      statusOf(() =>
        requireHeaderSecret(makeReq(), {
          secret: 'right',
          headerName,
          endpoint
        })
      )
    ).toBe(401)
  })

  it('rejects (401) when the header is wrong', () => {
    expect(
      statusOf(() =>
        requireHeaderSecret(makeReq({ 'x-webhook-secret': 'wrong' }), {
          secret: 'right',
          headerName,
          endpoint
        })
      )
    ).toBe(401)
  })

  it('passes when the header matches', () => {
    expect(() =>
      requireHeaderSecret(makeReq({ 'x-webhook-secret': 'right' }), {
        secret: 'right',
        headerName,
        endpoint
      })
    ).not.toThrow()
  })
})

describe('requireBearerSecret', () => {
  const envVarName = 'ONBOARDING_WORKER_TOKEN'
  const endpoint = '/api/test'

  it('fails closed (500) when the server secret is unset', () => {
    expect(
      statusOf(() =>
        requireBearerSecret(makeReq({ authorization: 'Bearer anything' }), {
          secret: undefined,
          envVarName,
          endpoint
        })
      )
    ).toBe(500)
  })

  it('rejects (401) when the Authorization header is absent', () => {
    expect(
      statusOf(() =>
        requireBearerSecret(makeReq(), {
          secret: 'right',
          envVarName,
          endpoint
        })
      )
    ).toBe(401)
  })

  it('rejects (401) when the bearer token is wrong', () => {
    expect(
      statusOf(() =>
        requireBearerSecret(makeReq({ authorization: 'Bearer wrong' }), {
          secret: 'right',
          envVarName,
          endpoint
        })
      )
    ).toBe(401)
  })

  it('rejects (401) when the scheme prefix is missing', () => {
    expect(
      statusOf(() =>
        requireBearerSecret(makeReq({ authorization: 'right' }), {
          secret: 'right',
          envVarName,
          endpoint
        })
      )
    ).toBe(401)
  })

  it('passes when the bearer token matches', () => {
    expect(() =>
      requireBearerSecret(makeReq({ authorization: 'Bearer right' }), {
        secret: 'right',
        envVarName,
        endpoint
      })
    ).not.toThrow()
  })
})
