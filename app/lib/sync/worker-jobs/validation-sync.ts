import type { GuildConfig } from '@tacticus/app-core/types'
import { callRpc, toIntegerOrNull } from '../worker-utils'
import type {
  BattleValidationRow,
  ServiceSupabaseClient,
  SyncJob,
  WorkerResult
} from '../worker-types'

export async function processValidationSync(
  job: SyncJob,
  _config: GuildConfig,
  supabase: ServiceSupabaseClient,
  result: WorkerResult
) {
  const { data: battleData } = await supabase
    .from('EOT_GR_data')
    .select('id, userId, encounterId, startedOn')
    .eq('Guild', job.guild_code)
    .order('id')

  const seen = new Set<string>()
  const duplicateIds: number[] = []
  const validationRows = (battleData as BattleValidationRow[] | null) ?? []

  for (const row of validationRows) {
    const encounterId = toIntegerOrNull(row?.encounterId)
    if (!row?.userId || encounterId === null) continue
    const compositeKey = `${row.userId}-${encounterId}-${row.startedOn || ''}`
    if (seen.has(compositeKey)) {
      duplicateIds.push(row.id)
    }
    seen.add(compositeKey)
  }

  if (duplicateIds.length > 0) {
    result.errors.push(`Found ${duplicateIds.length} duplicate battles`)

    await supabase.from('EOT_GR_data').delete().in('id', duplicateIds)
  }

  const { data: unmappedPlayersData } = await callRpc<unknown[]>(
    supabase,
    'get_unmapped_players',
    {
      p_guild_code: job.guild_code
    }
  )
  const unmappedPlayers = unmappedPlayersData ?? []

  if (unmappedPlayers.length > 0) {
    result.errors.push(`Found ${unmappedPlayers.length} unmapped players`)
  }

  const dataQuality =
    100 - (duplicateIds.length / (battleData?.length || 1)) * 100

  await supabase.from('sync_health').upsert(
    {
      guild_code: job.guild_code,
      data_completeness: dataQuality,
      duplicate_battles: duplicateIds.length,
      missing_players: unmappedPlayers.length,
      updated_at: new Date().toISOString()
    },
    {
      onConflict: 'guild_code'
    }
  )

  result.recordsProcessed = battleData?.length || 0
}
