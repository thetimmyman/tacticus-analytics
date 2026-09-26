import type { User } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { checkApiSecurity } from '@/app/lib/middleware/api-authz'
import { checkRateLimit, getClientId } from '@/app/lib/middleware/rate-limit'
import { enforceJsonBodyLimit } from '@/app/lib/middleware/request-body-limit'
import { performSecurityChecks } from '@/app/lib/middleware/request-filter'

export async function apiSecurityMiddleware(
  request: NextRequest,
  options: {
    requireAuth?: boolean
    requiredRole?: string[]
    skipRateLimit?: boolean
    skipSecurityChecks?: boolean
  } = {}
): Promise<NextResponse | null> {
  const bodyLimitResponse = enforceJsonBodyLimit(request)
  if (bodyLimitResponse) return bodyLimitResponse

  const { pathname } = request.nextUrl
  if (!options.skipSecurityChecks) {
    const securityCheck = performSecurityChecks(request)
    if (!securityCheck.passed) {
      return NextResponse.json(
        {
          error: 'Security check failed',
          reason: securityCheck.reason,
          severity: securityCheck.severity
        },
        { status: 403 }
      )
    }
  }

  let user: User | null = null
  let userRole = 'default'
  if (options.requireAuth) {
    const authCheck = await checkApiSecurity(request, options.requiredRole)
    if (!authCheck.allowed) {
      return NextResponse.json(
        { error: 'Unauthorized', reason: authCheck.reason },
        { status: authCheck.deniedStatus ?? 401 }
      )
    }
    user = authCheck.user ?? null
    userRole = authCheck.role || 'member'
  }

  if (!options.skipRateLimit) {
    const clientId = getClientId(request, user?.id)
    const result = await checkRateLimit(clientId, pathname, userRole)
    request.rateLimitHeaders = result.headers
    if (!result.allowed) {
      const response = NextResponse.json(
        {
          error: 'Rate limit exceeded',
          reason: result.reason,
          resetTime: result.resetTime
        },
        { status: 429 }
      )
      Object.entries(result.headers).forEach(([key, value]) => {
        response.headers.set(key, value)
      })
      return response
    }
  }

  if (user) {
    request.user = user
    request.userRole = userRole
  }

  return null
}
