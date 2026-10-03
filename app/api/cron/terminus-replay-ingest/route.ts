import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { requireCronSecret } from '@/app/lib/scheduler/require-cron-secret'
import { serviceDb } from '@/app/lib/db'
import { cronGuard } from '@/app/lib/scheduler/cron-guard'
import {
  fetchTerminusCandidates,
  ingestExternalReplays
} from '@/app/lib/guild-ops/replay-external-ingest'

const logger = createComponentLogger('api.cron.terminus-replay-ingest')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A route, not a script, because the normalization vocabulary is not in the runner image. */
export const POST = withErrorHandler(async (request: NextRequest) => {
  requireCronSecret(request)

  const guard = await cronGuard()
  if (!guard.shouldExecute) {
    return NextResponse.json({ skipped: true, reason: guard.reason })
  }

  const candidates = await fetchTerminusCandidates()

  // An upstream markup change yields an empty library; fail so a dead scraper does not look healthy.
  if (candidates.length === 0) {
    logger.error({}, 'terminus_replay_ingest.empty_library')
    return NextResponse.json(
      {
        success: false,
        error:
          'Terminus library parsed to zero candidates — treat as a scrape regression'
      },
      { status: 502 }
    )
  }

  const summary = await ingestExternalReplays(serviceDb(), candidates, {
    apply: true,
    publishClean: true,
    // Terminus Maximus replays are community data and public by design; changing this would change the audience for community data.
    visibility: 'public'
  })

  logger.info({ ...summary }, 'terminus_replay_ingest.complete')
  return NextResponse.json({ success: true, ...summary })
})
