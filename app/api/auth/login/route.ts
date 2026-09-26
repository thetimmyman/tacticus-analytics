import { NextRequest, NextResponse } from 'next/server'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { signInWithPassword } from '@/app/lib/auth'
import { Errors } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import {
  checkRateLimit,
  getClientIp,
  performSecurityChecks
} from '@/app/lib/middleware/rate-limit'
import { createComponentLogger, generateRequestId } from '@/app/lib/logging'

const logger = createComponentLogger('api.auth.login')

export const dynamic = 'force-dynamic'

type LoginRequestBody = {
  email?: string
  password?: string
  rememberMe?: boolean
  // Turnstile CAPTCHA is handled by Supabase.
}

const normalizeErrorCode = (message?: string | null): string => {
  if (!message) return 'AUTH_FAILED'

  const normalized = message.toLowerCase()
  if (normalized.includes('invalid login credentials')) {
    return 'LOGIN_INVALID_CREDENTIALS'
  }

  if (normalized.includes('email not confirmed')) {
    return 'EMAIL_NOT_CONFIRMED'
  }

  return 'AUTH_FAILED'
}

const telemetryLogger = createComponentLogger('auth-login')

export const POST = withErrorHandler(
  async (request: NextRequest): Promise<NextResponse> => {
    const requestId = generateRequestId()
    const startedAt = Date.now()

    const securityCheck = performSecurityChecks(request)
    if (!securityCheck.passed) {
      logger.warn(
        { reason: securityCheck.reason },
        '[AuthAPI] Security check failed'
      )
      telemetryLogger.warn(
        {
          event: 'security_check_failed',
          requestId,
          reason: securityCheck.reason
        },
        'Auth login blocked by security check'
      )
      throw Errors.fromResponse(403, {
        error: 'Request blocked',
        code: 'SECURITY_CHECK_FAILED',
        reason: securityCheck.reason
      })
    }

    // x-forwarded-for is caller-controlled and would let clients rotate buckets or block victims.
    const clientIp = getClientIp(request)
    const clientId = `auth:${clientIp}`

    const rateLimitResult = await checkRateLimit(
      clientId,
      '/api/auth/login',
      'default'
    )
    request.rateLimitHeaders = rateLimitResult.headers
    if (!rateLimitResult.allowed) {
      logger.warn(
        { clientIp, remaining: rateLimitResult.remaining },
        '[AuthAPI] Rate limit exceeded'
      )
      telemetryLogger.warn(
        {
          event: 'rate_limited',
          requestId,
          remaining: rateLimitResult.remaining,
          resetTime: rateLimitResult.resetTime
        },
        'Auth login rate limited'
      )
      throw Errors.fromResponse(429, {
        error: 'Too many login attempts. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        remaining: rateLimitResult.remaining,
        resetTime: rateLimitResult.resetTime
      })
    }

    let body: LoginRequestBody = {}
    try {
      body = (await request.json()) as LoginRequestBody
    } catch (error) {
      rethrowIfAppError(error)
      logger.error({ error }, '[AuthAPI] Failed to parse login request body')
      throw Errors.validation('Invalid request body', {
        endpoint: '/api/auth/login'
      })
    }
    const email = body.email?.trim().toLowerCase()
    const password = body.password
    const rememberMe = Boolean(body.rememberMe)

    if (!email || !password) {
      throw Errors.validation('Email and password are required', {
        code: 'FORM_VALIDATION_FAILED'
      })
    }

    const result = await signInWithPassword({
      email,
      password,
      rememberMe
    })

    if (!result.user || result.error) {
      const code =
        result.error?.code === 'ACCOUNT_BANNED'
          ? 'ACCOUNT_BANNED'
          : normalizeErrorCode(result.error?.message ?? undefined)
      const message =
        result.error?.message ||
        (code === 'LOGIN_INVALID_CREDENTIALS'
          ? 'Invalid email or password'
          : 'Unable to sign in with the provided credentials')

      telemetryLogger.warn(
        {
          event: 'login_failed',
          requestId,
          code,
          supabaseError: result.error?.code ?? null,
          rememberMe,
          durationMs: Date.now() - startedAt
        },
        'Auth login failed'
      )

      if (code === 'LOGIN_INVALID_CREDENTIALS') {
        throw Errors.unauthorized(message)
      } else if (code === 'ACCOUNT_BANNED') {
        throw Errors.forbidden(message, { code })
      } else {
        throw Errors.forbidden(message)
      }
    }

    logger.info({ userId: result.user.id }, '[AuthAPI] Login successful')
    telemetryLogger.info(
      {
        event: 'login_success',
        requestId,
        userId: result.user.id,
        rememberMe,
        durationMs: Date.now() - startedAt
      },
      'Auth login succeeded'
    )

    // Tokens in the body would leak into logs and captures.
    const response = NextResponse.json({
      success: true,
      user: result.user
    })
    response.headers.set('x-request-id', requestId)

    return response
  }
)
