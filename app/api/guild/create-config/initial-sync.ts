import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@tacticus/app-core/types'
import { TACTICUS_API } from '@tacticus/app-core/app-config'
import { normalizeTacticusGuildRole } from '@tacticus/app-core/role-utils'

import { createComponentLogger } from '@/app/lib/logging'
import { fetchWithAbortTimeout } from '@/app/lib/sync/api-client'
import { SERVICE_TIMEOUTS, withTimeout } from '@/app/lib/utils/async-timeout'

const logger = createComponentLogger('api.guild.create-config.initial-sync')
type Supabase = SupabaseClient<Database>

interface SyncResult {
  stats?: { upsertedEntries?: number; lokiMappings?: number }
  season?: string
}

interface Options {
  supabase: Supabase
  guildCode: string
  apiKey: string
  reconcileRoles: boolean
}

export function splitElevatedRoleIds(
  members: Array<{ userId?: string; role?: string }>
) {
  const leaderIds: string[] = []
  const officerIds: string[] = []
  members.forEach((member) => {
    if (!member.userId) return
    const role = normalizeTacticusGuildRole(member.role)
    if (role === 'leader') leaderIds.push(member.userId)
    if (role === 'officer') officerIds.push(member.userId)
  })
  return { leaderIds, officerIds }
}

/** Role-only: never display_name (LOKI owns it) or guild_code (attested-membership guard). */
async function reconcileElevatedRoles({
  supabase,
  guildCode,
  members,
  timestamp
}: {
  supabase: Options['supabase']
  guildCode: string
  members: Array<{ userId?: string; role?: string }>
  timestamp: string
}): Promise<boolean> {
  const { leaderIds, officerIds } = splitElevatedRoleIds(members)
  let wrote = false
  for (const group of [
    { role: 'leader' as const, ids: leaderIds },
    { role: 'officer' as const, ids: officerIds }
  ]) {
    if (group.ids.length === 0) continue
    const { error } = await supabase
      .from('player_mapping')
      .update({ role: group.role, updated_at: timestamp })
      .eq('guild_code', guildCode)
      .in('player_id', group.ids)
    if (error) {
      logger.warn(
        { guildCode, role: group.role, err: error },
        'Failed to reconcile elevated roles'
      )
      continue
    }
    wrote = true
  }
  return wrote
}

