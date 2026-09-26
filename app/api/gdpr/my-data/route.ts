import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.gdpr.my-data')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { gdprManager } from '@/app/lib/compliance/gdpr-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Queues an Art. 15 export; poll GET /api/gdpr/my-data/[requestId] for the signed URL. */
export const POST = withErrorHandler(
  async (request: NextRequest): Promise<NextResponse> => {
    const securityResult = await apiSecurityMiddleware(request, {
      requireAuth: true,
      skipRateLimit: false
    })
    if (securityResult) return securityResult

    try {
      const supabase = await db()
      const user = await requireSessionUser(supabase, () =>
        Errors.unauthorized('Not authenticated')
      )

      const exportRequest = await gdprManager.handleDataAccessRequest(user.id)

      logger.info(
        {
          userId: user.id,
          requestId: exportRequest.request_id
        },
        'GDPR data export requested'
      )

      return NextResponse.json({
        success: true,
        requestId: exportRequest.request_id,
        status: exportRequest.status,
        requestedAt: exportRequest.requested_at
      })
    } catch (error) {
      rethrowIfAppError(error)
      logger.error({ err: error }, 'GDPR data export request failed:')
      throw Errors.internal('Failed to process data access request')
    }
  }
)
