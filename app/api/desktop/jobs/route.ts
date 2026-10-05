import { NextRequest, NextResponse } from 'next/server'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { requireCronSecret } from '@/app/lib/scheduler/require-cron-secret'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { runWorkerTick } from '@/app/lib/jobs/worker-tick'
import { registerRefreshExploreSnapshotsHandler } from '@/app/lib/jobs/refresh-explore-snapshots'
import { getJobHandler } from '@/app/lib/jobs/dispatcher'
import { registerLocalAchievementsHandler } from '@/app/lib/jobs/refresh-local-achievements'

export const POST = withErrorHandler(async (request: NextRequest) => {
  requireCronSecret(request)
  if (getRuntimeProfile() !== 'desktop')
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!getJobHandler('refresh-explore-snapshots'))
    registerRefreshExploreSnapshotsHandler()
  if (!getJobHandler('refresh-local-achievements'))
    registerLocalAchievementsHandler()
  const result = await runWorkerTick({
    classes: ['hook'],
    deadlineMs: 15000,
    signal: request.signal,
    reapStuckJobs: true
  })
  return NextResponse.json(
    {
      status: result.error || result.jobsFailed ? 'failed' : 'completed',
      jobsProcessed: result.jobsProcessed,
      jobsSucceeded: result.jobsSucceeded,
      jobsFailed: result.jobsFailed
    },
    { status: result.error || result.jobsFailed ? 503 : 200 }
  )
})
