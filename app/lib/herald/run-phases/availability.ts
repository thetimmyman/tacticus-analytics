import type { SupabaseClient } from '@supabase/supabase-js'
import { createComponentLogger } from '@/app/lib/logging'
import type { AvailabilityTransition, HeraldPingMode } from '../contracts'
import type {
  GuildHeraldConfig,
  HeraldBossConfigLookup,
  ResolveRoleMappingsResult
} from '../config'
import type { HeraldRunResult } from '../run-types'
import { collapseCombinedPrimeAvailabilities } from '../detect'
import { mainBossIdForGroup, rarityToRaritySet } from '../boss-slug'
import {
  isPrimeSkipped,
  loadSeasonNotesForTransitions,
  mergeCombinedPrimeNotes,
  primeSkipSubKey,
  resolveNoteForEncounter,
  type SeasonNotes
} from '../season-state'
import {
  resolveChannelsForTransition,
  resolveRoleIdsForTransition,
  sanitizeRoleId
} from '../config'
import { postHeraldAvailabilityEvent } from '../dispatch'

const logger = createComponentLogger('herald')

export interface AvailabilityPhaseInput {
  supabase: SupabaseClient
  guildCode: string
  invocationId: string
  availabilityTransitions: AvailabilityTransition[]
  bossDisplayOverrides: Map<string, string>
  bossConfigs: HeraldBossConfigLookup
  pingModesPerSeason: Map<string, HeraldPingMode>
  guildHeraldConfig: GuildHeraldConfig
  result: HeraldRunResult
  skippedPrimesForPredict: Map<string, Set<string>>
  rolesResolution: ResolveRoleMappingsResult
  roleLabels: Map<string, string>
  guildDefaultUrl: string | null
  guildDefaultThreadId: string | null
}

