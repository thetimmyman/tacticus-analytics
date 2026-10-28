/**
 * Narrow reconciliation for a `complete_job` call whose HTTP response was lost.
 * The database has already committed, so this only reads one row to prove the
 * original attempt; it never replays completion or provider work.
 */
import type { ServiceSupabaseClient, SyncJob } from './worker-types'

const RECONCILABLE_HTTP_STATUSES = new Set([502, 503, 504])

/** A proof read must fit inside the lane window and never outlive this cap. */
const RECONCILIATION_MAX_READ_MS = 1500

interface CompletionRow {
  id?: unknown
  worker_id?: unknown
  status?: unknown
  started_at?: unknown
  attempts?: unknown
  completed_at?: unknown
}

/** A captured claim timestamp is retained byte-for-byte after strict validation. */
export function isClaimTimestamp(value: unknown): value is string {
  return typeof value === 'string' && parseAwareIsoMicros(value) !== null
}

/**
 * The read is allowed only for a lost gateway response with a complete claim
 * generation and a lane deadline that has not already closed.
 */
function canReconcileCompletion(job: SyncJob, status: unknown): boolean {
  if (typeof status !== 'number' || !RECONCILABLE_HTTP_STATUSES.has(status)) {
    return false
  }
  if (!isClaimTimestamp(job.claimStartedAt)) {
    return false
  }
  if (
    !Number.isSafeInteger(job.claimAttempts) ||
    (job.claimAttempts ?? 0) < 1
  ) {
    return false
  }
  const deadline = job.reconciliationDeadlineMs
  if (typeof deadline !== 'number' || !Number.isFinite(deadline)) {
    return false
  }
  return deadline > Date.now()
}

/**
 * Reads the committed attempt once. Returns the exact `completed_at` literal for
 * freshness, or null when the proof is absent, unknown or later than the budget.
 */
export async function readCompletedAttempt(params: {
  job: SyncJob
  supabase: ServiceSupabaseClient
  workerId: string
  status: unknown
}): Promise<string | null> {
  const { job, supabase, workerId, status } = params
  // Admission belongs with the proof read, never an ordering obligation on callers.
  if (!canReconcileCompletion(job, status)) return null
  const deadline = job.reconciliationDeadlineMs
  if (typeof deadline !== 'number' || !Number.isFinite(deadline)) {
    return null
  }

  const readStarted = Date.now()
  const proofDeadline = Math.min(
    deadline,
    readStarted + RECONCILIATION_MAX_READ_MS
  )
  const remaining = proofDeadline - readStarted
  if (remaining < 1) {
    return null
  }

  const timeoutMs = Math.min(RECONCILIATION_MAX_READ_MS, Math.floor(remaining))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const { data, error } = await supabase
      .from('sync_queue')
      .select('id, worker_id, status, started_at, attempts, completed_at')
      .eq('id', job.id)
      .eq('worker_id', workerId)
      .abortSignal(controller.signal)
      .maybeSingle()

    if (error || controller.signal.aborted) {
      return null
    }
    if (Date.now() >= proofDeadline) {
      return null
    }

    const completedAt = committedCompletionTimestamp(data, job, workerId)
    return Date.now() < proofDeadline ? completedAt : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function committedCompletionTimestamp(
  value: unknown,
  job: SyncJob,
  workerId: string
): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const row = value as CompletionRow

  if (row.id !== job.id || row.worker_id !== workerId) {
    return null
  }
  if (row.status !== 'completed') {
    return null
  }
  // The generation is the raw claim string and integer, never a parsed date:
  // sub-millisecond started_at differences must not compare equal.
  if (row.started_at !== job.claimStartedAt) {
    return null
  }
  if (row.attempts !== job.claimAttempts) {
    return null
  }
  if (typeof row.completed_at !== 'string') {
    return null
  }

  const completedAtMicros = parseAwareIsoMicros(row.completed_at)
  const startedAtMicros = parseAwareIsoMicros(job.claimStartedAt ?? '')
  if (
    completedAtMicros === null ||
    startedAtMicros === null ||
    completedAtMicros < startedAtMicros
  ) {
    return null
  }
  const nowMicros = BigInt(Math.floor(Date.now())) * 1000n
  if (completedAtMicros > nowMicros) {
    return null
  }

  return row.completed_at
}

const AWARE_ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/

/**
 * Strict aware ISO-8601 to integer microseconds since the epoch. Sub-millisecond
 * fractions are preserved so a future timestamp inside the current millisecond
 * cannot look like "now".
 */
function parseAwareIsoMicros(value: string): bigint | null {
  const match = AWARE_ISO_RE.exec(value)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const fraction = match[7] ?? ''

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null
  }

  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, 0)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null
  }

  let offsetMinutes = 0
  if (match[8] !== 'Z') {
    const offsetHour = Number(match[10])
    const offsetMinute = Number(match[11])
    const offsetSign = match[9] === '-' ? -1 : 1
    // RFC 3339 numeric offsets use the same 00–23 hour / 00–59 minute grammar.
    if (offsetHour > 23 || offsetMinute > 59) {
      return null
    }
    offsetMinutes = offsetSign * (offsetHour * 60 + offsetMinute)
  }

  const micros = Number(fraction.padEnd(6, '0'))
  const epochMs = date.getTime() - offsetMinutes * 60_000
  return BigInt(epochMs) * 1000n + BigInt(micros)
}
