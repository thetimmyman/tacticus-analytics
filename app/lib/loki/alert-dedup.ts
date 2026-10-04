import 'server-only'
import { createHash } from 'node:crypto'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { ConfigDiff } from './global-config-diff'

// Persisted dedup for the LOKI GlobalConfig drift-review Discord post. A
// check claims a transition before posting (overlapping callers post once),
// marks it delivered when Discord accepts it, releases it when the post
// fails (the next check retries), and clears it once the config is up to
// date (a recurrence alerts again). An undelivered claim goes stale after
// CLAIM_STALE_MS. Helpers never throw; unreadable state means "post".

const STATE_TABLE = 'loki_globalconfig_alert_state'

export const CLAIM_STALE_MS = 15 * 60 * 1000

/** Fingerprint value meaning "no transition on record". */
const NO_ALERT = ''

/** Excludes timestamps, so every re-check of one transition shares a key. */
export function fingerprintDiff(
  diff: Pick<ConfigDiff, 'oldVersion' | 'newVersion' | 'lines'>
): string {
  return createHash('sha1')
    .update(`${diff.oldVersion}|${diff.newVersion}|${diff.lines.join('\n')}`)
    .digest('hex')
}

/**
 * Atomically claims the right to post this EXACT transition (version pair +
 * diff content). `claimed: false` means another check already posted it, or
 * is posting it right now, so the caller should skip. A null client (state
 * unavailable) or any database error degrades to `claimed: true`.
 */
export async function claimGlobalConfigAlert(
  supabase: TypedSupabaseClient | null,
  diff: Pick<ConfigDiff, 'oldVersion' | 'newVersion' | 'lines'>,
  now: Date = new Date()
): Promise<{ claimed: boolean; fingerprint: string }> {
  const fingerprint = fingerprintDiff(diff)
  if (!supabase) return { claimed: true, fingerprint }

  const claim = {
    old_version: diff.oldVersion,
    new_version: diff.newVersion,
    content_fingerprint: fingerprint,
    alerted_at: now.toISOString(),
    delivered_at: null
  }

  try {
    // First alert ever: INSERT ... ON CONFLICT DO NOTHING RETURNING id.
    const inserted = await supabase
      .from(STATE_TABLE)
      .upsert(
        { id: true, ...claim },
        { onConflict: 'id', ignoreDuplicates: true }
      )
      .select('id')
    if (inserted.error) return { claimed: true, fingerprint }
    if ((inserted.data?.length ?? 0) > 0) return { claimed: true, fingerprint }

    // The row exists. Take it only when it holds a different transition, or
    // an undelivered claim gone stale. Postgres re-checks this WHERE against
    // the committed row when two updates race, so only one caller matches.
    const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS).toISOString()
    const updated = await supabase
      .from(STATE_TABLE)
      .update(claim)
      .eq('id', true)
      .or(
        `content_fingerprint.neq.${fingerprint},and(delivered_at.is.null,alerted_at.lt."${staleBefore}")`
      )
      .select('id')
    if (updated.error) return { claimed: true, fingerprint }
    return { claimed: (updated.data?.length ?? 0) > 0, fingerprint }
  } catch {
    return { claimed: true, fingerprint }
  }
}

/** Discord accepted the post: later checks of this transition skip it. */
export async function markGlobalConfigAlertDelivered(
  supabase: TypedSupabaseClient | null,
  fingerprint: string,
  now: Date = new Date()
): Promise<void> {
  if (!supabase) return
  try {
    await supabase
      .from(STATE_TABLE)
      .update({ delivered_at: now.toISOString() })
      .eq('id', true)
      .eq('content_fingerprint', fingerprint)
  } catch {
    // Undelivered claims go stale, so a lost write costs one repost later.
  }
}

/** The post failed or had nowhere to go: give the claim back so the next check retries. */
export async function releaseGlobalConfigAlert(
  supabase: TypedSupabaseClient | null,
  fingerprint: string
): Promise<void> {
  if (!supabase) return
  try {
    await supabase
      .from(STATE_TABLE)
      .update({ content_fingerprint: NO_ALERT, delivered_at: null })
      .eq('id', true)
      .eq('content_fingerprint', fingerprint)
      .is('delivered_at', null)
  } catch {
    // The claim goes stale after CLAIM_STALE_MS and is retried then.
  }
}

/** The config is up to date: forget the last transition so a recurrence alerts again. */
export async function clearGlobalConfigAlertState(
  supabase: TypedSupabaseClient | null
): Promise<void> {
  if (!supabase) return
  try {
    await supabase
      .from(STATE_TABLE)
      .update({
        content_fingerprint: NO_ALERT,
        old_version: null,
        new_version: null,
        delivered_at: null
      })
      .eq('id', true)
      .neq('content_fingerprint', NO_ALERT)
  } catch {
    // Best-effort: a stale fingerprint only matters if the same drift recurs.
  }
}
