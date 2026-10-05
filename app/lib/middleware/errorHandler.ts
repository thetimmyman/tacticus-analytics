/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { AppError, ErrorCode, Errors } from '@/app/lib/errors/AppError'
import { captureException, setTag as setSentryTag } from '@sentry/nextjs'
import { ZodError } from 'zod'
import { AuthError } from '@/app/lib/auth'
import { logger, logError, generateRequestId } from '@/app/lib/logging'
import {
  associatedRequestId,
  isSafeRequestId
} from '@/app/lib/logging/correlation-id'
import { enforceJsonBodyLimit } from '@/app/lib/middleware/request-body-limit'

function requestPathname(req?: { url?: string }): string {
  if (!req?.url) return '/unknown'
  try {
    return new URL(req.url).pathname
  } catch {
    return '/unknown'
  }
}

const KNOWN_HTTP_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS'
])

// Parent route ('*' = dynamic segment) -> its static child dirs; any other child is a [param].
// Kept in sync with app/api by a test, because a dynamic value can look like a route word.
export const DYNAMIC_ROUTE_PARENTS: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  ['api/admin/carousel', new Set<string>()],
  ['api/admin/gdpr/exports', new Set<string>()],
  ['api/admin/global-thresholds', new Set<string>()],
  ['api/gdpr/my-data', new Set<string>()],
  ['api/officer/coaching-tasks', new Set<string>()],
  ['api/playbooks', new Set(['seasonal-hub'])],
  ['api/wars', new Set(['analytics'])]
])

// Tag values must never carry request data: only known methods and static route words survive.
export function sentryOperationTag(
  method: string | undefined,
  pathname: string
): string {
  const safeMethod =
    method && KNOWN_HTTP_METHODS.has(method) ? method : 'UNKNOWN'
  // Parent keys use '*' for an already-masked dynamic segment so nested params resolve too.
  const template: string[] = []
  const safeSegments = pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const staticChildren = DYNAMIC_ROUTE_PARENTS.get(template.join('/'))
      const isDynamic =
        staticChildren !== undefined && !staticChildren.has(segment)
      template.push(isDynamic ? '*' : segment)
      if (isDynamic) return '_'
      return /^[a-z][a-z-]{0,39}$/u.test(segment) ? segment : '_'
    })

  return `${safeMethod}:${safeSegments.join('.')}`.slice(0, 80)
}

function sentryErrorTags(
  method: string | undefined,
  pathname: string,
  statusCode: number,
  errorCode?: unknown
): Record<string, string> {
  const tags: Record<string, string> = {
    operation: sentryOperationTag(method, pathname),
    status_code: /^[1-5][0-9]{2}$/u.test(String(statusCode))
      ? String(statusCode)
      : 'invalid'
  }
  if (errorCode !== undefined) {
    tags.error_code = Number.isInteger(errorCode)
      ? String(errorCode)
      : 'invalid'
  }
  return tags
}

export function withErrorHandler(
  handler: (req: NextRequest, ...args: any[]) => Promise<Response>,
  options: { maxJsonBodyBytes?: () => number } = {}
) {
  return async (req: NextRequest, ...args: any[]): Promise<Response> => {
    const bodyLimitResponse = enforceJsonBodyLimit(
      req,
      options.maxJsonBodyBytes?.()
    )
    if (bodyLimitResponse) {
      return applyRateLimitHeaders(bodyLimitResponse, req)
    }

    try {
      const response = await handler(req, ...args)
      const normalized = await normalizeErrorResponse(response, req)
      return applyRateLimitHeaders(normalized, req)
    } catch (error) {
      return applyRateLimitHeaders(
        handleError(error, req, associatedRequestId(req)),
        req
      )
    }
  }
}

export function handleError(
  error: unknown,
  req?: NextRequest,
  requestId?: string
): NextResponse {
  // Request headers are ignored: a UUID shape cannot establish provenance.
  const reqId = isSafeRequestId(requestId) ? requestId : generateRequestId()
  const pathname = requestPathname(req)

  try {
    setSentryTag('request_id', reqId)
  } catch {
    // Sentry might not be initialized
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logError(logger, error, 'Application error', {
        requestId: reqId,
        method: req?.method,
        url: pathname,
        errorCode: error.code,
        statusCode: error.statusCode
      })
      captureException(error, {
        tags: sentryErrorTags(
          req?.method,
          pathname,
          error.statusCode,
          error.code
        )
      })
    } else {
      logger.warn(
        {
          requestId: reqId,
          method: req?.method,
          url: pathname,
          errorCode: error.code,
          statusCode: error.statusCode
        },
        'Application request rejected'
      )
    }
    return createErrorResponse(error.toJSON(), error.statusCode, reqId)
  }

  if (error instanceof AuthError) {
    const metadata = {
      authCode: error.code,
      requiredRole: error.requiredRole,
      currentRole: error.currentRole
    }
    const appError =
      error.code === 'UNAUTHENTICATED'
        ? Errors.unauthorized(error.message, metadata)
        : Errors.forbidden(error.message, metadata)

    logger.warn(
      {
        requestId: reqId,
        method: req?.method,
        url: pathname,
        authCode: error.code
      },
      'Authentication request rejected'
    )

    return createErrorResponse(appError.toJSON(), appError.statusCode, reqId)
  }

  if (error instanceof ZodError) {
    logger.warn(
      {
        requestId: reqId,
        method: req?.method,
        url: pathname,
        issues: error.issues.length
      },
      `ValidationError: ${error.issues.length} issues`
    )

    return createErrorResponse(
      {
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Validation failed',
          details: error.issues
        }
      },
      400,
      reqId
    )
  }

  logError(logger, error, 'Unhandled error', {
    requestId: reqId,
    method: req?.method,
    url: pathname
  })
  captureException(error, {
    tags: sentryErrorTags(req?.method, pathname, 500)
  })

  return createErrorResponse(
    {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
        requestId: reqId,
        retryable: true
      }
    },
    500,
    reqId
  )
}

