import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.gdpr.my-data')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import type {
  GdprDataExportRow,
  GdprSupabaseClient
} from '@tacticus/app-core/database-extensions'
import { gdprManager } from '@/app/lib/compliance/gdpr-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Recover the latest durable local request when the application is reopened.
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (getRuntimeProfile() !== 'desktop')
    throw Errors.notFound('Export not found')
  const blocked = await apiSecurityMiddleware(request, {
    requireAuth: true,
    skipRateLimit: false
  })
  if (blocked) return blocked
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.unauthorized('Not authenticated')
  )
  const { data, error } = await (supabase as unknown as GdprSupabaseClient)
    .from('gdpr_data_exports')
    .select('request_id,status,download_url,expires_at')
    .eq('user_id', user.id)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle<GdprDataExportRow>()
  if (error) throw Errors.internal('Failed to recover local export')
  return NextResponse.json(
    {
      requestId: data?.request_id ?? null,
      status: data?.status ?? 'idle',
      downloadUrl: data?.status === 'completed' ? data.download_url : null
    },
    { headers: { 'cache-control': 'private, no-store' } }
  )
})

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

      let exportRequest: GdprDataExportRow
      if (getRuntimeProfile() === 'desktop') {
        const { data, error } = await (
          supabase as unknown as GdprSupabaseClient
        )
          .from('gdpr_data_exports')
          .insert({ user_id: user.id })
          .select('request_id,status,requested_at')
          .single<GdprDataExportRow>()
        if (error || !data)
          throw Errors.internal('Failed to queue local data export')
        exportRequest = data
      } else {
        exportRequest = await gdprManager.handleDataAccessRequest(user.id)
      }

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
