import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/app/lib/scheduler/require-cron-secret'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { createComponentLogger } from '@/app/lib/logging'
import { runWorkerTick } from '@/app/lib/jobs/worker-tick'
import { listRegisteredJobTypes } from '@/app/lib/jobs/dispatcher'
import type { WorkQueueClass } from '@/app/lib/jobs/types'

import '@/app/lib/jobs/register-batch-handlers'

const logger = createComponentLogger('api.worker.batch')

const CLASSES: WorkQueueClass[] = ['batch', 'heavy']

/**
 * Soft budget well below the CronJob activeDeadlineSeconds (425s); handlers stop
 * starting chunks after ctx.softDeadlineAt.
 */
const DEADLINE_MS = 240_000

export const POST = withErrorHandler(async (req: NextRequest) => {
  requireCronSecret(req)

  const result = await runWorkerTick({
    classes: CLASSES,
    deadlineMs: DEADLINE_MS
  })

  logger.info(
    {
      workerId: result.workerId,
      jobsProcessed: result.jobsProcessed,
      jobsSucceeded: result.jobsSucceeded,
      jobsFailed: result.jobsFailed,
      durationMs: result.durationMs
    },
    '[worker.batch] tick complete'
  )

  // All-claimed-jobs-failed is a failed run; the CronJob only sees HTTP status.
  const allFailed = result.jobsProcessed > 0 && result.jobsSucceeded === 0
  return NextResponse.json(result, { status: allFailed ? 500 : 200 })
})

export const GET = withErrorHandler(async (req: NextRequest) => {
  requireCronSecret(req)
  return NextResponse.json({
    classes: CLASSES,
    registeredJobTypes: listRegisteredJobTypes()
  })
})
