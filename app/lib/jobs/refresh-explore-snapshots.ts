import { createDirectClient } from '@/app/lib/network/direct-supabase'
import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import {
  hasTransientCause,
  isTransientUpstreamError
} from '@/app/lib/monitoring/transient-error'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'
import { coerceErrorMessage as getErrorMessage } from '@/app/lib/utils/error-message'

const logger = createComponentLogger('lib.jobs.refresh-explore-snapshots')

const TRANSIENT_ERROR_NAMES = new Set(['AbortError', 'TimeoutError'])
// 57014 = canceling statement due to statement timeout.
const TRANSIENT_DB_CODES = new Set(['57014'])

const TRANSIENT_MESSAGE_PATTERN =
  /\b(?:http\s+)?504\b|\bgateway time-?out\b|\bstatement time-?out\b/iu

const MAX_CAUSE_DEPTH = 8

/**
 * Transient failures are retried by the job queue, so they must not page as
 * Sentry errors. Covers upstream/transport classification plus the RPC shapes
 * Supabase returns for gateway and statement timeouts.
 */
function isTransientRefreshFailure(error: unknown): boolean {
  let current: unknown = error
  const seen = new Set<unknown>()
  let depth = 0

  while (current !== undefined && current !== null && depth < MAX_CAUSE_DEPTH) {
    if (hasTransientCause(current) || isTransientUpstreamError(current)) {
      return true
    }
    if (typeof current !== 'object') return false
    if (seen.has(current)) return false
    seen.add(current)
    depth += 1

    const record = current as Record<string, unknown>
    if (
      typeof record.name === 'string' &&
      TRANSIENT_ERROR_NAMES.has(record.name)
    ) {
      return true
    }
    if (
      typeof record.code === 'string' &&
      TRANSIENT_DB_CODES.has(record.code)
    ) {
      return true
    }
    const message = typeof record.message === 'string' ? record.message : ''
    if (TRANSIENT_MESSAGE_PATTERN.test(message)) return true

    current = record.cause
  }

  return false
}

const refreshExploreSnapshotsHandler: JobHandler = async (_payload, ctx) => {
  const startTime = Date.now()

  try {
    ctx.signal?.throwIfAborted()
    const db = createDirectClient()

    const { data, error } = await db.rpc(
      'manual_refresh_guild_snapshots',
      {},
      {
        signal: ctx.signal
      }
    )

    if (error) {
      // Serialize the RPC failure cleanly and keep the raw error as the cause.
      const message = `Failed to refresh explore snapshots: ${getErrorMessage(
        error
      )}`
      throw new Error(message, { cause: error })
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
    if (isTransientRefreshFailure(error)) {
      // The queue retries this, so a warn is enough; still rethrow.
      logger.warn(
        { jobId: ctx.jobId, err: message },
        '[ExploreSnapshotsRefresh] transient failure, awaiting retry'
      )
      throw error
    }
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
