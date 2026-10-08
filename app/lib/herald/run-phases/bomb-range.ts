import type { ServiceSupabaseClient } from '@/app/lib/sync/worker-types'
import { createComponentLogger } from '@/app/lib/logging'
import type { BombRangeTransition } from '../contracts'
import type { GuildHeraldConfig } from '../config'
import type { HeraldRunResult } from '../run-types'
import { postHeraldBombRangeEvent } from '../dispatch'

const logger = createComponentLogger('herald')

export interface BombRangeDispatchInput {
  supabase: ServiceSupabaseClient
  guildCode: string
  invocationId: string
  bombTransitions: BombRangeTransition[]
  bombHolderMemberIds: string[]
  bossDisplayOverrides: Map<string, string>
  guildHeraldConfig: GuildHeraldConfig
  result: HeraldRunResult
}

export async function dispatchBombRangePhase({
  supabase,
  guildCode,
  invocationId,
  bombTransitions,
  bombHolderMemberIds,
  bossDisplayOverrides,
  guildHeraldConfig,
  result: baseResult
}: BombRangeDispatchInput): Promise<void> {
  for (let i = 0; i < bombTransitions.length; i += 1) {
    const transition = bombTransitions[i]
    if (!transition) continue
    const overrideName = bossDisplayOverrides.get(transition.boss_id)
    if (overrideName) transition.boss_display_name = overrideName
    try {
      const result = await postHeraldBombRangeEvent({
        supabase,
        guildCode,
        transition,
        invocationId,
        webhookUrl: guildHeraldConfig.bombAlertWebhookUrl ?? '',
        roleId: guildHeraldConfig.bombAlertRoleId,
        notificationsEnabled: guildHeraldConfig.notificationsEnabled,
        pingHolders: guildHeraldConfig.bombAlertPingHolders,
        bombHolderMemberIds
      })
      if (result.outcome === 'posted') baseResult.bomb_range_posted += 1
      else if (result.outcome === 'dedup') baseResult.bomb_range_deduped += 1
      else if (result.outcome === 'failed') baseResult.bomb_range_failed += 1
    } catch (err) {
      baseResult.bomb_range_failed += 1
      logger.error(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: transition.boss_id,
          error: err instanceof Error ? err.message : String(err)
        },
        'herald.bomb_range.post.exception'
      )
    }
    if (i < bombTransitions.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}
