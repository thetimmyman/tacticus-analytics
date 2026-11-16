import { describe, expect, it } from 'vitest'
import { isTransientBrowserBoundaryError } from '@/app/lib/monitoring/browser-boundary-filter'

describe('isTransientBrowserBoundaryError', () => {
  it.each([
    [
      'native DOMException AbortError (numeric code 20)',
      Object.assign(
        new DOMException('The operation was aborted.', 'AbortError'),
        { code: 20 }
      )
    ],
    [
      'Error-shaped AbortError',
      Object.assign(new Error('The operation was aborted.'), {
        name: 'AbortError'
      })
    ],
    ['Chrome fetch network TypeError', new TypeError('Failed to fetch')],
    [
      'Chrome fetch network TypeError with origin hint',
      new TypeError('Failed to fetch (example.test)')
    ],
    ['WebKit fetch network TypeError', new TypeError('Load failed')],
    [
      'Firefox fetch network TypeError',
      new TypeError('NetworkError when attempting to fetch resource.')
    ],
    ['Node/Undici fetch network TypeError', new TypeError('fetch failed')],
    [
      'wrapped native DOMException AbortError in cause chain',
      new Error('Boundary render interrupted', {
        cause: new DOMException('The user aborted a request.', 'AbortError')
      })
    ],
    [
      'fail-closed access wrapper with verified transport cause',
      new Error('Unable to verify account access', {
        cause: new TypeError('fetch failed')
      })
    ],
    [
      'fail-closed access wrapper with verified PostgREST transport cause object',
      new Error('Unable to verify account access', {
        cause: {
          message: 'TypeError: fetch failed',
          details: 'TypeError: fetch failed',
          hint: '',
          code: ''
        }
      })
    ]
  ])('returns true for %s', (_label, error) => {
    expect(isTransientBrowserBoundaryError(error)).toBe(true)
  })

  it.each([
    [
      'ordinary null-deref TypeError',
      new TypeError("Cannot read properties of undefined (reading 'map')")
    ],
    ['ordinary application Error', new Error('Unexpected state transition')],
    [
      'native DOMException NotFoundError (numeric code 8)',
      new DOMException('Node was not found', 'NotFoundError')
    ],
    [
      'AbortError with non-abort numeric code',
      Object.assign(new Error('The operation was aborted.'), {
        name: 'AbortError',
        code: 8
      })
    ],
    [
      'TypeError with non-zero HTTP status',
      Object.assign(new TypeError('Failed to fetch'), { status: 500 })
    ],
    [
      'TypeError with non-zero statusCode',
      Object.assign(new TypeError('Load failed'), { statusCode: 403 })
    ],
    [
      'AbortError carrying a SQL/PostgREST error code',
      Object.assign(new Error('The operation was aborted.'), {
        name: 'AbortError',
        code: '42501'
      })
    ],
    [
      'AbortError carrying non-transient auth diagnosis',
      Object.assign(new Error('AbortError: permission denied for table'), {
        name: 'AbortError'
      })
    ],
    [
      'HTTP 403 wrapper containing TypeError(Failed to fetch)',
      Object.assign(new Error('Request failed'), {
        status: 403,
        cause: new TypeError('Failed to fetch')
      })
    ],
    [
      'HTTP statusCode 403 wrapper containing TypeError(Failed to fetch)',
      Object.assign(new Error('Request failed'), {
        statusCode: 403,
        cause: new TypeError('Failed to fetch')
      })
    ],
    [
      'SQL-code 42501 wrapper containing TypeError(Failed to fetch)',
      Object.assign(new Error('Query failed'), {
        code: '42501',
        cause: new TypeError('Failed to fetch')
      })
    ],
    [
      'permission denied wrapper containing TypeError(Failed to fetch)',
      new Error('permission denied for table guild_config', {
        cause: new TypeError('Failed to fetch')
      })
    ],
    [
      'fetch TypeError with a SQL Error cause',
      new TypeError('Failed to fetch', {
        cause: Object.assign(new Error('query failed'), { code: '42501' })
      })
    ],
    [
      'fetch TypeError with a plain-object SQL cause',
      new TypeError('Failed to fetch', {
        cause: {
          message: 'permission denied for table sync_queue',
          code: '42501',
          details: null,
          hint: null
        }
      })
    ],
    [
      'fetch TypeError with an HTTP 403 Error cause',
      new TypeError('Failed to fetch', {
        cause: Object.assign(new Error('Forbidden'), { status: 403 })
      })
    ],
    [
      'fetch TypeError with a non-transient application Error cause',
      new TypeError('Failed to fetch', {
        cause: new Error('Unexpected reducer state')
      })
    ],
    [
      'Unable to verify account access wrapper with nested SQL cause beneath fetch TypeError',
      new Error('Unable to verify account access', {
        cause: new TypeError('fetch failed', {
          cause: Object.assign(new Error('permission denied'), {
            code: '42501'
          })
        })
      })
    ],
    ['non-Error value', { name: 'AbortError', message: 'aborted' }],
    ['null', null],
    ['undefined', undefined]
  ])('returns false for %s', (_label, error) => {
    expect(isTransientBrowserBoundaryError(error)).toBe(false)
  })

  it('terminates safely on cyclic cause chains', () => {
    const first = new Error('Outer wrapper')
    const second = new Error('Inner wrapper', { cause: first })
    ;(first as { cause?: unknown }).cause = second

    expect(isTransientBrowserBoundaryError(first)).toBe(false)
  })

  it('rejects cause chains that exceed the maximum traversal depth even if a deeper cause is transient', () => {
    let current: Error = new TypeError('Failed to fetch')
    for (let i = 0; i < 8; i += 1) {
      current = new Error(`Wrapper ${i}`, { cause: current })
    }

    expect(isTransientBrowserBoundaryError(current)).toBe(false)
  })
})
