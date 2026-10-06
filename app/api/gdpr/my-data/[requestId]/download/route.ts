import { NextRequest, NextResponse } from 'next/server'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import type {
  GdprDataExportRow,
  GdprSupabaseClient
} from '@tacticus/app-core/database-extensions'
import { db } from '@/app/lib/db'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ requestId: string }> }
  ) => {
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
    const { requestId } = await params
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        requestId
      )
    )
      throw Errors.validation('Invalid request ID format')
    const { data, error } = await (supabase as unknown as GdprSupabaseClient)
      .from('gdpr_data_exports')
      .select('status,expires_at,data_package')
      .eq('request_id', requestId)
      .eq('user_id', user.id)
      .single<GdprDataExportRow>()
    if (
      error ||
      !data ||
      data.status !== 'completed' ||
      !data.expires_at ||
      !Number.isFinite(Date.parse(data.expires_at)) ||
      Date.parse(data.expires_at) <= Date.now() ||
      !data.data_package ||
      typeof data.data_package !== 'object' ||
      Array.isArray(data.data_package)
    )
      throw Errors.notFound('Export not found or expired')
    const body = JSON.stringify(data.data_package, null, 2)
    if (Buffer.byteLength(body, 'utf8') > 32 * 1024 * 1024)
      throw Errors.internal('Export exceeds the supported download size')
    return new NextResponse(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="local-profile-data.json"',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff'
      }
    })
  }
)
