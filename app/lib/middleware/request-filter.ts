import { NextRequest } from 'next/server'
import { RATE_LIMIT_CONFIG } from '@/app/lib/middleware/rate-limit-config'
import {
  ADMIN_ALLOWED_ORIGINS,
  isAllowedOrigin
} from '@/app/lib/middleware/origin-allowlist'

const STATE_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * A request without Origin is not browser cross-site: server-to-server and test callers send
 * none. A present Origin must match exactly, so a look-alike like `evil-tacticusanalytics.com`
 * and the opaque `Origin: null` are both refused. A missing request carries no Origin.
 */
export function isCrossSiteAdminWrite(
  request: Pick<NextRequest, 'method' | 'headers'> | null | undefined
): boolean {
  if (!request) return false
  if (!STATE_MUTATING_METHODS.has(request.method)) return false
  const origin = request.headers.get('origin')
  if (origin === null) return false
  return !isAllowedOrigin(origin, ADMIN_ALLOWED_ORIGINS)
}

export interface SecurityCheck {
  passed: boolean
  reason?: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}

const BLOCKED_USER_AGENTS_LOWER: readonly string[] =
  RATE_LIMIT_CONFIG.security.blockedUserAgents.map((agent) =>
    agent.toLowerCase()
  )

export function performSecurityChecks(request: NextRequest): SecurityCheck {
  const userAgent = request.headers.get('user-agent') || ''
  const origin = request.headers.get('origin')
  const userAgentLower = userAgent.toLowerCase()

  for (const blockedAgent of BLOCKED_USER_AGENTS_LOWER) {
    if (userAgentLower.includes(blockedAgent)) {
      return {
        passed: false,
        reason: `Blocked user agent: ${blockedAgent}`,
        severity: 'high'
      }
    }
  }

  for (const pattern of RATE_LIMIT_CONFIG.security.suspiciousPatterns) {
    if (pattern.test(userAgent)) {
      return {
        passed: false,
        reason: 'Suspicious user agent pattern detected',
        severity: 'medium'
      }
    }
  }

  if (!userAgent) {
    return {
      passed: false,
      reason: 'Missing user agent header',
      severity: 'medium'
    }
  }

  if (request.nextUrl.pathname.startsWith('/api/admin/')) {
    // get() is null for a missing header, so `Origin: null` still reaches the exact match.
    if (origin !== null && !isAllowedOrigin(origin, ADMIN_ALLOWED_ORIGINS)) {
      return {
        passed: false,
        reason: 'Unauthorized origin for admin endpoint',
        severity: 'critical'
      }
    }
  }

  return { passed: true, severity: 'low' }
}
