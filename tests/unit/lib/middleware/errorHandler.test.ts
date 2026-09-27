import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  withErrorHandler,
  handleError,
  sentryOperationTag,
  rethrowIfAuthError
} from '@/app/lib/middleware/errorHandler'
import { withRequestContext } from '@/app/lib/logging/request-context'
import { AppError, ErrorCode, Errors } from '@/app/lib/errors/AppError'
import { AuthError } from '@/app/lib/auth'
import { captureException } from '@sentry/nextjs'
import { ZodError } from 'zod'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn()
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      body,
      init,
      status: init?.status || 200,
      json: async () => body
    }))
  }
}))

describe('errorHandler', () => {
  let mockRequest: NextRequest

  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest = {
      url: 'http://localhost/api/test',
      method: 'GET'
    } as unknown as NextRequest
  })

  describe('sentryOperationTag', () => {
    it.each([
      ['GET', '/api/wars/analytics/cores', 'GET:api.wars.analytics.cores'],
      [
        'GET',
        '/api/players/123e4567-e89b-42d3-a456-426614174000',
        'GET:api.players._'
      ],
      ['GET', '/api/players/123', 'GET:api.players._'],
      ['GET', '/api/players/TestPlayerA', 'GET:api.players._'],
      ['GET', '/api/players/%41lice', 'GET:api.players._']
    ])('maps %s %s to a safe operation', (method, path, expected) => {
      const operation = sentryOperationTag(method, path)
      expect(operation).toBe(expected)
      expect(operation).toMatch(/^[A-Za-z0-9_.:-]{1,80}$/u)
    })

    it('truncates long paths and uses UNKNOWN for an unknown method', () => {
      const operation = sentryOperationTag(
        undefined,
        `/${'a'.repeat(40)}/${'b'.repeat(40)}`
      )
      expect(operation).toHaveLength(80)
      expect(operation).toMatch(/^[A-Za-z0-9_.:-]{1,80}$/u)
      expect(sentryOperationTag(undefined, '/unknown')).toBe('UNKNOWN:unknown')
      expect(sentryOperationTag('TESTPLAYERA', '/api/test')).toBe(
        'UNKNOWN:api.test'
      )
    })
  })

  describe('handleError', () => {
    it('should handle AppError and return correct response', () => {
      const error = Errors.notFound('Item')
      const response = handleError(error, mockRequest) as any

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe(ErrorCode.NOT_FOUND)
      expect(response.body.error.message).toBe(error.message)
      expect(response.body.error.statusCode).toBe(404)
      expect(response.body.error.requestId).toBeDefined()
      expect(captureException).not.toHaveBeenCalled() // 404 shouldn't be captured by default unless configured
    })

    it('replaces an attacker-controlled request ID before logging or returning it', () => {
      const victimUuid = '123e4567-e89b-42d3-a456-426614174000'
      mockRequest = {
        url: 'http://localhost/api/test',
        headers: new Headers({ 'x-request-id': victimUuid })
      } as unknown as NextRequest

      const response = handleError(Errors.notFound('Item'), mockRequest) as any

      expect(response.body.error.requestId).not.toBe(victimUuid)
      expect(response.body.error.requestId).toMatch(
        /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      )
    })

    it('should capture AppError in Sentry if statusCode >= 500', () => {
      const error = Errors.internal()
      handleError(error, mockRequest)

      expect(captureException).toHaveBeenCalledWith(error, {
        tags: {
          operation: 'GET:api.test',
          status_code: '500',
          error_code: String(error.code)
        }
      })
    })

    it('should handle ZodError and return 400', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['name'],
          message: 'Expected string, received number'
        }
      ])

      const response = handleError(zodError, mockRequest) as any

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe(ErrorCode.VALIDATION_FAILED)
      expect(response.body.error.details).toEqual(zodError.issues)
      expect(response.body.error.statusCode).toBe(400)
      expect(response.body.error.requestId).toBeDefined()
    })

    it('should handle unknown errors and return 500', () => {
      const error = new Error('Random crash')
      const response = handleError(error, mockRequest) as any

      expect(response.status).toBe(500)
      expect(response.body.error.code).toBe(ErrorCode.INTERNAL_ERROR)
      expect(response.body.error.statusCode).toBe(500)
      expect(response.body.error.requestId).toBeDefined()
      expect(captureException).toHaveBeenCalledWith(error, {
        tags: { operation: 'GET:api.test', status_code: '500' }
      })
    })

    it('preserves curated message AND functional metadata on >=500 [WI-1930]', () => {
      // Metadata carries functional client data that must survive a 500.
      const error = Errors.database('Database operation failed', {
        requiresNewKey: true
      })
      const response = handleError(error, mockRequest) as any

      expect(response.status).toBeGreaterThanOrEqual(500)
      expect(response.body.error.message).toBe('Database operation failed')
      expect(response.body.error.metadata?.requiresNewKey).toBe(true)
      expect(response.body.error.code).toBeDefined()
      expect(response.body.error.requestId).toBeDefined()
    })
  })

  describe('withErrorHandler', () => {
    it('rejects an oversized mutating request before invoking the handler', async () => {
      mockRequest = {
        url: 'http://localhost/api/internal/cron',
        method: 'POST',
        headers: new Headers({
          'content-length': String(10 * 1024 * 1024)
        })
      } as unknown as NextRequest
      const handler = vi.fn()

      const response = (await withErrorHandler(handler)(mockRequest)) as any

      expect(response.status).toBe(413)
      expect(response.body).toEqual({
        error: 'Payload too large',
        maxBytes: 10 * 1024 * 1024
      })
      expect(handler).not.toHaveBeenCalled()
    })

    it('does not enable user-agent filtering on newly capped routes', async () => {
      mockRequest = {
        url: 'http://localhost/api/internal/cron',
        method: 'POST',
        headers: new Headers({
          'content-length': '32',
          'user-agent': 'curl/8.0'
        })
      } as unknown as NextRequest
      const mockResponse = { status: 200 } as any
      const handler = vi.fn().mockResolvedValue(mockResponse)

      const response = await withErrorHandler(handler)(mockRequest)

      expect(response).toBe(mockResponse)
      expect(handler).toHaveBeenCalledWith(mockRequest)
    })

    it('should call the handler and return its result if successful', async () => {
      const mockResponse = { status: 200 } as any
      const handler = vi.fn().mockResolvedValue(mockResponse)
      const wrapped = withErrorHandler(handler)

      const result = await wrapped(mockRequest)

      expect(handler).toHaveBeenCalledWith(mockRequest)
      expect(result).toBe(mockResponse)
    })

    it('should catch errors in handler and call handleError', async () => {
      const error = Errors.unauthorized()
      const handler = vi.fn().mockRejectedValue(error)
      const wrapped = withErrorHandler(handler)

      const response = (await wrapped(mockRequest)) as any

      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe(ErrorCode.UNAUTHORIZED)
      expect(response.body.error.statusCode).toBe(401)
      expect(response.body.error.requestId).toBeDefined()
    })

    it('reuses the request-context ID when composed middleware catches an error', async () => {
      let innerRequestId: string | undefined
      const wrapped = withErrorHandler(
        withRequestContext(async (_request, { requestId }) => {
          innerRequestId = requestId
          throw Errors.internal()
        })
      )

      const response = (await wrapped(mockRequest)) as any

      expect(innerRequestId).toMatch(/^req_/u)
      expect(response.body.error.requestId).toBe(innerRequestId)
    })
  })

  describe('rethrowIfAuthError', () => {
    const capture = (fn: () => void): AppError => {
      try {
        fn()
      } catch (e) {
        return e as AppError
      }
      throw new Error('expected rethrowIfAuthError to throw')
    }

    it('is a no-op for non-AuthError values (generic-500 fallthrough survives)', () => {
      expect(() => rethrowIfAuthError(new Error('boom'))).not.toThrow()
      expect(() => rethrowIfAuthError(undefined)).not.toThrow()
      expect(() => rethrowIfAuthError(Errors.internal())).not.toThrow()
    })

    it('maps UNAUTHENTICATED to a 401 AppError with { code } metadata', () => {
      const thrown = capture(() =>
        rethrowIfAuthError(
          new AuthError('Authentication required', 'UNAUTHENTICATED')
        )
      )
      expect(thrown).toBeInstanceOf(AppError)
      expect(thrown.statusCode).toBe(401)
      expect(thrown.message).toBe('Authentication required')
      expect(thrown.metadata).toEqual({ code: 'UNAUTHENTICATED' })
    })

    it('maps INSUFFICIENT_ROLE to a 403 AppError with { code } metadata', () => {
      const thrown = capture(() =>
        rethrowIfAuthError(
          new AuthError('Officer role required', 'INSUFFICIENT_ROLE')
        )
      )
      expect(thrown.statusCode).toBe(403)
      expect(thrown.metadata).toEqual({ code: 'INSUFFICIENT_ROLE' })
    })

    it('maps ONBOARDING_REQUIRED to 403 (only UNAUTHENTICATED is 401)', () => {
      const thrown = capture(() =>
        rethrowIfAuthError(
          new AuthError('Onboarding required', 'ONBOARDING_REQUIRED')
        )
      )
      expect(thrown.statusCode).toBe(403)
      expect(thrown.metadata).toEqual({ code: 'ONBOARDING_REQUIRED' })
    })

    it('emits the { success: false } envelope when opted in', () => {
      const thrown = capture(() =>
        rethrowIfAuthError(
          new AuthError('Authentication required', 'UNAUTHENTICATED'),
          { successFalseEnvelope: true }
        )
      )
      expect(thrown.statusCode).toBe(401)
      expect(thrown.message).toBe('Authentication required')
      expect(thrown.metadata).toEqual({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHENTICATED'
      })
    })
  })
})