// LOKI members often lack rank (or LOKI is down), which would lock out new leaders/officers.
async function reconcileGuildRoles({
  supabase,
  guildCode,
  apiKey,
  lokiMappings
}: Omit<Options, 'reconcileRoles'> & { lokiMappings: number }) {
  const response = await fetchWithAbortTimeout(
    `${TACTICUS_API.BASE_URL}/guild`,
    { headers: { 'X-API-KEY': apiKey, Accept: 'application/json' } },
    SERVICE_TIMEOUTS.EXTERNAL_API,
    'create-config external response'
  )
  if (!response.ok) {
    logger.warn(
      { guildCode, statusCode: response.status },
      'Guild fetch failed during role reconcile'
    )
    return false
  }

  const data = await response.json()
  const members: Array<{ userId?: string; role?: string }> =
    data?.guild?.members || []
  if (members.length === 0) return false
  const timestamp = new Date().toISOString()

  if (lokiMappings === 0) {
    // Insert only missing rows: an upsert could move an attested account from another guild.
    const playerIds = members
      .map((member) => member.userId)
      .filter((id): id is string => Boolean(id))
    const { data: existingRows, error: existingError } = await supabase
      .from('player_mapping')
      .select('player_id, guild_code, protected, is_app_admin, is_current')
      .in('player_id', playerIds)
    if (existingError) {
      logger.warn(
        { err: existingError },
        'Failed to inspect existing fallback player mappings'
      )
      return false
    }
    // Same-guild rows still need their role or mint_bootstrap_seat_invite locks out the first leader.
    type ExistingRow = {
      player_id: string
      guild_code: string
      protected: boolean | null
      is_app_admin: boolean | null
      is_current: boolean | null
    }
    const existingById = new Map(
      ((existingRows ?? []) as ExistingRow[]).map((row) => [row.player_id, row])
    )
    const records = members
      .filter((member) => member.userId && !existingById.has(member.userId))
      .map((member) => ({
        player_id: member.userId as string,
        display_name: `Player-${(member.userId as string).substring(0, 8)}`,
        guild_code: guildCode,
        role: normalizeTacticusGuildRole(member.role),
        auto_generated: true,
        is_current: true,
        is_active: true,
        updated_at: timestamp
      }))
    let wrote = false
    if (records.length > 0) {
      const { error } = await supabase
        .from('player_mapping')
        .upsert(records, { onConflict: 'player_id', ignoreDuplicates: true })
      if (error) {
        logger.warn({ err: error }, 'Failed to create fallback player mappings')
        return false
      }
      wrote = true
    }

    // `protected` and `is_app_admin` rows are hand-curated and excluded.
    const sameGuildRows = members
      .map((member) => ({ member, row: existingById.get(member.userId ?? '') }))
      .filter(
        ({ member, row }) =>
          member.userId &&
          row?.guild_code === guildCode &&
          row.protected !== true &&
          row.is_app_admin !== true
      )

    if (sameGuildRows.length > 0) {
      wrote =
        (await reconcileElevatedRoles({
          supabase,
          guildCode,
          members: sameGuildRows.map(({ member }) => member),
          timestamp
        })) || wrote

      // The bootstrap mint requires is_current; the live /guild roster is authority on presence.
      const absentIds = sameGuildRows
        .filter(({ row }) => row?.is_current !== true)
        .map(({ member }) => member.userId as string)
      if (absentIds.length > 0) {
        const { error } = await supabase
          .from('player_mapping')
          .update({ is_current: true, is_active: true, updated_at: timestamp })
          .eq('guild_code', guildCode)
          .in('player_id', absentIds)
        if (error) {
          logger.warn(
            { guildCode, err: error },
            'Failed to reactivate witnessed same-guild mappings'
          )
        } else {
          wrote = true
        }
      }
    }
    return wrote
  }

  await reconcileElevatedRoles({ supabase, guildCode, members, timestamp })
  return true
}

export async function runInitialGuildSync({
  supabase,
  guildCode,
  apiKey,
  reconcileRoles
}: Options) {
  let initialSyncTriggered = false
  let playerMappingsCreated = false

  try {
    const { error: statusError } = await supabase
      .from('guild_sync_status')
      .upsert(
        {
          guild_code: guildCode,
          status: 'pending',
          last_sync: new Date().toISOString(),
          records_synced: 0
        },
        { onConflict: 'guild_code' }
      )
    if (statusError) {
      logger.warn({ err: statusError }, 'Failed to create sync status')
    }

    const { data, error } = await withTimeout(
      supabase.functions.invoke('sync-modular-workflow', {
        body: { guild_code: guildCode }
      }),
      SERVICE_TIMEOUTS.EXTERNAL_API,
      'create-config initial sync'
    )
    const syncResult = data as SyncResult | null
    if (error) {
      logger.warn({ guildCode, err: error }, 'Initial sync failed')
    } else {
      initialSyncTriggered = true
      logger.info(
        {
          guildCode,
          battles_synced: syncResult?.stats?.upsertedEntries || 0,
          lokiMappings: syncResult?.stats?.lokiMappings || 0,
          season: syncResult?.season
        },
        'Initial sync completed'
      )
    }

    if (reconcileRoles) {
      try {
        playerMappingsCreated = await reconcileGuildRoles({
          supabase,
          guildCode,
          apiKey,
          lokiMappings: syncResult?.stats?.lokiMappings || 0
        })
      } catch (error) {
        logger.warn({ err: error, guildCode }, 'Role reconcile failed')
      }
    }
  } catch (error) {
    logger.warn({ err: error, guildCode }, 'Exception during initial sync')
  }

  return { initialSyncTriggered, playerMappingsCreated }
}
