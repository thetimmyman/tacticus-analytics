import { describe, it, expect } from 'vitest'
import { AppError } from '@/app/lib/errors/AppError'
import { throwUserFacingError } from '@/app/lib/errors/user-facing'

const capture = (fn: () => never): AppError => {
  try {
    fn()
  } catch (e) {
    return e as AppError
  }
  throw new Error('expected throwUserFacingError to throw')
}

describe('throwUserFacingError', () => {
  it('throws an AppError at the given status with the user-facing body', () => {
    const thrown = capture(() =>
      throwUserFacingError('VALIDATION_ERROR', 'Guild code is required', 400, {
        component: 'test',
        action: 'validate'
      })
    )
    expect(thrown).toBeInstanceOf(AppError)
    expect(thrown.statusCode).toBe(400)
    expect(thrown.message).toBe('Guild code is required')
    expect(thrown.metadata).toEqual({
      error: 'Guild code is required',
      code: 'VALIDATION_ERROR',
      version: expect.any(String),
      supportMessage: expect.any(String)
    })
    expect((thrown.metadata as { version: string }).version).not.toBe('')
    expect(
      (thrown.metadata as { supportMessage: string }).supportMessage
    ).toContain('Bug Reports')
  })

  it('appends extraBody keys after the standard body keys', () => {
    const thrown = capture(() =>
      throwUserFacingError(
        'API_VALIDATION_FAILED',
        'API key validation failed',
        400,
        { component: 'test', action: 'validate_key', guildCode: 'ABC' },
        { extraBody: { details: 'bad key', recommendation: 'regenerate' } }
      )
    )
    expect(thrown.statusCode).toBe(400)
    const meta = thrown.metadata as Record<string, unknown>
    expect(meta).toMatchObject({
      error: 'API key validation failed',
      code: 'API_VALIDATION_FAILED',
      details: 'bad key',
      recommendation: 'regenerate'
    })
    expect(meta.version).toEqual(expect.any(String))
    expect(meta.supportMessage).toEqual(expect.any(String))
  })

  it('accepts a cause without altering the wire body', () => {
    const thrown = capture(() =>
      throwUserFacingError(
        'HISTORICAL_DATA_FAILED',
        'Failed to fetch data',
        500,
        { component: 'test', action: 'fetch' },
        { cause: new Error('db exploded') }
      )
    )
    expect(thrown.statusCode).toBe(500)
    expect(thrown.metadata).toEqual({
      error: 'Failed to fetch data',
      code: 'HISTORICAL_DATA_FAILED',
      version: expect.any(String),
      supportMessage: expect.any(String)
    })
  })
})
