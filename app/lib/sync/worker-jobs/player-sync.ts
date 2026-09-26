import { createComponentLogger } from '@/app/lib/logging'
import type { GuildConfig } from '@tacticus/app-core/types'
import { fetchTacticusApi } from '../tacticus-api-client'
import type {
  GuildApiMember,
  ServiceSupabaseClient,
  SyncJob,
  WorkerResult
} from '../worker-types'

const logger = createComponentLogger('lib.sync.worker-jobs.player-sync')

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

  for (const member of members) {
    if (!member.userId) {
      continue
    }
    await supabase.from('player_mapping').upsert(
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

    result.playersUpdated++
  }
}
