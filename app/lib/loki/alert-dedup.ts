import 'server-only'
import { createHash } from 'node:crypto'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { ConfigDiff } from './global-config-diff'

// Persisted dedup for the LOKI GlobalConfig drift-review Discord post
// (app/api/cron/refresh-global-config/route.ts).
//
// The route never writes GlobalConfig — it alerts until a human reviews and
// applies the change — so `loki-globalconfig-refresh-cronjob.yaml` (daily)
// and the EOT self-heal's ALERT_FIRST path both call it again every tick
// while that review is pending, and prior to this each tick re-posted the
// full diff to Discord. Nothing recorded "we already told you about this
// exact transition". This table is that record: one singleton row holding
// the fingerprint of the last transition actually posted, so a repeat call
// for the SAME unreviewed drift is a no-op (logged, not posted) until the
// transition itself changes (a new LOKI version, or the content diff
// changes under an unchanged version pair).
//
// The fingerprint is derived from (oldVersion, newVersion, diff lines) only.
// It deliberately excludes any timestamp — `extractedAt` used to be one of
// the diff lines and, being `new Date().toISOString()` on every fetch, made
// every run's fingerprint unique and defeated any dedup keyed on it (see
// global-config-diff.ts). Do not fold a timestamp or other always-changing
// field back into this input.

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
