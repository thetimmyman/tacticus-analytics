import 'server-only'
import { randomUUID } from 'crypto'
import { createComponentLogger } from '@/app/lib/logging'
import { fetchGuildBombsAvailable } from '@/app/lib/tacticus/guild-bombs'
import type { BombRangeTransition } from './contracts'
import { detectBombRangeTransitions } from './detect'
import {
  DEFAULT_GUILD_HERALD_CONFIG,
  loadGuildHeraldConfig,
  refreshAutoUpdateMappings,
  resolveHeraldBossConfigs,
  resolveHeraldRoleMappings,
  resolveHeraldWebhook,
  type HeraldBossConfigLookup,
  type ResolveRoleMappingsResult
} from './config'
import { loadBossDisplayNameOverrides } from './season-state'
import { prepareHeraldTransitions } from './transition-preparation'
import {
  createEmptyHeraldRunResult,
  type HeraldRunResult,
  type RunHeraldForSyncParams
} from './run-types'
import { dispatchDefeatPhase } from './run-phases/defeat'
import { dispatchAvailabilityPhase } from './run-phases/availability'
import { dispatchBombRangePhase } from './run-phases/bomb-range'

const logger = createComponentLogger('herald')

export const runHeraldForSync = async (
  params: RunHeraldForSyncParams
): Promise<HeraldRunResult> => {
  const invocationId = randomUUID()
  const {
    supabase,
    guildCode,
    battles,
    allBattles,
    nowMs,
    bombsAvailableOverride
  } = params

  const baseResult = createEmptyHeraldRunResult(invocationId)

  try {
    const {
      killThresholdMap,
      pingModesPerSeason,
      defeatTransitions,
      availabilityTransitions,
      skippedPrimesForPredict
    } = await prepareHeraldTransitions({
      supabase,
      guildCode,
      battles,
      allBattles,
      nowMs,
      invocationId,
      onDefeatsDetected: (count) => {
        baseResult.detected = count
      }
    })
    baseResult.availability_detected = availabilityTransitions.length

    const hasStandardTransitions =
      defeatTransitions.length > 0 || availabilityTransitions.length > 0
    const needsGuildHeraldConfig =
      hasStandardTransitions || (allBattles && allBattles.length > 0)

    const guildHeraldConfig = needsGuildHeraldConfig
      ? await loadGuildHeraldConfig(supabase, guildCode)
      : { ...DEFAULT_GUILD_HERALD_CONFIG }
    if (
      guildHeraldConfig.notificationsEnabled === false ||
      guildHeraldConfig.mentionRolesAsText === true ||
      guildHeraldConfig.combinePrimeDeaths === true ||
      guildHeraldConfig.defeatAlertsEnabled === false
    ) {
      logger.info(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          notifications_enabled: guildHeraldConfig.notificationsEnabled,
          mention_roles_as_text: guildHeraldConfig.mentionRolesAsText,
          combine_prime_deaths: guildHeraldConfig.combinePrimeDeaths,
          defeat_alerts_enabled: guildHeraldConfig.defeatAlertsEnabled
        },
        'herald.config.toggles_active'
      )
    }

    // Before the "nothing to post" return: bomb range usually fires with no other transition.
    let bombTransitions: BombRangeTransition[] = []
    let bombHolderMemberIds: string[] = []
    if (
      allBattles &&
      allBattles.length > 0 &&
      guildHeraldConfig.bombAlertEnabled &&
      guildHeraldConfig.bombAlertWebhookUrl &&
      guildHeraldConfig.notificationsEnabled !== false
    ) {
      let bombsAvailable: number
      if (typeof bombsAvailableOverride === 'number') {
        bombsAvailable = bombsAvailableOverride
      } else {
        const snapshot = await fetchGuildBombsAvailable(supabase, guildCode)
        bombsAvailable = snapshot?.total ?? 0
        bombHolderMemberIds = snapshot?.holderIds ?? []
      }
      if (bombsAvailable > 0) {
        bombTransitions = detectBombRangeTransitions(allBattles, {
          bombsAvailable,
          overkillThreshold: guildHeraldConfig.bombAlertOverkillThreshold,
          guildLevel: guildHeraldConfig.guildLevel,
          calculationMode: guildHeraldConfig.bombAlertCalculationMode,
          nowMs,
          killThresholdMap
        })
        baseResult.bomb_range_detected = bombTransitions.length
        if (bombTransitions.length > 0) {
          logger.info(
            {
              herald_invocation_id: invocationId,
              guild_code: guildCode,
              count: bombTransitions.length,
              under_kill_threshold: bombTransitions.filter(
                (t) => t.under_kill_threshold
              ).length,
              bombs_available: bombsAvailable,
              overkill_threshold: guildHeraldConfig.bombAlertOverkillThreshold,
              guild_level: guildHeraldConfig.guildLevel,
              calculation_mode: guildHeraldConfig.bombAlertCalculationMode
            },
            'herald.bomb_range.detect'
          )
        }
      }
    }

    if (!hasStandardTransitions && bombTransitions.length === 0) {
      try {
        await refreshAutoUpdateMappings(supabase, guildCode, invocationId)
      } catch (autoErr) {
        logger.warn(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            error: autoErr instanceof Error ? autoErr.message : String(autoErr)
          },
          'herald.auto_update.exception'
        )
      }
      return baseResult
    }

    let guildDefaultUrl: string | null = null
    let guildDefaultThreadId: string | null = null
    let webhookSkipReason: string | null = null
    let bossConfigs: HeraldBossConfigLookup = {
      resolve: () => null,
      size: 0,
      rows: []
    }
    let rolesResolution: ResolveRoleMappingsResult = {
      mappings: [],
      droppedCount: 0
    }

    if (hasStandardTransitions) {
      const webhookResolution = await resolveHeraldWebhook(supabase, guildCode)
      guildDefaultUrl = webhookResolution.webhookUrl
      guildDefaultThreadId = webhookResolution.threadId ?? null
      webhookSkipReason = webhookResolution.reason ?? null
      if (guildDefaultUrl && webhookResolution.scope) {
        logger.info(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            scope: webhookResolution.scope
          },
          'herald.webhook.resolved'
        )
      }
      bossConfigs = await resolveHeraldBossConfigs(supabase, guildCode)
    }

    if (
      hasStandardTransitions &&
      !guildDefaultUrl &&
      bossConfigs.size === 0 &&
      bombTransitions.length === 0
    ) {
      logger.info(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          reason: webhookSkipReason ?? 'no_per_boss_config'
        },
        'herald.skip.disabled'
      )
      return {
        ...baseResult,
        skipped_reason: webhookSkipReason ?? 'disabled'
      }
    }

    if (hasStandardTransitions) {
      rolesResolution = await resolveHeraldRoleMappings(supabase, guildCode)
      if (rolesResolution.droppedCount > 0) {
        logger.warn(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            dropped_count: rolesResolution.droppedCount
          },
          'herald.warn.invalid_role_id'
        )
      }
    }
    const roleLabels = new Map<string, string>()
    for (const m of rolesResolution.mappings) {
      if (!roleLabels.has(m.discord_role_id) && m.display_label) {
        roleLabels.set(m.discord_role_id, m.display_label)
      }
    }

    const bossDisplayOverrides =
      hasStandardTransitions || bombTransitions.length > 0
        ? await loadBossDisplayNameOverrides(supabase)
        : new Map<string, string>()

    await dispatchDefeatPhase({
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
    })

    await dispatchAvailabilityPhase({
      supabase,
      guildCode,
      invocationId,
      availabilityTransitions,
      bossDisplayOverrides,
      bossConfigs,
      pingModesPerSeason,
      guildHeraldConfig,
      result: baseResult,
      skippedPrimesForPredict,
      rolesResolution,
      roleLabels,
      guildDefaultUrl,
      guildDefaultThreadId
    })

    await dispatchBombRangePhase({
      supabase,
      guildCode,
      invocationId,
      bombTransitions,
      bombHolderMemberIds,
      bossDisplayOverrides,
      guildHeraldConfig,
      result: baseResult
    })

    try {
      await refreshAutoUpdateMappings(supabase, guildCode, invocationId)
    } catch (autoErr) {
      logger.warn(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          error: autoErr instanceof Error ? autoErr.message : String(autoErr)
        },
        'herald.auto_update.exception'
      )
    }

    return baseResult
  } catch (err) {
    logger.error(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        error: err instanceof Error ? err.message : String(err)
      },
      'herald.run.exception'
    )
    return { ...baseResult, skipped_reason: 'exception' }
  }
}
