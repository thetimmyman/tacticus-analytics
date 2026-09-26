import { NextRequest } from 'next/server'
import { APP_ORIGINS } from '@tacticus/app-core/app-config'
import { RATE_LIMIT_CONFIG } from '@/app/lib/middleware/rate-limit-config'

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
    const allowedOrigins = [
      APP_ORIGINS.CURRENT,
      'https://www.tacticusanalytics.com',
      'https://tacticusanalytics.com'
    ].filter((url): url is string => Boolean(url))

    if (
      origin &&
      !allowedOrigins.some((allowed) => origin.startsWith(allowed))
    ) {
      return {
        passed: false,
        reason: 'Unauthorized origin for admin endpoint',
        severity: 'critical'
      }
    }
  }

  return { passed: true, severity: 'low' }
}
