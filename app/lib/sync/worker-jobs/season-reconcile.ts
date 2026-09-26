import type { ServiceSupabaseClient, WorkerResult } from '../worker-types'

/** Keeps each DELETE's `.in()` query string under the gateway's header buffer. */
const RECONCILE_DELETE_CHUNK_SIZE = 500

// Deletes (Guild, Season) rows not written this full_sync run. Errors bump
// upsertFailures so the job retries instead of reporting a half-reconciled season.
export async function reconcileSeasonDelete(
  supabase: ServiceSupabaseClient,
  guildCode: string,
  season: string,
  writtenIds: number[],
  result: WorkerResult
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: currentRows, error: selectError } = await (supabase as any)
    .from('EOT_GR_data')
    .select('id')
    .eq('Guild', guildCode)
    .eq('Season', season)

  if (selectError) {
    result.errors.push(
      `Season reconcile select failed: ${selectError.message ?? 'Unknown error'}`
    )
    result.upsertFailures++
    return
  }

  const writtenIdSet = new Set<number>(writtenIds)
  const staleIds: number[] = []
  if (Array.isArray(currentRows)) {
    for (const row of currentRows) {
      const id = (row as { id?: unknown } | null)?.id
      if (
        typeof id === 'number' &&
        Number.isInteger(id) &&
        !writtenIdSet.has(id)
      ) {
        staleIds.push(id)
      }
    }
  }

  if (staleIds.length === 0) {
    return
  }

  for (let i = 0; i < staleIds.length; i += RECONCILE_DELETE_CHUNK_SIZE) {
    const chunk = staleIds.slice(i, i + RECONCILE_DELETE_CHUNK_SIZE)
    const { error: deleteError } = await supabase
      .from('EOT_GR_data')
      .delete()
      .eq('Guild', guildCode)
      .eq('Season', season)
      .in('id', chunk)
    if (deleteError) {
      result.errors.push(
        `Season reconcile delete failed (chunk ${Math.floor(i / RECONCILE_DELETE_CHUNK_SIZE) + 1}): ${deleteError.message ?? 'Unknown error'}`
      )
      result.upsertFailures++
      return
    }
  }
}

export function collectWrittenIds(target: number[], data: unknown): void {
  if (!Array.isArray(data)) return
  for (const row of data) {
    const id = (row as { id?: unknown } | null)?.id
    if (typeof id === 'number' && Number.isInteger(id)) {
      target.push(id)
    }
  }
}
