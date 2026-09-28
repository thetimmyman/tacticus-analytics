import { serviceDb } from '@/app/lib/db'

export const WEBHOOK_METADATA_COLUMNS =
  'id, webhook_type, description, enabled, created_at, updated_at, updated_by, cluster_id, last_tested, guild_code, thread_id'

// A user JWT cannot read webhook_url. Callers must first select ids through their
// RLS-scoped client and pass the officer or leader check before looking up URLs.
export async function loadWebhookUrlsByIds(
  ids: readonly string[]
): Promise<Map<string, string | null>> {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return new Map()

  const { data, error } = await serviceDb()
    .from('webhook_config')
    .select('id, webhook_url')
    .in('id', uniqueIds)

  if (error) throw error
  return new Map((data ?? []).map((row) => [row.id, row.webhook_url]))
}

export async function loadWebhookUrlById(id: string): Promise<string | null> {
  return (await loadWebhookUrlsByIds([id])).get(id) ?? null
}