export function rethrowIfAuthError(
  error: unknown,
  opts?: { successFalseEnvelope?: boolean }
): void {
  if (!(error instanceof AuthError)) return
  const status = error.code === 'UNAUTHENTICATED' ? 401 : 403
  if (opts?.successFalseEnvelope) {
    throw Errors.fromResponse(status, {
      success: false,
      error: error.message,
      code: error.code
    })
  }
  throw Errors.fromStatus(status, error.message, { code: error.code })
}

/** Expected condition: logged at warn without Sentry capture. Throw for anything unexpected. */
export function expectedErrorResponse(
  error: AppError,
  req?: NextRequest
): NextResponse {
  const requestId = associatedRequestId(req) ?? generateRequestId()
  logger.warn(
    {
      requestId,
      method: req?.method,
      url: requestPathname(req),
      errorCode: error.code,
      statusCode: error.statusCode
    },
    'Expected application condition'
  )
  return createErrorResponse(error.toJSON(), error.statusCode, requestId)
}

function createErrorResponse(
  body: unknown,
  status: number,
  requestId: string
): NextResponse {
  let payload: unknown = body

  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    typeof (body as { error?: unknown }).error === 'object'
  ) {
    const error = {
      ...(body as { error: Record<string, unknown> }).error,
      statusCode: status,
      requestId
    }
    // `metadata` is not stripped: clients depend on functional data in it. Raw
    // error text must be kept out at call sites instead.
    payload = { ...(body as Record<string, unknown>), error }
  } else {
    payload = {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
        retryable: status >= 500,
        statusCode: status,
        requestId
      }
    }
  }

  return NextResponse.json(payload, {
    status,
    headers: {
      'x-request-id': requestId
    }
  })
}

function applyRateLimitHeaders(
  response: Response,
  req?: NextRequest
): Response {
  if (!req?.rateLimitHeaders) {
    return response
  }

  for (const [key, value] of Object.entries(req.rateLimitHeaders)) {
    response.headers.set(key, value)
  }

  return response
}
async function normalizeErrorResponse(
  response: Response,
  req: NextRequest
): Promise<Response> {
  if (!response || response.status < 400) {
    return response
  }

  const contentType = response.headers.get('content-type') ?? ''
  const clone = response.clone()
  const pathname = requestPathname(req)

  let message: string | undefined
  let metadata: Record<string, unknown> | undefined
  let alreadyStandard = false

  if (contentType.includes('application/json')) {
    try {
      const body = await clone.json()
      if (body?.error && typeof body.error === 'object') {
        const code = (body.error as { code?: unknown }).code
        const msg = (body.error as { message?: unknown }).message
        if (
          (typeof code === 'number' || typeof code === 'string') &&
          typeof msg === 'string'
        ) {
          alreadyStandard = true
        } else if (typeof msg === 'string') {
          message = msg
          metadata = { ...body, error: { ...body.error } }
        }
      } else if (typeof body?.error === 'string') {
        message = body.error
        const meta = { ...body }
        if (meta.error) delete meta.error
        metadata = meta
      } else if (typeof body?.message === 'string') {
        message = body.message
        const meta = { ...body }
        if (meta.message) delete meta.message
        metadata = meta
      } else if (body && typeof body === 'object') {
        metadata = { ...body }
      }
    } catch (error) {
      logger.debug(
        {
          url: pathname,
          errorType: error instanceof Error ? error.name : 'NonError'
        },
        'Failed to parse JSON error response'
      )
    }
  } else {
    try {
      const text = await clone.text()
      if (text) {
        message = text
      }
    } catch (error) {
      logger.debug(
        {
          url: pathname,
          errorType: error instanceof Error ? error.name : 'NonError'
        },
        'Failed to read error response body'
      )
    }
  }

  if (alreadyStandard) {
    return response
  }

  const appError = Errors.fromStatus(
    response.status,
    message || response.statusText || 'Request failed',
    metadata
  )

  const requestId = associatedRequestId(req) ?? generateRequestId()

  if (appError.statusCode >= 500) {
    logError(logger, appError, 'Normalized error response', {
      requestId,
      method: req.method,
      url: pathname,
      originalStatus: response.status
    })
    captureException(appError, {
      tags: sentryErrorTags(
        req.method,
        pathname,
        appError.statusCode,
        appError.code
      )
    })
  } else {
    logger.warn(
      {
        requestId,
        method: req?.method,
        url: pathname,
        status: appError.statusCode
      },
      'Normalized application request rejected'
    )
  }

  return createErrorResponse(appError.toJSON(), appError.statusCode, requestId)
}
