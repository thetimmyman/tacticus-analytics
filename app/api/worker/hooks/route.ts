import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/app/lib/scheduler/require-cron-secret'
import {
  sentryOperationTag,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { createComponentLogger } from '@/app/lib/logging'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import { runWorkerTick } from '@/app/lib/jobs/worker-tick'
import { listRegisteredJobTypes } from '@/app/lib/jobs/dispatcher'
import { getVerifyWorkerSchedulerStatus } from '@/app/lib/jobs/verify-worker-scheduler'
import type { WorkQueueClass, WorkerTickResult } from '@/app/lib/jobs/types'

import '@/app/lib/jobs/register-hooks-handlers'

const logger = createComponentLogger('api.worker.hooks')

const ALL_FAILED_CODE = 'WORKER_TICK_ALL_FAILED'

// A named type gives the all-failed tick its own Sentry issue, apart from unexpected 500s.
class WorkerTickAllFailedError extends Error {
  constructor() {
    super('Every job claimed by the worker tick failed')
    this.name = 'WorkerTickAllFailedError'
  }
}

function failedJobTypeTag(result: WorkerTickResult): string {
  const [first, ...others] = new Set(
    result.details.filter((d) => d.status === 'failed').map((d) => d.job_type)
  )
  return first !== undefined && others.length === 0 ? first : 'mixed'
}

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
  if (!allFailed) return NextResponse.json(result)

  const jobType = failedJobTypeTag(result)
  logger.error(
    { workerId: result.workerId, jobsFailed: result.jobsFailed, jobType },
    '[worker.hooks] every claimed job failed'
  )
  captureSentryException(new WorkerTickAllFailedError(), {
    tags: {
      operation: sentryOperationTag(req.method, req.nextUrl.pathname),
      status_code: '500',
      error_code: ALL_FAILED_CODE,
      job_type: jobType
    }
  })
  // A standard error envelope keeps withErrorHandler from capturing it again as a generic 500.
  return NextResponse.json(
    {
      ...result,
      error: {
        code: ALL_FAILED_CODE,
        message: 'Every job claimed by this tick failed',
        retryable: true,
        ...(result.error !== undefined && { claimError: result.error })
      }
    },
    { status: 500 }
  )
})

export const GET = withErrorHandler(async (req: NextRequest) => {
  requireCronSecret(req)
  return NextResponse.json({
    classes: classesForRequest(req),
    registeredJobTypes: listRegisteredJobTypes(),
    verifyScheduler: getVerifyWorkerSchedulerStatus()
  })
})
