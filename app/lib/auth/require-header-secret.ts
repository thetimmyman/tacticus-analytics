import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { Errors } from '@/app/lib/errors/AppError'

/**
 * Constant-time compare (`===` leaks the secret via timing). Lengths are checked on UTF-8
 * buffers, because timingSafeEqual throws on unequal byte lengths and a string-length check
 * would turn non-ASCII headers into 500s instead of 401s.
 */
export const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

interface RequireHeaderSecretOptions {
  secret: string | undefined
  headerName: string
  endpoint: string
}

/**
 * Fail-closed header-secret check: an unset/empty server secret throws 500 (a missing env var
 * must never disable auth); a missing or wrong header throws 401.
 */
export function requireHeaderSecret(
  req: NextRequest,
  opts: RequireHeaderSecretOptions
): void {
  const { secret, headerName, endpoint } = opts

  if (!secret) {
    throw Errors.fromResponse(500, {
      error: `${headerName} secret is not configured`
    })
  }

  const provided = req.headers.get(headerName)
  if (!provided || !safeEqual(provided, secret)) {
    throw Errors.authenticationRequired('Invalid webhook secret', { endpoint })
  }
}

interface RequireBearerSecretOptions {
  secret: string | undefined
  /** Used only in the 500 "not configured" message. */
  envVarName: string
  endpoint: string
}

/** `Authorization: Bearer` variant with the same fail-closed contract as requireHeaderSecret. */
export function requireBearerSecret(
  req: NextRequest,
  opts: RequireBearerSecretOptions
): void {
  const { secret, envVarName, endpoint } = opts

  if (!secret) {
    throw Errors.fromResponse(500, {
      error: `${envVarName} is not configured`
    })
  }

  const authHeader = req.headers.get('authorization')
  const expected = `Bearer ${secret}`
  if (!authHeader || !safeEqual(authHeader, expected)) {
    throw Errors.authenticationRequired('Unauthorized', { endpoint })
  }
}
