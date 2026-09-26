import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import 'server-only'
import { createComponentLogger } from '@/app/lib/logging'
import { scoreRosterAgainstPlaybook } from '@/app/lib/services/strength-precedence'
import type { HeroRequirement } from '@/app/lib/meta/roster-strength'
import { getRankIndexFromName } from '@/app/lib/tacticus/ranks'
import { addGuildMemberRole } from './bot-rest-client'
import type { ServiceSupabaseClient } from '@/app/lib/sync/worker-types'
import {
  findVerifiedDiscordForMapping,
  resolveVerifiedDiscordIdentities
} from '@/app/lib/auth/verified-player-authority'

const logger = createComponentLogger('discord.role-reconciler')

// Top-N teams by capability, gated on recent engagement (capability alone labels lurkers).
// Additive only: never removes roles or overwrites an existing player_meta_roles row.

const ENGAGEMENT_MIN_TOKENS = 5
const ENGAGEMENT_LOOKBACK_SEASONS = 3
const TOP_N_CAPABILITY = 2

export type TriggerSource = 'post_sync' | 'manual_resync'

export type ReconcileAction =
  | 'added'
  | 'skipped_manual'
  | 'skipped_already_present'
  | 'skipped_no_discord_user'
  | 'skipped_threshold_not_met'
  | 'failed'

interface AuditEvent {
  guild_code: string
  user_id: string | null
  player_id: string | null
  meta_team_id: string | null
  discord_role_id: string | null
  action: ReconcileAction
  reason: string | null
  trigger_source: TriggerSource
  triggered_by: string | null
  http_status: number | null
}

export interface ReconcileResult {
  guild_code: string
  trigger_source: TriggerSource
  members_evaluated: number
  roles_added: number
  skipped_manual: number
  skipped_already_present: number
  skipped_no_discord_user: number
  skipped_threshold_not_met: number
  failed: number
  duration_ms: number
}

interface ReconcileOptions {
  trigger_source: TriggerSource
  triggered_by?: string | null
  force?: boolean
  only_user_id?: string
  nowMs?: number
}

interface RoleMapping {
  meta_team_slug: string
  meta_team_id: string | null
  discord_role_ids: string[]
  enabled: boolean
}

interface GuildMember {
  id: number
  user_id: string
  player_id: string
  display_name: string
  discord_user_id: string | null
}

interface PlayerRoster {
  user_id: string
  // As scoreRosterAgainstPlaybook expects.
  heroes: Map<
    string,
    {
      rank: number | null
      activeAbility: number | null
      passiveAbility: number | null
    }
  >
}

interface MetaTeamRequirements {
  meta_team_id: string
  // The BEST percentage across bosses qualifies.
  boss_requirement_sets: HeroRequirement[][]
}

const writeAuditEvents = async (
  supabase: ServiceSupabaseClient,
  events: AuditEvent[]
): Promise<void> => {
  if (events.length === 0) return
  const { error } = await supabase
    .from('role_reconciliation_events')
    .insert(events as never)
  if (error) {
    logger.warn(
      { count: events.length, error: error.message },
      'role_reconciler.audit_write_failed'
    )
  }
}

