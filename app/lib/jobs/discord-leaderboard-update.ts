// One edge call per cluster or independent guild; pg_cron fans out at enqueue so each job retries alone.

import { createDirectClient } from '@/app/lib/network/direct-supabase'
import { createComponentLogger } from '@/app/lib/logging'
import { withRetry } from '@/app/lib/resilience/with-retry'
import { RetryConditions } from '@/app/lib/resilience/retry-policy'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'

const logger = createComponentLogger('lib.jobs.discord-leaderboard-update')

interface LeaderboardEdgeResponse {
  status?: string
  execution?: {
    early_termination?: boolean
  }
}

function isPartial(payload: LeaderboardEdgeResponse | null): boolean {
  return (
    payload?.status === 'partial' ||
    payload?.execution?.early_termination === true
  )
}

interface ClusterPayload {
  cluster_code: string
}

interface GuildPayload {
  guild_code: string
}

function coerceClusterPayload(
  payload: Record<string, unknown>
): ClusterPayload {
  const cc = payload.cluster_code
  if (typeof cc !== 'string' || cc.length === 0) {
    throw new Error(
      'discord-leaderboard-update-cluster: payload.cluster_code is required (string)'
    )
  }
  return { cluster_code: cc }
}

function coerceGuildPayload(payload: Record<string, unknown>): GuildPayload {
  const gc = payload.guild_code
  if (typeof gc !== 'string' || gc.length === 0) {
    throw new Error(
      'discord-leaderboard-update-guild: payload.guild_code is required (string)'
    )
  }
  return { guild_code: gc }
}

const clusterHandler: JobHandler = async (rawPayload, ctx) => {
  const { cluster_code } = coerceClusterPayload(rawPayload)
  const db = createDirectClient()

  const result = await withRetry(
    async () => {
      const invokeResult = await db.invoke<LeaderboardEdgeResponse>(
        'update-discord-leaderboards',
        { cluster_code }
      )
      if (invokeResult.error) {
        throw new Error(invokeResult.error)
      }
      return invokeResult
    },
    {
      maxAttempts: 2,
      strategy: 'exponential',
      baseDelayMs: 2000,
      maxDelayMs: 5000,
      retryOn: RetryConditions.any(
        RetryConditions.networkErrors,
        RetryConditions.serverErrors,
        RetryConditions.timeoutErrors
      ),
      context: { operationName: `leaderboard:${cluster_code}` }
    }
  )

  if (isPartial(result.data ?? null)) {
    logger.warn(
      { cluster_code, jobId: ctx.jobId },
      'Partial completion — edge function terminated early'
    )
    return { status: 'partial', cluster_code }
  }

  return { status: 'success', cluster_code }
}

const guildHandler: JobHandler = async (rawPayload, ctx) => {
  const { guild_code } = coerceGuildPayload(rawPayload)
  const db = createDirectClient()

  const functionName = `update-discord-leaderboards?guild=${encodeURIComponent(guild_code)}`

  const result = await withRetry(
    async () => {
      const invokeResult = await db.invoke<LeaderboardEdgeResponse>(
        functionName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { cluster_code: null } as any
      )
      if (invokeResult.error) {
        throw new Error(invokeResult.error)
      }
      return invokeResult
    },
    {
      maxAttempts: 2,
      strategy: 'exponential',
      baseDelayMs: 2000,
      maxDelayMs: 5000,
      retryOn: RetryConditions.any(
        RetryConditions.networkErrors,
        RetryConditions.serverErrors,
        RetryConditions.timeoutErrors
      ),
      context: { operationName: `leaderboard:INDEPENDENT:${guild_code}` }
    }
  )

  if (isPartial(result.data ?? null)) {
    logger.warn(
      { guild_code, jobId: ctx.jobId },
      'Partial completion — edge function terminated early'
    )
    return { status: 'partial', guild_code }
  }

  return { status: 'success', guild_code }
}

export function registerDiscordLeaderboardHandlers(): void {
  registerJobHandler('discord-leaderboard-update-cluster', clusterHandler)
  registerJobHandler('discord-leaderboard-update-guild', guildHandler)
}

export const __internal = {
  clusterHandler,
  guildHandler,
  coerceClusterPayload,
  coerceGuildPayload
}
