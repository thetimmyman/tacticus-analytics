import type { ServiceSupabaseClient } from '@/app/lib/sync/worker-types'
import { createComponentLogger } from '@/app/lib/logging'
import type {
  AvailabilityTransition,
  DefeatTransition,
  HeraldPingMode
} from '../contracts'
import type { GuildHeraldConfig, HeraldBossConfigLookup } from '../config'
import type { HeraldRunResult } from '../run-types'
import { collapseCombinedPrimeDefeats } from '../detect'
import { rarityToRaritySet } from '../boss-slug'
import { resolveDefeatPingMode } from '../season-state'
import { resolveChannelsForTransition } from '../config'
import { postHeraldEvent } from '../dispatch'

const logger = createComponentLogger('herald')

export interface DefeatPhaseInput {
  supabase: ServiceSupabaseClient
  guildCode: string
  invocationId: string
  defeatTransitions: DefeatTransition[]
  availabilityTransitions: AvailabilityTransition[]
  bossDisplayOverrides: Map<string, string>
  bossConfigs: HeraldBossConfigLookup
  pingModesPerSeason: Map<string, HeraldPingMode>
  guildHeraldConfig: GuildHeraldConfig
  guildDefaultUrl: string | null
  guildDefaultThreadId: string | null
  result: HeraldRunResult
}

export async function dispatchDefeatPhase({
  supabase,
  guildCode,
  invocationId,
  defeatTransitions,
  availabilityTransitions,
  bossDisplayOverrides,
  bossConfigs,
  pingModesPerSeason,
  guildHeraldConfig,
  guildDefaultUrl,
  guildDefaultThreadId,
  result: baseResult
}: DefeatPhaseInput): Promise<void> {
  // Apply display names BEFORE collapsing so "A & B" uses the real prime names.
  for (const t of defeatTransitions) {
    const overrideName = bossDisplayOverrides.get(t.boss_id)
    if (overrideName) t.boss_display_name = overrideName
  }
  const collapsed = collapseCombinedPrimeDefeats(
    defeatTransitions,
    (transition) => {
      const mode = resolveDefeatPingMode(
        bossConfigs,
        transition,
        pingModesPerSeason
      )
      if (mode === 'combined') return true
      if (mode === 'per_side' || mode === 'skip_all') return false
      return guildHeraldConfig.combinePrimeDeaths
    }
  )
  if (collapsed.consumed.length > 0) {
    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        combined_pairs: collapsed.consumed.length
      },
      'herald.combine.applied'
    )
    // Pre-claim consumed secondaries; 23505 means an earlier run did.
    for (const t of collapsed.consumed) {
      try {
        const { error: insertErr } = await supabase
          .from('herald_posted_events')
          .insert({
            guild_code: guildCode,
            season: t.season,
            boss_id: t.boss_id,
            transition_type: 'boss_defeated',
            completed_on: t.completed_on
          })
        if (insertErr && (insertErr as { code?: string }).code !== '23505') {
          logger.warn(
            {
              herald_invocation_id: invocationId,
              guild_code: guildCode,
              boss_id: t.boss_id,
              error: insertErr.message
            },
            'herald.combine.dedup_claim_error'
          )
        }
      } catch (err) {
        logger.warn(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            boss_id: t.boss_id,
            error: err instanceof Error ? err.message : String(err)
          },
          'herald.combine.dedup_claim_exception'
        )
      }
    }
  }
  // The kill-switch skips dispatch only (no dedup claim), so re-enabling still posts recent defeats.
  const defeatsToDispatch = guildHeraldConfig.defeatAlertsEnabled
    ? collapsed.dispatched
    : []
  if (
    !guildHeraldConfig.defeatAlertsEnabled &&
    collapsed.dispatched.length > 0
  ) {
    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        suppressed_defeats: collapsed.dispatched.length
      },
      'herald.defeat.suppressed_by_toggle'
    )
  }
  for (let i = 0; i < defeatsToDispatch.length; i += 1) {
    const transition = defeatsToDispatch[i]
    if (!transition) continue
    const defeatRaritySet = rarityToRaritySet(transition.rarity, transition.set)
    const bossConfig = bossConfigs.resolve(transition.boss_id, defeatRaritySet)
    const channels = await resolveChannelsForTransition(
      supabase,
      guildCode,
      bossConfig,
      guildDefaultUrl,
      guildDefaultThreadId
    )
    if (channels.length === 0) {
      logger.info(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: transition.boss_id,
          per_boss_enabled: bossConfig ? bossConfig.enabled : null
        },
        'herald.skip.no_valid_channels'
      )
      continue
    }
    try {
      const result = await postHeraldEvent({
        supabase,
        guildCode,
        transition,
        invocationId,
        channels,
        notificationsEnabled: guildHeraldConfig.notificationsEnabled
      })
      if (result.outcome === 'posted') baseResult.posted += 1
      else if (result.outcome === 'dedup') baseResult.deduped += 1
      else if (result.outcome === 'failed') baseResult.failed += 1
    } catch (err) {
      baseResult.failed += 1
      logger.error(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: transition.boss_id,
          error: err instanceof Error ? err.message : String(err)
        },
        'herald.post.exception'
      )
    }
    if (i < defeatsToDispatch.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  if (defeatsToDispatch.length > 0 && availabilityTransitions.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}
