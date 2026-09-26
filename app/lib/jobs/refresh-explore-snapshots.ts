import { createDirectClient } from '@/app/lib/network/direct-supabase'
import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'
import { coerceErrorMessage as getErrorMessage } from '@/app/lib/utils/error-message'

const logger = createComponentLogger('lib.jobs.refresh-explore-snapshots')

const refreshExploreSnapshotsHandler: JobHandler = async (_payload, ctx) => {
  const startTime = Date.now()

  try {
    const db = createDirectClient()

    const { data, error } = await db.rpc('manual_refresh_guild_snapshots')

    if (error) {
      throw new Error(`Failed to refresh explore snapshots: ${error}`)
    }

    const durationMs = Date.now() - startTime

    logger.info(
      { jobId: ctx.jobId, durationMs, result: data },
      '[ExploreSnapshotsRefresh] complete'
    )

    return {
      status: 'ok',
      durationMs,
      result: data
    }
  } catch (error) {
    rethrowIfAppError(error)
    const message = getErrorMessage(error)
    captureSentryException(error, {
      tags: { handler: 'refresh-explore-snapshots', jobId: String(ctx.jobId) }
    })
    logger.error(
      { jobId: ctx.jobId, err: message },
      '[ExploreSnapshotsRefresh] handler failed'
    )
    throw error
  }
}

export function registerRefreshExploreSnapshotsHandler(): void {
  registerJobHandler(
    'refresh-explore-snapshots',
    refreshExploreSnapshotsHandler
  )
}