const loadGuildContext = async (
  supabase: ServiceSupabaseClient,
  guildCode: string
): Promise<{
  discord_server_id: string | null
  auto_enabled: boolean
  threshold_pct: number
  tier: 'optimal' | 'strong' | 'suitable'
} | null> => {
  // Oldest mapping, matching the RPC tiebreak.
  const { data: discordMapping } = await supabase
    .from('discord_server_guilds')
    .select('discord_guild_id')
    .eq('game_guild_code', guildCode)
    .eq('is_active', true)
    .order('linked_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const discordServerId = discordMapping?.discord_guild_id ?? null

  const { data: scoringConfigRow } = await supabase
    .from('guild_roster_scoring_config')
    .select(
      'auto_role_assign_enabled, auto_role_assign_tier, tier_optimal_pct, tier_strong_pct, tier_suitable_pct'
    )
    .eq('guild_code', guildCode)
    .maybeSingle()
  const scoringConfig = scoringConfigRow as {
    auto_role_assign_enabled: boolean
    auto_role_assign_tier: 'optimal' | 'strong' | 'suitable'
    tier_optimal_pct: number
    tier_strong_pct: number
    tier_suitable_pct: number
  } | null

  const tier: 'optimal' | 'strong' | 'suitable' =
    scoringConfig?.auto_role_assign_tier ?? 'strong'
  const tierPct =
    tier === 'optimal'
      ? (scoringConfig?.tier_optimal_pct ?? 100)
      : tier === 'strong'
        ? (scoringConfig?.tier_strong_pct ?? 80)
        : (scoringConfig?.tier_suitable_pct ?? 60)

  return {
    discord_server_id: discordServerId,
    auto_enabled: scoringConfig?.auto_role_assign_enabled ?? false,
    threshold_pct: tierPct,
    tier
  }
}

const loadGuildMembers = async (
  supabase: ServiceSupabaseClient,
  guildCode: string,
  onlyUserId?: string
): Promise<GuildMember[]> => {
  let query = guildRosterQuery(
    supabase,
    guildCode,
    'id, user_id, player_id, display_name, guild_code, discord_user_id'
  )
  if (onlyUserId) {
    query = query.eq('user_id', onlyUserId)
  }
  const { data } = await query
  return ((data ?? []) as GuildMember[]).filter((m) => m.user_id && m.player_id)
}

const loadRoleMappings = async (
  supabase: ServiceSupabaseClient,
  guildCode: string
): Promise<RoleMapping[]> => {
  const { data: rawData } = await supabase
    .from('herald_meta_role_mapping')
    .select('meta_team_slug, discord_role_id, enabled')
    .eq('guild_code', guildCode)
  const data = (rawData ?? []).filter(
    (
      r
    ): r is {
      meta_team_slug: string
      discord_role_id: string
      enabled: boolean
    } =>
      typeof r.meta_team_slug === 'string' &&
      typeof r.discord_role_id === 'string' &&
      typeof r.enabled === 'boolean'
  )
  if (data.length === 0) return []

  const slugs = Array.from(new Set(data.map((r) => r.meta_team_slug)))
  if (slugs.length === 0) return []

  // Unmatched slugs ('ALL') are dropped.
  const { data: teams } = (await supabase
    .from('meta_teams')
    .select('id, team_name')
    .in('team_name', slugs)) as {
    data: { id: string; team_name: string }[] | null
  }
  const slugToId = new Map<string, string>(
    (teams ?? []).map((t) => [t.team_name, t.id])
  )

  // One mapping per team so a team cannot occupy multiple top-N slots.
  const byTeamId = new Map<string, RoleMapping>()
  for (const r of data) {
    if (!r.enabled || !r.discord_role_id) continue
    const metaTeamId = slugToId.get(r.meta_team_slug) ?? null
    if (metaTeamId === null) continue
    const existing = byTeamId.get(metaTeamId)
    if (!existing) {
      byTeamId.set(metaTeamId, {
        meta_team_slug: r.meta_team_slug,
        meta_team_id: metaTeamId,
        discord_role_ids: [r.discord_role_id],
        enabled: r.enabled
      })
    } else if (!existing.discord_role_ids.includes(r.discord_role_id)) {
      existing.discord_role_ids.push(r.discord_role_id)
    }
  }
  return Array.from(byTeamId.values())
}

const loadPlayerRosters = async (
  supabase: ServiceSupabaseClient,
  userIds: string[]
): Promise<Map<string, PlayerRoster>> => {
  if (userIds.length === 0) return new Map()
  const { data } = await supabase
    .from('player_roster')
    .select(
      'user_id, hero_mapping_id, rank_name, active_ability_level, passive_ability_level'
    )
    .in('user_id', userIds)
  if (!data || data.length === 0) return new Map()

  const heroIds = Array.from(
    new Set(
      (data as Array<{ hero_mapping_id: number | null }>)
        .map((r) => r.hero_mapping_id)
        .filter((id): id is number => typeof id === 'number')
    )
  )
  // TODO: decide which hero_mappings column playbook hero_name normalizes against.
  const { data: heroes } = await supabase
    .from('hero_mappings')
    .select('id, display_name')
    .in('id', heroIds)
  if (heroes && heroes.length === 0 && heroIds.length > 0) {
    logger.warn(
      { heroIdCount: heroIds.length },
      'role_reconciler.hero_mappings_lookup_empty'
    )
  }
  const heroIdToName = new Map<number, string>()
  for (const h of heroes ?? []) {
    if (h.display_name) heroIdToName.set(h.id, h.display_name)
  }

  const parseRank = (rankName: string | null): number | null =>
    getRankIndexFromName(rankName)

  const out = new Map<string, PlayerRoster>()
  for (const row of data) {
    if (!row.user_id || row.hero_mapping_id === null) continue
    const heroName = heroIdToName.get(row.hero_mapping_id)
    if (!heroName) continue
    let rosterEntry = out.get(row.user_id)
    if (!rosterEntry) {
      rosterEntry = { user_id: row.user_id, heroes: new Map() }
      out.set(row.user_id, rosterEntry)
    }
    rosterEntry.heroes.set(heroName.toLowerCase(), {
      rank: parseRank(row.rank_name),
      activeAbility: row.active_ability_level,
      passiveAbility: row.passive_ability_level
    })
  }
  return out
}

const loadMetaTeamRequirements = async (
  supabase: ServiceSupabaseClient,
  metaTeamIds: string[]
): Promise<Map<string, MetaTeamRequirements>> => {
  if (metaTeamIds.length === 0) return new Map()
  const { data } = (await supabase
    .from('boss_playbook_team_requirements')
    .select('meta_team_id, hero_requirements')
    .in('meta_team_id', metaTeamIds)) as {
    data: Array<{
      meta_team_id: string | null
      hero_requirements: HeroRequirement[] | null
    }> | null
  }
  if (!data) return new Map()
  const out = new Map<string, MetaTeamRequirements>()
  for (const row of data) {
    if (!row.meta_team_id || !Array.isArray(row.hero_requirements)) continue
    let entry = out.get(row.meta_team_id)
    if (!entry) {
      entry = { meta_team_id: row.meta_team_id, boss_requirement_sets: [] }
      out.set(row.meta_team_id, entry)
    }
    entry.boss_requirement_sets.push(row.hero_requirements)
  }
  return out
}

const loadExistingRoleAssignments = async (
  supabase: ServiceSupabaseClient,
  userIds: string[]
): Promise<Map<string, Map<string, string>>> => {
  if (userIds.length === 0) return new Map()
  const { data } = await supabase
    .from('player_meta_roles')
    .select('user_id, meta_team_id, source')
    .in('user_id', userIds)
  const out = new Map<string, Map<string, string>>()
  for (const row of data ?? []) {
    let inner = out.get(row.user_id)
    if (!inner) {
      inner = new Map()
      out.set(row.user_id, inner)
    }
    inner.set(row.meta_team_id, row.source)
  }
  return out
}

const loadCurrentSeason = async (
  supabase: ServiceSupabaseClient
): Promise<number | null> => {
  const { data, error } = await supabase.rpc('get_latest_season')
  if (error || !data) return null
  const parsed = typeof data === 'string' ? parseInt(data, 10) : Number(data)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const loadEngagement = async (
  supabase: ServiceSupabaseClient,
  guildCode: string,
  playerIds: string[],
  minSeason: number
): Promise<Map<string, Map<string, number>>> => {
  const out = new Map<string, Map<string, number>>()
  if (playerIds.length === 0) return out
  const { data, error } = await supabase.rpc(
    'get_player_meta_team_engagement',
    {
      p_guild_code: guildCode,
      p_player_ids: playerIds,
      p_min_season: minSeason,
      p_min_tokens: ENGAGEMENT_MIN_TOKENS
    }
  )
  if (error || !data) {
    if (error) {
      logger.warn(
        { guildCode, error: error.message },
        'role_reconciler.engagement_rpc_failed'
      )
    }
    return out
  }
  const rows = data as Array<{
    player_id: string | null
    meta_team: string | null
    token_count: number | string | null
  }>
  for (const r of rows) {
    if (!r.player_id || !r.meta_team) continue
    const tokens =
      typeof r.token_count === 'number'
        ? r.token_count
        : parseInt(String(r.token_count ?? 0), 10)
    if (!Number.isFinite(tokens)) continue
    let inner = out.get(r.player_id)
    if (!inner) {
      inner = new Map()
      out.set(r.player_id, inner)
    }
    inner.set(r.meta_team, tokens)
  }
  return out
}

export const reconcileGuildRoles = async (
  supabase: ServiceSupabaseClient,
  guildCode: string,
  options: ReconcileOptions
): Promise<ReconcileResult> => {
  const startMs = options.nowMs ?? Date.now()
  const result: ReconcileResult = {
    guild_code: guildCode,
    trigger_source: options.trigger_source,
    members_evaluated: 0,
    roles_added: 0,
    skipped_manual: 0,
    skipped_already_present: 0,
    skipped_no_discord_user: 0,
    skipped_threshold_not_met: 0,
    failed: 0,
    duration_ms: 0
  }

  const ctx = await loadGuildContext(supabase, guildCode)
  if (!ctx) {
    logger.warn({ guildCode }, 'role_reconciler.no_guild_config')
    result.duration_ms = Date.now() - startMs
    return result
  }

  if (!ctx.discord_server_id) {
    logger.info({ guildCode }, 'role_reconciler.skip_no_discord_server_id')
    result.duration_ms = Date.now() - startMs
    return result
  }

  if (!ctx.auto_enabled && !options.force) {
    logger.debug(
      { guildCode, trigger_source: options.trigger_source },
      'role_reconciler.skip_toggle_off'
    )
    result.duration_ms = Date.now() - startMs
    return result
  }

  const [candidateMembers, mappings] = await Promise.all([
    loadGuildMembers(supabase, guildCode, options.only_user_id),
    loadRoleMappings(supabase, guildCode)
  ])
  const verifiedDiscord = await resolveVerifiedDiscordIdentities(
    supabase,
    candidateMembers
      .map((member) => member.discord_user_id)
      .filter((id): id is string => Boolean(id))
  )
  const members = candidateMembers.map((member) => ({
    ...member,
    discord_user_id:
      findVerifiedDiscordForMapping(verifiedDiscord, {
        mappingId: member.id,
        playerId: member.player_id,
        userId: member.user_id,
        guildCode,
        discordUserId: member.discord_user_id
      })?.discordUserId ?? null
  }))
  result.members_evaluated = members.length
  if (members.length === 0 || mappings.length === 0) {
    result.duration_ms = Date.now() - startMs
    return result
  }

  const userIds = members.map((m) => m.user_id)
  const metaTeamIds = mappings
    .map((m) => m.meta_team_id)
    .filter((id): id is string => id !== null)

  const playerIds = members
    .map((m) => m.player_id)
    .filter((p): p is string => !!p)

  const currentSeason = await loadCurrentSeason(supabase)
  const minSeason =
    currentSeason !== null
      ? currentSeason - (ENGAGEMENT_LOOKBACK_SEASONS - 1)
      : 0

  const [rosters, requirements, existing, engagement] = await Promise.all([
    loadPlayerRosters(supabase, userIds),
    loadMetaTeamRequirements(supabase, metaTeamIds),
    loadExistingRoleAssignments(supabase, userIds),
    currentSeason !== null
      ? loadEngagement(supabase, guildCode, playerIds, minSeason)
      : Promise.resolve(new Map<string, Map<string, number>>())
  ])

  // Unknown engagement: skip rather than assign on capability alone.
  if (currentSeason === null) {
    logger.warn({ guildCode }, 'role_reconciler.no_current_season_skip_run')
    result.duration_ms = Date.now() - startMs
    return result
  }

  const audit: AuditEvent[] = []
  const roleInsertsByMember: Array<{
    user_id: string
    meta_team_id: string
    source: 'auto'
    set_by: string | null
  }> = []

  type Candidate = {
    mapping: RoleMapping
    auditBase: Omit<AuditEvent, 'action' | 'reason'>
    bestPct: number
  }

  for (const member of members) {
    const memberExisting = existing.get(member.user_id) ?? new Map()
    const roster = rosters.get(member.user_id)
    const memberEngagement =
      engagement.get(member.player_id) ?? new Map<string, number>()

    const candidates: Candidate[] = []

    for (const mapping of mappings) {
      if (mapping.meta_team_id === null) continue

      const auditBase: Omit<AuditEvent, 'action' | 'reason'> = {
        guild_code: guildCode,
        user_id: member.user_id,
        player_id: member.player_id,
        meta_team_id: mapping.meta_team_id,
        // Skip audits are per-team; PUT audits are per-role.
        discord_role_id: mapping.discord_role_ids[0] ?? null,
        trigger_source: options.trigger_source,
        triggered_by: options.triggered_by ?? null,
        http_status: null
      }

      const existingSource = memberExisting.get(mapping.meta_team_id)
      if (
        existingSource &&
        ['self', 'manual', 'leader_override'].includes(existingSource)
      ) {
        result.skipped_manual++
        audit.push({
          ...auditBase,
          action: 'skipped_manual',
          reason: `existing source=${existingSource} (sacred)`
        })
        continue
      }
      if (existingSource === 'auto') {
        result.skipped_already_present++
        audit.push({
          ...auditBase,
          action: 'skipped_already_present',
          reason: 'auto-row already exists in player_meta_roles'
        })
        continue
      }
      if (!member.discord_user_id) {
        result.skipped_no_discord_user++
        audit.push({
          ...auditBase,
          action: 'skipped_no_discord_user',
          reason: 'no canonically verified Discord identity'
        })
        continue
      }

      const reqSet = requirements.get(mapping.meta_team_id)
      if (!reqSet || reqSet.boss_requirement_sets.length === 0) {
        result.skipped_threshold_not_met++
        audit.push({
          ...auditBase,
          action: 'skipped_threshold_not_met',
          reason: 'no boss_playbook_team_requirements rows for meta_team'
        })
        continue
      }
      if (!roster || roster.heroes.size === 0) {
        result.skipped_threshold_not_met++
        audit.push({
          ...auditBase,
          action: 'skipped_threshold_not_met',
          reason: 'no player_roster rows available for evaluation'
        })
        continue
      }

      let bestPct = 0
      for (const reqList of reqSet.boss_requirement_sets) {
        const score = scoreRosterAgainstPlaybook(roster.heroes, reqList)
        if (score.percentage > bestPct) bestPct = score.percentage
      }

      candidates.push({ mapping, auditBase, bestPct })
    }

    candidates.sort((a, b) => b.bestPct - a.bestPct)

    const aboveFloor = candidates.filter((c) => c.bestPct >= ctx.threshold_pct)
    const belowFloor = candidates.filter((c) => c.bestPct < ctx.threshold_pct)

    for (const c of belowFloor) {
      result.skipped_threshold_not_met++
      audit.push({
        ...c.auditBase,
        action: 'skipped_threshold_not_met',
        reason: `best_pct=${c.bestPct} < threshold=${ctx.threshold_pct} (tier=${ctx.tier})`
      })
    }

    const topN = aboveFloor.slice(0, TOP_N_CAPABILITY)
    const outOfTopN = aboveFloor.slice(TOP_N_CAPABILITY)

    for (const c of outOfTopN) {
      const rank = aboveFloor.indexOf(c) + 1
      result.skipped_threshold_not_met++
      audit.push({
        ...c.auditBase,
        action: 'skipped_threshold_not_met',
        reason: `outside_top${TOP_N_CAPABILITY}_capability rank=${rank} best_pct=${c.bestPct} (tier=${ctx.tier} threshold=${ctx.threshold_pct})`
      })
    }

    for (const [i, c] of topN.entries()) {
      const rank = i + 1
      const tokens = memberEngagement.get(c.mapping.meta_team_slug) ?? 0

      if (tokens < ENGAGEMENT_MIN_TOKENS) {
        result.skipped_threshold_not_met++
        audit.push({
          ...c.auditBase,
          action: 'skipped_threshold_not_met',
          reason: `low_engagement tokens=${tokens} last_${ENGAGEMENT_LOOKBACK_SEASONS}_seasons (required>=${ENGAGEMENT_MIN_TOKENS}); capability_rank=${rank} best_pct=${c.bestPct}`
        })
        continue
      }

      const discordUserId = member.discord_user_id
      if (!discordUserId) continue

      let putFailures = 0
      for (const roleId of c.mapping.discord_role_ids) {
        const discordResult = await addGuildMemberRole(
          ctx.discord_server_id,
          discordUserId,
          roleId,
          { nowMs: options.nowMs }
        )

        if (!discordResult.ok) {
          putFailures++
          result.failed++
          audit.push({
            ...c.auditBase,
            discord_role_id: roleId,
            action: 'failed',
            reason: `discord PUT failed (status=${discordResult.status}); capability_rank=${rank} best_pct=${c.bestPct} engagement=${tokens}`,
            http_status: discordResult.status
          })
          continue
        }

        audit.push({
          ...c.auditBase,
          discord_role_id: roleId,
          action: 'added',
          reason: `qualified capability_rank=${rank} best_pct=${c.bestPct} engagement=${tokens} tokens last_${ENGAGEMENT_LOOKBACK_SEASONS}_seasons (tier=${ctx.tier} threshold=${ctx.threshold_pct})`,
          http_status: discordResult.status
        })
      }

      // Only after every role PUT succeeded, or skipped_already_present blocks the retry.
      if (putFailures > 0) continue

      roleInsertsByMember.push({
        user_id: member.user_id,
        meta_team_id: c.mapping.meta_team_id!,
        source: 'auto',
        set_by: options.triggered_by ?? null
      })

      result.roles_added++
    }
  }

  if (roleInsertsByMember.length > 0) {
    const { error } = await supabase
      .from('player_meta_roles')
      .upsert(roleInsertsByMember as never, {
        onConflict: 'user_id,meta_team_id',
        ignoreDuplicates: true
      })
    if (error) {
      logger.warn(
        { count: roleInsertsByMember.length, error: error.message },
        'role_reconciler.player_meta_roles_insert_failed'
      )
    }
  }

  await writeAuditEvents(supabase, audit)

  result.duration_ms = Date.now() - startMs
  logger.info({ guildCode, ...result }, 'role_reconciler.run_complete')
  return result
}

export const reconcileMemberRoles = async (
  supabase: ServiceSupabaseClient,
  userId: string,
  options: Omit<ReconcileOptions, 'only_user_id'>
): Promise<ReconcileResult[]> => {
  const { data: memberships } = (await supabase
    .from('player_mapping')
    .select('guild_code')
    .eq('user_id', userId)
    .eq('is_current', true)) as {
    data: Array<{ guild_code: string | null }> | null
  }
  const guildCodes = Array.from(
    new Set(
      (memberships ?? [])
        .map((m) => m.guild_code)
        .filter((g): g is string => !!g)
    )
  )
  const results: ReconcileResult[] = []
  for (const guildCode of guildCodes) {
    results.push(
      await reconcileGuildRoles(supabase, guildCode, {
        ...options,
        only_user_id: userId
      })
    )
  }
  return results
}
