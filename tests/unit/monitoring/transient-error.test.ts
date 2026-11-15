import { describe, expect, it } from 'vitest'
import { hasTransientCause } from '@/app/lib/monitoring/transient-error'

function wrapped(cause: unknown): Error {
  return new Error('Unable to verify account access', { cause })
}

describe('hasTransientCause', () => {
  it('matches a transient network failure in the cause chain', () => {
    expect(hasTransientCause(wrapped(new Error('fetch failed')))).toBe(true)
    expect(hasTransientCause(wrapped(new Error('socket hang up')))).toBe(true)
    expect(hasTransientCause(wrapped(new Error('read ECONNRESET')))).toBe(true)
    expect(hasTransientCause(wrapped(new Error('connect ETIMEDOUT')))).toBe(
      true
    )
  })

  it('matches a schema cache failure in the cause chain', () => {
    expect(hasTransientCause(wrapped(new Error('schema cache is stale')))).toBe(
      true
    )
    expect(
      hasTransientCause(
        wrapped(new Error('the function does not exist in the schema cache'))
      )
    ).toBe(true)
  })

  it('walks a nested cause chain', () => {
    const root = new Error('fetch failed')
    const middle = new Error('lookup failed', { cause: root })
    expect(hasTransientCause(wrapped(middle))).toBe(true)
  })

  it('does not match a non-transient cause', () => {
    expect(hasTransientCause(wrapped(new Error('permission denied')))).toBe(
      false
    )
  })

  it('does not match when there is no cause', () => {
    expect(
      hasTransientCause(new Error('Unable to verify account access'))
    ).toBe(false)
  })

  it('tolerates non-error causes and cycles', () => {
    expect(hasTransientCause(wrapped('fetch failed'))).toBe(false)
    expect(hasTransientCause(wrapped(null))).toBe(false)

    const a = new Error('a')
    const b = new Error('b', { cause: a })
    a.cause = b
    expect(hasTransientCause(wrapped(a))).toBe(false)
  })
})
