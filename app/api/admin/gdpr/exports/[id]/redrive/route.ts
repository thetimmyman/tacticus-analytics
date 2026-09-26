/** Audited re-drive of a FAILED Article 15 export, the only recovery path (nothing polls failed rows). */
import { NextResponse, type NextRequest } from 'next/server'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { createComponentLogger } from '@/app/lib/logging'
import { gdprManager } from '@/app/lib/compliance/gdpr-manager'

const logger = createComponentLogger('api.admin.gdpr.export-redrive')

// The verdict must never be cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export const POST = withAdminGuards(
  { guard: 'app-admin-user-id' },
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
    { user_id: invokedByUserId }
  ): Promise<NextResponse> => {
    const { id } = await params
    if (!UUID_RE.test(id)) {
      throw Errors.validation('Invalid export request ID format')
    }

    try {
      const result = await gdprManager.redriveDataExport(id, invokedByUserId)

      if (result.outcome === 'not_found') {
        throw Errors.notFound('Export request')
      }

      if (result.outcome === 'not_redrivable') {
        // Pending/processing may have a live attempt; completed holds a signed URL the subject can still use.
        throw Errors.conflict('Only a failed export request can be re-driven', {
          status: result.status
        })
      }

      logger.info(
        {
          event: 'gdpr.export.redrive_finished',
          requestId: id,
          status: result.status,
          invokedByUserId
        },
        'gdpr.export.redrive_finished: operator re-drive completed'
      )

      return NextResponse.json({
        requestId: id,
        status: result.status,
        redrivenBy: invokedByUserId
      })
    } catch (error) {
      rethrowIfAppError(error)
      logger.error(
        { event: 'gdpr.export.redrive_error', requestId: id, err: error },
        'gdpr.export.redrive_error: operator re-drive failed'
      )
      throw Errors.internal('Failed to re-drive export request')
    }
  }
)
