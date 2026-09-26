import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.cron.gdpr-cleanup')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireCronSecret } from '@/app/lib/scheduler/require-cron-secret'
import { gdprManager } from '@/app/lib/compliance/gdpr-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    requireCronSecret(request)

    logger.info('Starting GDPR cleanup cron')

    const cleanup = await gdprManager.cleanupExpiredData()

    // Both counts, so an empty sweep is distinguishable from a healthy run.
    logger.info(
      {
        event: 'gdpr.cleanup.rows_deleted',
        processingLogRowsDeleted: cleanup.processingLogRowsDeleted,
        expiredExportRowsDeleted: cleanup.expiredExportRowsDeleted
      },
      'gdpr.cleanup.rows_deleted: GDPR retention sweep DELETE row counts'
    )

    await gdprManager.executeScheduledDeletions()

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      processingLogRowsDeleted: cleanup.processingLogRowsDeleted,
      expiredExportRowsDeleted: cleanup.expiredExportRowsDeleted
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'GDPR cleanup cron error:')
    throw Errors.fromResponse(500, {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})
