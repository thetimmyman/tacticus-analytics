import type { TypedSupabaseClient } from '@tacticus/app-core/types'

/** PERMANENT: no retry. TRANSIENT_NONCOUNTING: retried with backoff. Neither counts toward the
 * shared breaker, so one guild's key cannot block every guild. Mirrored in
 * supabase/functions/_shared/sync-modules/circuit-breaker.ts. */
export const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 404])
export const TRANSIENT_NONCOUNTING_HTTP_STATUSES = new Set([408, 425, 429])

/** Only for permanent statuses; transient 4xx stay plain Errors so they retry. */
export class TacticusApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly guildCode: string
  ) {
    super(`API request failed: ${statusCode}`)
    this.name = 'TacticusApiError'
  }

  get isPermanent(): boolean {
    return PERMANENT_HTTP_STATUSES.has(this.statusCode)
  }
}

// Invariants: workerTimeout < CronJob activeDeadlineSeconds, and
// workerTimeout > apiTimeout + retryDelay * 2^(maxRetries-1).
export const WORKER_CONFIG = {
  workerTimeout: 45000,
  batchSize: 500,
  apiTimeout: 30000, // shorter values abort under event-loop pressure
  retryDelay: 1000,
  maxRetries: 2,
  maxConcurrentWorkers: 5,

  // Claim lanes per drain; held at 1 because extra lanes contended downstream and lowered throughput.
  drainLanes: 1,

  laneTailReserveMs: 5000
}

export type ServiceSupabaseClient = TypedSupabaseClient

export interface WorkerResult {
  jobId: string
  success: boolean
  recordsProcessed: number
  playersUpdated: number
  errors: string[]
  upsertFailures: number
  /** Rows written or feed empty (false when sanitization dropped everything); gates last_successful_sync. */
  raidDataLanded?: boolean
  duration: number
}

export type SyncJobType =
  | 'full_sync'
  | 'incremental_sync'
  | 'realtime_sync'
  | 'player_sync'
  | 'validation_sync'

export interface SyncJob {
  id: string
  guild_code: string
  job_type: SyncJobType
  payload?: Record<string, unknown> | null
}

export interface GuildApiMember {
  userId: string
  displayName?: string
}

export interface SyncQueueClaimRow {
  id?: string | null
  guild_code?: string | null
  job_type?: string | null
  payload?: Record<string, unknown> | null
}

export interface RpcError {
  message?: string | null
}

export interface RpcResult<T> {
  data: T | null
  error: RpcError | null
}

export interface BattleValidationRow {
  id: number
  userId: string | null
  encounterId: number | string | null
  startedOn: string | null
}

export interface RaidSyncOptions {
  sinceTime: Date | null
  deleteBeforeUpsert: boolean
  /** Full sync only: add Guild/Season guards to the Name/displayName filter */
  strictEntryFilter: boolean
  batchedUpsert: boolean
  runCoverageCheck: boolean
}

export const UPSERT_CONFLICT_KEY =
  'Guild,Season,userId,encounterId,startedOn,completedOn,damageDealt,damageType'

export const MIN_REQUIRED_SEASONS = 5
export const HISTORY_LOOKBACK_SEASONS = 20
