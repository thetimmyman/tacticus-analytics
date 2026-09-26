export type WorkQueueStatus =
  'pending' | 'processing' | 'completed' | 'failed' | 'dead'

export type WorkQueueClass =
  | 'batch'
  | 'sync'
  | 'webhook'
  | 'alert'
  | 'notification'
  | 'hook'
  | 'heavy'
  | 'verify'

/** A `public.work_queue` row as returned by `claim_next_work_job`; keep in sync. */
export interface WorkQueueJob {
  id: number
  job_type: string
  job_class: WorkQueueClass
  payload: Record<string, unknown>
  dedupe_key: string
  status: WorkQueueStatus
  priority: number
  attempts: number
  max_attempts: number
  claimed_by: string | null
  claimed_at: string | null
  scheduled_for: string
  started_at: string | null
  completed_at: string | null
  error: string | null
  created_at: string
  updated_at: string
}

/** Return value is stored in payload.result; throwing fails the job with backoff. */
export type JobHandler = (
  payload: Record<string, unknown>,
  context: JobHandlerContext
) => Promise<Record<string, unknown> | void>

export interface JobHandlerContext {
  jobId: number
  workerId: string
  attempts: number
  signal?: AbortSignal
  /** Tick deadline (epoch ms); combine with own budgets via `softDeadlineFor()`. */
  softDeadlineAt?: number
}

export interface WorkerTickResult {
  workerId: string
  classes: WorkQueueClass[]
  jobsProcessed: number
  jobsSucceeded: number
  jobsFailed: number
  durationMs: number
  error?: string
  details: Array<{
    id: number
    job_type: string
    status: 'completed' | 'failed'
    error?: string
  }>
}
