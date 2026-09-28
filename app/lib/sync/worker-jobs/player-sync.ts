import { createComponentLogger } from '@/app/lib/logging'
import type { GuildConfig } from '@tacticus/app-core/types'
import { fetchTacticusApi } from '../tacticus-api-client'
import { callRpc } from '../worker-utils'
import type {
  GuildApiMember,
  ServiceSupabaseClient,
  SyncJob,
  WorkerResult
} from '../worker-types'

const logger = createComponentLogger('lib.sync.worker-jobs.player-sync')

// Records the roster write outcome; the monitor reads sync_health.roster_write_failures,
// so a failure here must never throw or change the job result.
async function recordRosterWriteOutcome(
  supabase: ServiceSupabaseClient,
  guildCode: string,
  ok: boolean,
  rowsWritten: number,
  reason: string | null
): Promise<void> {
  try {
    const { error } = await callRpc<unknown>(
      supabase,
      'record_roster_write_outcome',
      {
        p_guild_code: guildCode,
        p_ok: ok,
        p_rows_written: rowsWritten,
        p_reason: reason
      }
    )
    if (error) {
      logger.error(
        { guildCode, err: error },
        'Failed to record roster write outcome'
      )
    }
  } catch (error) {
    logger.error(
      { guildCode, err: error },
      'Failed to record roster write outcome'
    )
  }
}

export async function processPlayerSync(
  job: SyncJob,
  config: GuildConfig,
  apiKey: string,
  supabase: ServiceSupabaseClient,
  result: WorkerResult
) {
  const response = await fetchTacticusApi('/guild', apiKey, job.guild_code)

  const data = (await response.json()) as {
    members?: GuildApiMember[]
    guild?: { name?: string | null }
  }
  const members = Array.isArray(data.members) ? data.members : []

  // Best-effort rename: a failure must not break the player_mapping upsert below.
  const apiName =
    typeof data.guild?.name === 'string' ? data.guild.name.trim() : ''
  if (apiName && apiName !== config.display_name) {
    const { error: renameError } = await supabase
      .from('guild_config')
      .update({
        display_name: apiName,
        updated_at: new Date().toISOString()
      })
      .eq('guild_code', job.guild_code)

    if (renameError) {
      logger.warn(
        {
          guildCode: job.guild_code,
          previousGuildName: config.display_name,
          currentGuildName: apiName,
          err: renameError.message
        },
        'Failed to update guild display name'
      )
    } else {
      logger.info(
        {
          guildCode: job.guild_code,
          previousGuildName: config.display_name,
          currentGuildName: apiName
        },
        'Guild display name updated'
      )
    }
  }

  let attempted = 0
  let succeeded = 0
  let firstFailure: string | null = null

  for (const member of members) {
    if (!member.userId) {
      continue
    }
    attempted++

    let failure: string | null = null
    try {
      const { error } = await supabase.from('player_mapping').upsert(
        {
          player_id: member.userId,
          display_name: member.displayName || member.userId,
          guild_code: job.guild_code,
          is_current: true,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'player_id'
        }
      )
      if (error) failure = error.message || 'Unknown error'
    } catch (error) {
      failure =
        error instanceof Error && error.message
          ? error.message
          : 'Unknown error'
    }

    if (failure !== null) {
      result.upsertFailures++
      result.errors.push(`Player upsert failed: ${failure}`)
      firstFailure ??= failure
      continue
    }

    result.playersUpdated++
    succeeded++
  }

  if (attempted === 0) {
    return
  }

  if (succeeded === 0) {
    const reason = `failed for all ${attempted} member(s): ${firstFailure ?? 'Unknown error'}`
    await recordRosterWriteOutcome(
      supabase,
      job.guild_code,
      false,
      0,
      `player_sync upsert ${reason}`
    )
    throw new Error(`Player upsert ${reason}`)
  }

  // Some rows landed, so the roster was written; one rejected row must not flip the guild's
  // roster alert. The per-row errors reach complete_job as batch_errors.
  if (succeeded < attempted) {
    logger.warn(
      { guildCode: job.guild_code, attempted, failed: attempted - succeeded },
      'Player sync completed with partial upsert failures'
    )
  }

  await recordRosterWriteOutcome(
    supabase,
    job.guild_code,
    true,
    succeeded,
    null
  )
}
