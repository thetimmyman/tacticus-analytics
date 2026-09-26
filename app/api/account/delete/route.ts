import { NextRequest, NextResponse } from 'next/server'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { db } from '@/app/lib/db'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.account.delete')
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { sanitizeErrorForLog } from '@tacticus/app-core/logging-sanitizer'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { gdprManager } from '@/app/lib/compliance/gdpr-manager'
import {
  eraseAllUserData,
  ErasureStepError
} from '@/app/lib/compliance/erase-user-data'
import { describeWriteFailure } from '@/app/lib/compliance/write-failure'

export const dynamic = 'force-dynamic'

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

      const body = await request.json()
      const { userId, confirmationPhrase } = body as {
        userId?: string
        confirmationPhrase?: string
      }

      if (userId !== user.id) {
        throw Errors.forbidden('You can only delete your own account')
      }

      if (
        !confirmationPhrase ||
        confirmationPhrase.toUpperCase() !== 'DELETE'
      ) {
        throw Errors.validation(
          'Deletion confirmation phrase missing or incorrect'
        )
      }

      // Audit first so the event survives auth-user deletion; never blocks deletion.
      await gdprManager.recordDataProcessing({
        userId: user.id,
        dataType: 'account_deletion_immediate',
        processingPurpose: 'gdpr_data_erasure',
        legalBasis: 'legal_obligation'
      })

      let supabaseAdmin
      try {
        supabaseAdmin = serviceDb()
      } catch (serviceError) {
        logger.error(
          { err: sanitizeErrorForLog(serviceError) },
          'Failed to create service client:'
        )
        throw Errors.internal('Service configuration error')
      }

      // Filed first: on failure the row stays `scheduled` and the gdpr-cleanup cron re-runs the erasure.
      // No rollback: restoring LOKI credentials or ownership attestation would be a security regression.
      let deletionRequestId: string
      try {
        const deletionRequest = await gdprManager.handleDataDeletionRequest(
          user.id,
          'complete',
          [],
          { scheduledFor: new Date().toISOString() }
        )
        deletionRequestId = deletionRequest.request_id
      } catch (requestError) {
        logger.error(
          { err: sanitizeErrorForLog(requestError), userId: user.id },
          'Failed to file the GDPR erasure request; nothing was deleted'
        )
        throw Errors.internal('Failed to record the account deletion request')
      }

      // Same erasure the nightly executor runs.
      try {
        await eraseAllUserData(supabaseAdmin, user.id, 'account_delete', {
          recordProcessing: (record) => gdprManager.recordDataProcessing(record)
        })
      } catch (erasureError) {
        const step =
          erasureError instanceof ErasureStepError ? erasureError.step : null

        logger.error(
          {
            event: 'gdpr.account_delete.erasure_failed',
            requestId: deletionRequestId,
            userId: user.id,
            step: step ?? 'unknown',
            err: sanitizeErrorForLog(erasureError)
          },
          'gdpr.account_delete.erasure_failed: the Article 17 record stays scheduled and the gdpr-cleanup cron retries'
        )

        if (step === 'webhook_attribution') {
          throw Errors.internal(
            'Failed to clean up webhook references before deletion'
          )
        }
        if (step === 'player_authority') {
          throw Errors.internal('Failed to revoke player profile authority')
        }
        if (step === 'auth_user') {
          throw Errors.internal('Failed to delete user account')
        }
        throw Errors.internal('Failed to erase account data')
      }

      // Closed only after deleteUser: a `completed` row over a live auth user would be a false Article 17
      // claim. On failure the executor closes the row next run.
      try {
        await gdprManager.completeDeletionRequest(deletionRequestId)
        logger.info(
          {
            event: 'gdpr.account_delete.completed_inline',
            requestId: deletionRequestId
          },
          'gdpr.account_delete.completed_inline'
        )
      } catch (completionError) {
        logger.error(
          {
            event: 'gdpr.account_delete.completion_write_failed',
            requestId: deletionRequestId,
            // Field names and codes only, never values.
            failure: describeWriteFailure(completionError),
            err: sanitizeErrorForLog(completionError)
          },
          'gdpr.account_delete.completion_write_failed: subject erased but the Article 17 record is still open; the gdpr-cleanup executor closes it on the next run'
        )
      }

      return NextResponse.json({ success: true })
    } catch (error) {
      rethrowIfAppError(error)
      logger.error(
        { err: sanitizeErrorForLog(error) },
        'Account deletion error:'
      )
      throw Errors.internal('Internal server error')
    }
  }
)