export async function dispatchAvailabilityPhase({
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
}: AvailabilityPhaseInput): Promise<void> {
  const skippedPrimesBySeason = skippedPrimesForPredict

  const seasonNotesMap =
    availabilityTransitions.length > 0
      ? await loadSeasonNotesForTransitions(
          supabase,
          guildCode,
          availabilityTransitions
        )
      : new Map<string, SeasonNotes>()

  for (const t of availabilityTransitions) {
    const overrideName = bossDisplayOverrides.get(t.boss_id)
    if (overrideName) t.boss_display_name = overrideName
  }

  const decideAvailabilityCombine = (t: AvailabilityTransition): boolean => {
    const raritySet = rarityToRaritySet(t.rarity, t.set)
    if (raritySet && t.season !== null) {
      const seasonKey = `${t.season}|${raritySet}`
      const override = pingModesPerSeason.get(seasonKey)
      if (override === 'combined') return true
      if (override === 'per_side' || override === 'skip_all') return false
    }
    const direct = bossConfigs.resolve(t.boss_id, raritySet)
    if (direct?.ping_mode_explicit) return direct.ping_mode === 'combined'
    const mainBossId = mainBossIdForGroup(t.boss_id)
    if (mainBossId !== t.boss_id) {
      const group = bossConfigs.resolve(mainBossId, raritySet)
      if (group?.ping_mode_explicit) return group.ping_mode === 'combined'
    }
    return guildHeraldConfig.combinePrimeDeaths
  }
  const availabilityCollapsed = collapseCombinedPrimeAvailabilities(
    availabilityTransitions,
    decideAvailabilityCombine
  )
  if (availabilityCollapsed.consumed.length > 0) {
    logger.info(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        combined_pairs: availabilityCollapsed.consumed.length
      },
      'herald.available.combine.applied'
    )
    // Pre-claim consumed secondaries so later syncs don't re-fire; 23505 is benign.
    for (const t of availabilityCollapsed.consumed) {
      try {
        const { error: insertErr } = await supabase
          .from('herald_boss_availability')
          .insert({
            guild_code: guildCode,
            season: t.season,
            boss_id: t.boss_id,
            boss_type: t.boss_type,
            encounter_index: t.encounter_index,
            rarity: t.rarity,
            tier: t.tier,
            set_num: t.set,
            loop_index: t.loop_index
          })
        if (insertErr && (insertErr as { code?: string }).code !== '23505') {
          logger.warn(
            {
              herald_invocation_id: invocationId,
              guild_code: guildCode,
              boss_id: t.boss_id,
              error: insertErr.message
            },
            'herald.available.combine.dedup_claim_error'
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
          'herald.available.combine.dedup_claim_exception'
        )
      }
    }
  }
  const availabilityDispatchList = availabilityCollapsed.dispatched

  for (let i = 0; i < availabilityDispatchList.length; i += 1) {
    const transition = availabilityDispatchList[i]
    if (!transition) continue
    // Do NOT re-apply display names here: it would overwrite "A & B".

    if (transition.encounter_index > 0) {
      const raritySet = rarityToRaritySet(transition.rarity, transition.set)
      if (
        raritySet &&
        isPrimeSkipped(
          skippedPrimesBySeason.get(String(transition.season)),
          transition.boss_type,
          raritySet,
          transition.encounter_index
        )
      ) {
        logger.info(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            boss_id: transition.boss_id,
            sub_key: primeSkipSubKey(raritySet, transition.encounter_index),
            season: transition.season
          },
          'herald.available.skip.prime_skipped_by_plan'
        )
        continue
      }
    }

    const availabilityRaritySet = rarityToRaritySet(
      transition.rarity,
      transition.set
    )
    const bossConfig = bossConfigs.resolve(
      transition.boss_id,
      availabilityRaritySet
    )
    // Combined posts use the primary's boss_id but union both primes' roles and notes.
    const partner =
      availabilityCollapsed.partnerByDispatchedBossId.get(transition.boss_id) ??
      null
    const partnerBossConfig = partner
      ? bossConfigs.resolve(partner.boss_id, availabilityRaritySet)
      : null
    const primaryRoleIds = resolveRoleIdsForTransition(
      bossConfig,
      rolesResolution.mappings,
      transition.boss_id,
      availabilityRaritySet,
      {
        encounterIndex: transition.encounter_index,
        hasCustomMessageUrl: bossConfig?.custom_message_url != null
      }
    )
    const partnerRoleIds = partner
      ? resolveRoleIdsForTransition(
          partnerBossConfig,
          rolesResolution.mappings,
          partner.boss_id,
          availabilityRaritySet,
          {
            encounterIndex: partner.encounter_index,
            hasCustomMessageUrl: partnerBossConfig?.custom_message_url != null
          }
        )
      : []
    const roleIdsForBoss = (() => {
      const seen = new Set<string>()
      const out: string[] = []
      for (const r of [...primaryRoleIds, ...partnerRoleIds]) {
        if (seen.has(r)) continue
        seen.add(r)
        out.push(r)
      }
      if (out.length === 0 && guildHeraldConfig.defaultRoleId) {
        out.push(guildHeraldConfig.defaultRoleId)
      }
      return out
    })()
    const availabilityRoleLabels = new Map(roleLabels)
    for (const config of [bossConfig, partnerBossConfig]) {
      if (!config || config.discord_role_ids.length === 0) continue
      const configuredRoleIds = new Set(
        config.discord_role_ids
          .map((roleId) => sanitizeRoleId(roleId))
          .filter((roleId): roleId is string => roleId !== null)
      )
      for (const roleId of roleIdsForBoss) {
        if (!configuredRoleIds.has(roleId)) continue
        const label = config.discord_role_labels[roleId]
        if (label) availabilityRoleLabels.set(roleId, label)
      }
    }
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
        'herald.available.skip.no_valid_channels'
      )
      continue
    }
    const seasonNotesKey = `${transition.season}|${availabilityRaritySet ?? ''}`
    const primaryNote = resolveNoteForEncounter(
      bossConfig,
      seasonNotesMap.get(seasonNotesKey) ?? null,
      transition.encounter_index
    )
    let encounterNote = primaryNote
    if (partner) {
      const partnerNote = resolveNoteForEncounter(
        partnerBossConfig,
        seasonNotesMap.get(seasonNotesKey) ?? null,
        partner.encounter_index
      )
      encounterNote = mergeCombinedPrimeNotes(
        primaryNote,
        transition.encounter_index,
        partnerNote,
        partner.encounter_index
      )
    }
    try {
      const result = await postHeraldAvailabilityEvent({
        supabase,
        guildCode,
        transition,
        invocationId,
        channels,
        roleIds: roleIdsForBoss,
        bossConfig,
        note: encounterNote,
        notificationsEnabled: guildHeraldConfig.notificationsEnabled,
        mentionRolesAsText: guildHeraldConfig.mentionRolesAsText,
        roleLabels: availabilityRoleLabels,
        compactAvailabilityPosts: guildHeraldConfig.compactAvailabilityPosts
      })
      if (result.outcome === 'posted') baseResult.availability_posted += 1
      else if (result.outcome === 'dedup') baseResult.availability_deduped += 1
      else if (result.outcome === 'failed') baseResult.availability_failed += 1
    } catch (err) {
      baseResult.availability_failed += 1
      logger.error(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: transition.boss_id,
          error: err instanceof Error ? err.message : String(err)
        },
        'herald.available.post.exception'
      )
    }
    if (i < availabilityDispatchList.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}
