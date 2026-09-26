import { describe, it, expect } from 'vitest'
import { AppError, ErrorCode, Errors } from '@/app/lib/errors/AppError'

describe('AppError', () => {
  it('should create an AppError instance with correct properties', () => {
    const error = new AppError(
      ErrorCode.NOT_FOUND,
      'Resource not found',
      404,
      false,
      { id: '123' }
    )

    expect(error).toBeInstanceOf(AppError)
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe(ErrorCode.NOT_FOUND)
    expect(error.message).toBe('Resource not found')
    expect(error.statusCode).toBe(404)
    expect(error.retryable).toBe(false)
    expect(error.metadata).toEqual({ id: '123' })
    expect(error.name).toBe('AppError')
  })

  it('should correctly convert to JSON', () => {
    const error = new AppError(
      ErrorCode.VALIDATION_FAILED,
      'Invalid input',
      400,
      false,
      { field: 'email' }
    )
    const json = error.toJSON()

    expect(json).toEqual({
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Invalid input',
        retryable: false,
        metadata: { field: 'email' }
      }
    })
  })

  it('should omit metadata in JSON if not provided', () => {
    const error = new AppError(ErrorCode.INTERNAL_ERROR, 'Error', 500)
    const json = error.toJSON()

    expect(json.error).not.toHaveProperty('metadata')
    expect(json.error.retryable).toBe(false) // Default value
  })
})

describe('Errors Factory', () => {
  it('should create unauthorized error', () => {
    const error = Errors.unauthorized()
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED)
    expect(error.statusCode).toBe(401)
  })

  it('should create forbidden error', () => {
    const error = Errors.forbidden()
    expect(error.code).toBe(ErrorCode.FORBIDDEN)
    expect(error.statusCode).toBe(403)
  })

  it('should create notFound error', () => {
    const error = Errors.notFound('User')
    expect(error.code).toBe(ErrorCode.NOT_FOUND)
    expect(error.message).toBe('User not found')
    expect(error.statusCode).toBe(404)
  })

  it('should create validation error', () => {
    const error = Errors.validation('Bad email', { field: 'email' })
    expect(error.code).toBe(ErrorCode.VALIDATION_FAILED)
    expect(error.statusCode).toBe(400)
    expect(error.metadata).toEqual({ field: 'email' })
  })

  it('should create internal error', () => {
    const error = Errors.internal()
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR)
    expect(error.statusCode).toBe(500)
    expect(error.retryable).toBe(true)
  })

  it('should create rateLimit error', () => {
    const error = Errors.rateLimit(60)
    expect(error.code).toBe(ErrorCode.RATE_LIMITED)
    expect(error.statusCode).toBe(429)
    expect(error.metadata).toEqual({ retryAfter: 60 })
  })
})
