import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/app/lib/scheduler/require-cron-secret'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { createComponentLogger } from '@/app/lib/logging'
import { runWorkerTick } from '@/app/lib/jobs/worker-tick'
import { listRegisteredJobTypes } from '@/app/lib/jobs/dispatcher'
import { getVerifyWorkerSchedulerStatus } from '@/app/lib/jobs/verify-worker-scheduler'
import type { WorkQueueClass } from '@/app/lib/jobs/types'

import '@/app/lib/jobs/register-hooks-handlers'

const logger = createComponentLogger('api.worker.hooks')

const HOOK_CLASSES: WorkQueueClass[] = [
  'webhook',
  'alert',
  'notification',
  'hook'
]
const VERIFY_CLASSES: WorkQueueClass[] = ['verify']
const DEADLINE_MS = 50_000

function classesForRequest(request: NextRequest): WorkQueueClass[] {
  return request.nextUrl.searchParams.get('class') === 'verify'
    ? VERIFY_CLASSES
    : HOOK_CLASSES
}

/**
 * Per-minute CronJob tick; `?class=verify` is a manual diagnostic trigger.
 * Keep HOOK_CLASSES aligned with register-hooks-handlers.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  requireCronSecret(req)
  const classes = classesForRequest(req)

  const result = await runWorkerTick({
    classes,
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
    '[worker.hooks] tick complete'
  )

  // Monitors only see the HTTP status, so an all-failed tick must not return 200.
  const allFailed = result.jobsProcessed > 0 && result.jobsSucceeded === 0
  return NextResponse.json(result, { status: allFailed ? 500 : 200 })
})

export const GET = withErrorHandler(async (req: NextRequest) => {
  requireCronSecret(req)
  return NextResponse.json({
    classes: classesForRequest(req),
    registeredJobTypes: listRegisteredJobTypes(),
    verifyScheduler: getVerifyWorkerSchedulerStatus()
  })
})
