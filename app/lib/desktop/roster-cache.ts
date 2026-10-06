import type { SupabaseClient } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { parseRosterSnapshot } from '@/apps/desktop/launcher/roster-validation.mjs'

type LocalCacheDatabase = {
  public: {
    Tables: {
      desktop_roster_snapshots: {
        Row: {
          subject_user_id: string
          guild_code: string
          payload: unknown
          source: string
          cached_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}

export async function readOwnRosterCache(
  client: TypedSupabaseClient,
  subject: string
) {
  const local = client as unknown as SupabaseClient<LocalCacheDatabase>
  const { data, error } = await local
    .from('desktop_roster_snapshots')
    .select('guild_code,payload,source,cached_at')
    .eq('subject_user_id', subject)
    .maybeSingle()
  if (error) throw new Error('Local roster cache is unavailable')
  if (!data) return null
  const snapshot = parseRosterSnapshot(JSON.stringify(data.payload))
  if (
    data.source !== 'official-own-key-local-claim' ||
    snapshot.guildCode !== data.guild_code ||
    !Number.isFinite(Date.parse(data.cached_at))
  )
    throw new Error('Local roster cache is invalid')
  return {
    ...snapshot,
    cachedAt: new Date(data.cached_at).toISOString(),
    source: 'official-own-key-local-claim' as const
  }
}
