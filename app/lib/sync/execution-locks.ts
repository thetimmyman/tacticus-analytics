import { createComponentLogger } from '@/app/lib/logging'
import type { Database } from '@tacticus/app-core/types'
import type { ServiceSupabaseClient } from './worker-types'

const logger = createComponentLogger('lib.sync.execution-locks')

export const PIPELINE_A_EXECUTION_LOCKS_FLAG =
  'SYNC1_PIPELINE_A_EXECUTION_LOCKS_ENABLED'
const DEFAULT_EXECUTION_LOCK_TABLE = 'execution_locks'
const DEFAULT_EXECUTION_LOCK_TIMEOUT_MS = 5 * 60 * 1000

type ExecutionLockRow = Database['public']['Tables']['execution_locks']['Row']
type ExecutionLockInsert =
  Database['public']['Tables']['execution_locks']['Insert']

type LockDbError = { message?: string | null } | null

interface LockDeleteBuilder extends PromiseLike<{ error?: LockDbError }> {
  lt(column: string, value: string): Promise<{ error?: LockDbError }>
  eq(column: string, value: string): LockDeleteBuilder
}

interface LockInsertBuilder {
  select(): Promise<{ data: ExecutionLockRow[] | null; error: LockDbError }>
}

interface LockTableClient {
  delete(): LockDeleteBuilder
  insert(row: ExecutionLockInsert): LockInsertBuilder
}

interface DynamicSupabaseClient {
  from(table: string): LockTableClient
}

export interface PipelineAExecutionLockConfig {
  enabled: boolean
  table: string
  lockTimeoutMs: number
}

export interface PipelineAExecutionLock {
  lockKey: string
  lockId: string
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number
): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}

function executionLocksTable(
  supabase: ServiceSupabaseClient,
  table: string
): LockTableClient {
  return (supabase as unknown as DynamicSupabaseClient).from(table)
}

export function getPipelineAExecutionLockConfig(
  env: NodeJS.ProcessEnv = process.env
): PipelineAExecutionLockConfig {
  return {
    enabled: parseBoolean(env[PIPELINE_A_EXECUTION_LOCKS_FLAG]),
    table: env.SYNC_LOCK_TABLE?.trim() || DEFAULT_EXECUTION_LOCK_TABLE,
    lockTimeoutMs: parsePositiveInteger(
      env.SYNC_LOCK_TIMEOUT_MS,
      DEFAULT_EXECUTION_LOCK_TIMEOUT_MS
    )
  }
}

export function buildRaidExecutionLockKey(
  guildCode: string,
  clusterCode: string | null
): string {
  return `gr_sync_${clusterCode || 'none'}_${guildCode}`
}

export async function acquirePipelineAExecutionLock(
  supabase: ServiceSupabaseClient,
  config: PipelineAExecutionLockConfig,
  guildCode: string,
  clusterCode: string | null,
  workerId: string
): Promise<PipelineAExecutionLock | null> {
  const lockKey = buildRaidExecutionLockKey(guildCode, clusterCode)
  const lockId = crypto.randomUUID()
  const now = new Date()

  try {
    const cleanupResult = await executionLocksTable(supabase, config.table)
      .delete()
      .lt('expires_at', now.toISOString())

    if (cleanupResult.error) {
      logger.warn(
        { guildCode, err: cleanupResult.error },
        'Execution-lock stale cleanup failed'
      )
    }

    const { data, error } = await executionLocksTable(supabase, config.table)
      .insert({
        lock_key: lockKey,
        lock_id: lockId,
        guild_code: guildCode,
        worker_id: workerId,
        acquired_at: now.toISOString(),
        expires_at: new Date(
          now.getTime() + config.lockTimeoutMs
        ).toISOString(),
        heartbeat_at: now.toISOString()
      })
      .select()

    if (!error && data) {
      logger.info({ guildCode, lockKey }, 'Acquired sync lock')
      return { lockKey, lockId }
    }

    logger.info({ guildCode, lockKey, err: error }, 'Sync lock unavailable')
    return null
  } catch (error) {
    logger.warn(
      { guildCode, lockKey, err: error },
      'Sync lock acquisition failed'
    )
    return null
  }
}

export async function releasePipelineAExecutionLock(
  supabase: ServiceSupabaseClient,
  config: PipelineAExecutionLockConfig,
  lock: PipelineAExecutionLock
): Promise<void> {
  try {
    const { error } = await executionLocksTable(supabase, config.table)
      .delete()
      .eq('lock_key', lock.lockKey)
      .eq('lock_id', lock.lockId)

    if (error) {
      logger.warn(
        { lockKey: lock.lockKey, error: error.message },
        'Failed to release sync lock'
      )
    }
  } catch (error) {
    logger.warn(
      { lockKey: lock.lockKey, error },
      'Sync lock release threw unexpectedly'
    )
  }
}
