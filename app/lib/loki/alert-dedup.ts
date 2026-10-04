import 'server-only'
import { createHash } from 'node:crypto'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { ConfigDiff } from './global-config-diff'

// Persisted dedup for the LOKI GlobalConfig drift-review Discord post
// (app/api/cron/refresh-global-config/route.ts). The daily refresh job and
// other automated callers re-check this every tick while a transition is
// unreviewed, which previously reposted the same diff to Discord each
// time. Fingerprint excludes any timestamp so re-checks of the same
// transition produce the same key and are skipped as a no-op.

const STATE_TABLE = 'loki_globalconfig_alert_state'

type AlertStateRow = {
  id: boolean
  old_version: string | null
  new_version: string | null
  content_fingerprint: string
  alerted_at: string
}

type AlertStateTableClient = {
  select: (columns: string) => {
    eq: (
      column: string,
      value: boolean
    ) => {
      maybeSingle: () => Promise<{
        data: AlertStateRow | null
        error: { message: string } | null
      }>
    }
  }
  upsert: (
    row: {
      id: boolean
      old_version: string
      new_version: string
      content_fingerprint: string
      alerted_at: string
    },
    options: { onConflict: string }
  ) => Promise<{ error: { message: string } | null }>
}

export function fingerprintDiff(
  diff: Pick<ConfigDiff, 'oldVersion' | 'newVersion' | 'lines'>
): string {
  return createHash('sha1')
    .update(`${diff.oldVersion}|${diff.newVersion}|${diff.lines.join('\n')}`)
    .digest('hex')
}

/**
 * Returns true when this EXACT transition (version pair + diff content) was
 * the last one posted to Discord — i.e. the caller should skip posting again.
 * Never throws: a read failure degrades to "not a duplicate" (alert, don't
 * silently drop a possibly-new drift because bookkeeping is unavailable).
 */
export async function isDuplicateGlobalConfigAlert(
  supabase: TypedSupabaseClient,
  diff: Pick<ConfigDiff, 'oldVersion' | 'newVersion' | 'lines'>
): Promise<{ duplicate: boolean; fingerprint: string }> {
  const fingerprint = fingerprintDiff(diff)
  const table = supabase.from(STATE_TABLE) as unknown as AlertStateTableClient
  const { data, error } = await table
    .select('id, old_version, new_version, content_fingerprint, alerted_at')
    .eq('id', true)
    .maybeSingle()

  if (error) {
    return { duplicate: false, fingerprint }
  }

  return { duplicate: data?.content_fingerprint === fingerprint, fingerprint }
}

/** Best-effort: a failed write means one extra repost later, never a lost alert. */
export async function recordGlobalConfigAlert(
  supabase: TypedSupabaseClient,
  diff: Pick<ConfigDiff, 'oldVersion' | 'newVersion'>,
  fingerprint: string
): Promise<void> {
  const table = supabase.from(STATE_TABLE) as unknown as AlertStateTableClient
  await table
    .upsert(
      {
        id: true,
        old_version: diff.oldVersion,
        new_version: diff.newVersion,
        content_fingerprint: fingerprint,
        alerted_at: new Date().toISOString()
      },
      { onConflict: 'id' }
    )
    .catch(() => undefined)
}
