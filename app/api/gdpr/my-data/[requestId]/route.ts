import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.gdpr.my-data.requestId')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import type {
  GdprDataExportRow,
  GdprSupabaseClient
} from '@tacticus/app-core/database-extensions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// RLS restricts rows to the owner.
export const GET = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ requestId: string }> }
  ): Promise<NextResponse> => {
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

      const { requestId } = await params

      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          requestId
        )
      ) {
        throw Errors.validation('Invalid request ID format')
      }

      const { data, error } = await (supabase as unknown as GdprSupabaseClient)
        .from('gdpr_data_exports')
        .select('*')
        .eq('request_id', requestId)
        .eq('user_id', user.id)
        .single<GdprDataExportRow>()

      if (error || !data) {
        throw Errors.notFound('Export request not found')
      }

      return NextResponse.json({
        requestId: data.request_id,
        status: data.status,
        requestedAt: data.requested_at,
        completedAt: data.completed_at,
        downloadUrl: data.status === 'completed' ? data.download_url : null,
        expiresAt: data.expires_at
      })
    } catch (error) {
      rethrowIfAppError(error)
      logger.error({ err: error }, 'GDPR export status lookup failed:')
      throw Errors.internal('Failed to retrieve export status')
    }
  }
)
