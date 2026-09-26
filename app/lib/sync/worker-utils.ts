import type {
  ServiceSupabaseClient,
  SyncJob,
  SyncJobType,
  SyncQueueClaimRow,
  RpcError,
  RpcResult
} from './worker-types'
import type { RawRaidEntry, GuildRaidApiResponse } from './transformers'

/** @deprecated Use requireCronSecret from '@/app/lib/scheduler/require-cron-secret' */
export { requireCronSecret as requireCronAuthorization } from '@/app/lib/scheduler/require-cron-secret'

export function parseSyncJob(
  claimedJob: SyncQueueClaimRow | null
): SyncJob | null {
  if (!claimedJob) {
    return null
  }

  const { id, guild_code, job_type, payload } = claimedJob
  if (!id || !guild_code || !job_type) {
    return null
  }

  const validJobType = isSyncJobType(job_type)
  if (!validJobType) {
    return null
  }

  return {
    id,
    guild_code,
    job_type,
    payload: payload ?? null
  }
}

export function isSyncJobType(jobType: string): jobType is SyncJobType {
  return (
    jobType === 'full_sync' ||
    jobType === 'incremental_sync' ||
    jobType === 'realtime_sync' ||
    jobType === 'player_sync' ||
    jobType === 'validation_sync'
  )
}

export function toIntegerOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return null
    }
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed)
    }
  }

  return null
}

export function cleanNullString(
  value: string | null | undefined
): string | null {
  if (!value || value === 'null' || value === 'undefined') return null
  return value
}

export function resolveEntryTimestampOrNull(
  entry: RawRaidEntry
): string | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const toIso = (v: unknown): string | null => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      const ms = v > 1_000_000_000_000 ? v : v * 1000
      const d = new Date(ms)
      return Number.isNaN(d.getTime()) ? null : d.toISOString()
    }
    if (typeof v === 'string') {
      const t = v.trim()
      if (!t) return null
      if (/^\d+$/.test(t)) {
        const n = Number(t)
        if (Number.isFinite(n)) {
          const ms = n > 1_000_000_000_000 ? n : n * 1000
          const d = new Date(ms)
          if (!Number.isNaN(d.getTime())) return d.toISOString()
        }
      }
      const d = new Date(t)
      return Number.isNaN(d.getTime()) ? null : d.toISOString()
    }
    return null
  }
  return (
    toIso(entry.timestamp) ?? toIso(entry.completedOn) ?? toIso(entry.startedOn)
  )
}

export function resolveSeasonNumber(data: GuildRaidApiResponse): number {
  const season =
    toIntegerOrNull(data.season) ??
    toIntegerOrNull(data.currentSeason) ??
    toIntegerOrNull(data.body?.season)
  if (!season || season <= 0) {
    throw new Error('API response missing season number')
  }
  return season
}

export async function callRpc<T>(
  supabase: ServiceSupabaseClient,
  fn: string,
  args?: Record<string, unknown>
): Promise<RpcResult<T>> {
  // Preserve supabase client context; detached rpc calls can lose internal rest state.
  const rpc = (supabase.rpc as unknown as (...args: unknown[]) => unknown).bind(
    supabase
  ) as unknown as (
    functionName: string,
    params?: Record<string, unknown>
  ) => Promise<RpcResult<T>>

  const result = args === undefined ? await rpc(fn) : await rpc(fn, args)

  if (!result || typeof result !== 'object') {
    return { data: null, error: null }
  }

  return {
    data: ('data' in result ? result.data : null) as T | null,
    error: ('error' in result ? result.error : null) as RpcError | null
  }
}
