import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { getPlayerApiKey } from '@tacticus/app-core/api-key-helper'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.roster-development.member-gaps')
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { isOfficerLeaderOrAdminRole } from '@/app/lib/auth/role-predicates'
import {
  fetchPlaybookRequirements,
  scoreRosterAgainstPlaybook,
  fetchGlobalThresholds,
  type GlobalThreshold,
  type RosterStrengthScore
} from '@/app/lib/services/strength-precedence'
import type { HeroRequirement } from '@/app/lib/meta/roster-strength'
import { parseTeamComposition } from '@/app/lib/roster-development/analysis'
import { getBossPerformance } from '@/app/lib/data/boss-performance'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import {
  guildRosterQuery,
  type GuildRosterApiKeyRow
} from '@/app/lib/data/guild-roster'

export const dynamic = 'force-dynamic'

const DEFAULT_TIERS = {
  optimal: 100,
  strong: 80,
  suitable: 60
}

const DEFAULT_RARITY_SETS = ['M1', 'L5']
const MAIN_ENCOUNTER_FILTER = 'encounter_index.is.null,encounter_index.eq.0'
const MIN_META_ATTACK_COUNT = 30
// Runaway guard on sequential live lookups (guilds cap at 30 members).
const MAX_MEMBER_GAP_LIVE_LOOKUPS = 40
const FALLBACK_SEASON = '83'

type PrimarySource = 'playbook' | 'global_thresholds'

type ScoreStatus = 'optimal' | 'strong' | 'suitable' | 'weak'

type MemberStatus = ScoreStatus | 'no-roster' | 'no-requirements'

type ScoreSource =
  | 'playbook_guild'
  | 'playbook_cluster'
  | 'playbook_global'
  | 'global_thresholds'

interface TargetScore {
  target_id: string
  target_name: string
  score: number
  status: ScoreStatus
  coach_highlight: boolean
  source: ScoreSource
  details: RosterStrengthScore | null
}

interface MemberGapData {
  player_id: string
  display_name: string
  has_roster: boolean
  has_api_key: boolean
  roster_count: number
  overall_score: number | null
  performance_vs_guild_avg: number | null
  status: MemberStatus
  target_scores: TargetScore[]
}

interface MemberGapsResponse {
  guild_code: string
  season: string
  members: MemberGapData[]
  targets_analyzed: Array<{ target_id: string; target_name: string }>
  targets_label: string
  coach_mode: boolean
  active_source: PrimarySource | null
}

type ScoringTarget = {
  id: string
  name: string
  source: ScoreSource
  hero_requirements?: HeroRequirement[]
  hero_names?: string[]
}

const DEFAULT_SOURCE_ORDER: PrimarySource[] = ['playbook', 'global_thresholds']

const isPrimarySource = (value: unknown): value is PrimarySource =>
  value === 'playbook' || value === 'global_thresholds'

const rankRaritySet = (value: string) => {
  const match = value.match(/^([LM])(\d+)$/i)
  if (!match) return -1
  const prefix = match[1]?.toUpperCase()
  const setNumber = Number.parseInt(match[2] ?? '', 10)
  if (!prefix || !Number.isFinite(setNumber)) return -1
  return (prefix === 'M' ? 100 : 0) + setNumber
}

const resolveRarityFromRaritySet = (raritySet: string | null) => {
  if (!raritySet) return null
  const prefix = raritySet.trim().toUpperCase().charAt(0)
  if (prefix === 'M') return 'Mythic'
  if (prefix === 'L') return 'Legendary'
  return null
}

const parseTierValue = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

const resolveTierConfig = (
  row?: {
    tier_optimal_pct?: number | null
    tier_strong_pct?: number | null
    tier_suitable_pct?: number | null
  } | null
) => {
  const optimal = parseTierValue(row?.tier_optimal_pct, DEFAULT_TIERS.optimal)
  const strong = parseTierValue(row?.tier_strong_pct, DEFAULT_TIERS.strong)
  const suitable = parseTierValue(
    row?.tier_suitable_pct,
    DEFAULT_TIERS.suitable
  )

  return {
    optimal: Math.max(optimal, strong, suitable),
    strong: Math.min(Math.max(strong, suitable), optimal),
    suitable: Math.min(suitable, strong, optimal)
  }
}

const buildSourceOrder = (primary: PrimarySource) => [
  primary,
  ...DEFAULT_SOURCE_ORDER.filter((source) => source !== primary)
]

const resolveStatus = (
  score: number,
  tiers: { optimal: number; strong: number; suitable: number }
): ScoreStatus => {
  if (score >= tiers.optimal) return 'optimal'
  if (score >= tiers.strong) return 'strong'
  if (score >= tiers.suitable) return 'suitable'
  return 'weak'
}

const resolveCoachHighlight = (
  score: number,
  tiers: { optimal: number; strong: number },
  coachMode: boolean
) => coachMode && score < tiers.optimal && score >= tiers.strong

const fetchAvailableRaritySets = async (supabase: TypedSupabaseClient) => {
  const { data, error } = (await supabase.rpc(
    'get_meta_atlas_distinct_rarity_sets'
  )) as unknown as {
    data: Array<{ rarity_set?: string | null }> | null
    error: unknown
  }

  if (!error && Array.isArray(data)) {
    const sorted = data
      .map((row) => row.rarity_set ?? null)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => rankRaritySet(b) - rankRaritySet(a))
    if (sorted.length > 0) {
      return sorted
    }
  }

  return DEFAULT_RARITY_SETS
}

const resolveScoringConfig = async (
  supabase: TypedSupabaseClient,
  guildCode: string
) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAny = supabase as any
  const { data: configRow, error } = await supabaseAny
    .from('guild_roster_scoring_config')
    .select(
      'primary_source, strength_target_rarity_set, tier_optimal_pct, tier_strong_pct, tier_suitable_pct'
    )
    .eq('guild_code', guildCode)
    .maybeSingle()

  if (error) {
    logger.warn({ error, guildCode }, 'Failed to load roster scoring config')
  }

  const availableRaritySets = await fetchAvailableRaritySets(supabase)
  const defaultRaritySet = availableRaritySets[0] ?? null
  const tiers = resolveTierConfig(configRow ?? null)

  const primarySource = isPrimarySource(configRow?.primary_source)
    ? configRow?.primary_source
    : 'playbook'

  const strengthTarget =
    configRow?.strength_target_rarity_set &&
    availableRaritySets.includes(configRow.strength_target_rarity_set)
      ? configRow.strength_target_rarity_set
      : defaultRaritySet

  return {
    config: {
      primary_source: primarySource,
      strength_target_rarity_set: strengthTarget,
      tiers
    },
    defaultRaritySet
  }
}

const evaluateHeroAgainstThresholdWithReason = (
  heroRank: number | null,
  heroActiveAbility: number | null,
  heroPassiveAbility: number | null,
  threshold: GlobalThreshold
) => {
  if (heroRank == null) return { passes: false, reason: 'Missing rank data' }
  if (heroRank < threshold.min_rank_index) {
    return { passes: false, reason: `Below ${threshold.min_rank}` }
  }

  if (threshold.min_ability_active != null) {
    if (heroActiveAbility == null)
      return { passes: false, reason: 'Missing active ability data' }
    if (heroActiveAbility < threshold.min_ability_active) {
      return {
        passes: false,
        reason: `Active < ${threshold.min_ability_active}`
      }
    }
  }

  if (threshold.min_ability_passive != null) {
    if (heroPassiveAbility == null)
      return { passes: false, reason: 'Missing passive ability data' }
    if (heroPassiveAbility < threshold.min_ability_passive) {
      return {
        passes: false,
        reason: `Passive < ${threshold.min_ability_passive}`
      }
    }
  }

  return { passes: true }
}

const scoreRosterAgainstThresholds = (
  roster: Map<
    string,
    {
      rank: number | null
      activeAbility: number | null
      passiveAbility: number | null
    }
  >,
  heroNames: string[],
  thresholds: GlobalThreshold[]
): RosterStrengthScore => {
  const strongThreshold =
    thresholds.find((t) => t.strength_level === 'Strong') ||
    thresholds.find((t) => t.strength_level === 'Suitable') ||
    thresholds[0] ||
    null

  const details: RosterStrengthScore['details'] = []
  let passing = 0
  let failing = 0
  let missing = 0

  for (const heroName of heroNames) {
    const heroData = roster.get(heroName.toLowerCase())

    if (!heroData) {
      missing++
      details.push({ heroName, passes: false, reason: 'Hero not in roster' })
      continue
    }

    if (!strongThreshold) {
      failing++
      details.push({ heroName, passes: false, reason: 'No global threshold' })
      continue
    }

    const result = evaluateHeroAgainstThresholdWithReason(
      heroData.rank,
      heroData.activeAbility,
      heroData.passiveAbility,
      strongThreshold
    )

    if (result.passes) {
      passing++
    } else {
      failing++
    }

    details.push({ heroName, passes: result.passes, reason: result.reason })
  }

  const total = heroNames.length
  const score = passing
  const maxScore = total
  const percentage = total > 0 ? Math.round((passing / total) * 100) : 0

  return { score, maxScore, percentage, passing, failing, missing, details }
}

const fetchPlaybookTargets = async (
  supabase: TypedSupabaseClient,
  guildCode: string,
  clusterCode: string | null
) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAny = supabase as any
  const orClauses = [`guild_code.eq.${guildCode}`]
  if (clusterCode) {
    orClauses.push(`and(guild_code.is.null,cluster_code.eq.${clusterCode})`)
  }
  orClauses.push('and(guild_code.is.null,cluster_code.is.null)')

  const { data: bossRows, error } = await supabaseAny
    .from('boss_playbook_team_requirements')
    .select('boss_id')
    .or(orClauses.join(','))

  if (error || !bossRows) {
    logger.warn({ error }, 'Failed to load playbook boss list')
    return [] as ScoringTarget[]
  }

  const bossRowsTyped = bossRows as Array<{ boss_id: string | null }>
  const bossIds = Array.from(
    new Set(
      bossRowsTyped
        .map((row) => row.boss_id)
        .filter((id): id is string => Boolean(id))
    )
  )
  if (bossIds.length === 0) return []

  const { data: bossNames } = await supabaseAny
    .from('boss_encounter_config')
    .select('boss_id, display_name')
    .in('boss_id', bossIds)

  const bossNameMap = new Map<string, string>()
  ;(
    (bossNames as Array<{ boss_id: string; display_name: string }>) || []
  ).forEach((row) => bossNameMap.set(row.boss_id, row.display_name))

  const targets: ScoringTarget[] = []

  for (const bossId of bossIds) {
    const requirement = await fetchPlaybookRequirements(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      bossId,
      null,
      guildCode,
      clusterCode
    )

    if (
      !requirement?.hero_requirements ||
      requirement.hero_requirements.length === 0
    ) {
      continue
    }

    const source: ScoreSource =
      requirement.tier === 'guild'
        ? 'playbook_guild'
        : requirement.tier === 'cluster'
          ? 'playbook_cluster'
          : 'playbook_global'

    targets.push({
      id: bossId,
      name: bossNameMap.get(bossId) || bossId,
      source,
      hero_requirements: requirement.hero_requirements
    })
  }

  return targets
}

const fetchGlobalThresholdTargets = async (
  supabase: TypedSupabaseClient,
  raritySet: string | null,
  season: string
) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAny = supabase as any
  const rarity = resolveRarityFromRaritySet(raritySet)
  if (!rarity) {
    return {
      targets: [] as ScoringTarget[],
      thresholds: [] as GlobalThreshold[]
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const thresholds = await fetchGlobalThresholds(supabase as any, rarity)
  if (thresholds.length === 0) {
    return { targets: [] as ScoringTarget[], thresholds }
  }

  const { data: metaRows, error } = await supabaseAny
    .from('meta_atlas_data')
    .select('boss_type, team_composition, damage_p90, attack_count')
    .eq('rarity_set', raritySet)
    .eq('season', season)
    .or(MAIN_ENCOUNTER_FILTER)
    .not('team_composition', 'is', null)
    .gte('attack_count', MIN_META_ATTACK_COUNT)
    .order('damage_p90', { ascending: false })

  if (error || !metaRows || metaRows.length === 0) {
    logger.warn(
      { error, raritySet, season },
      'Global threshold targets unavailable'
    )
    return { targets: [] as ScoringTarget[], thresholds }
  }

  const bossMap = new Map<string, { team_composition: string }>()
  for (const row of metaRows as Array<{
    boss_type: string
    team_composition: string | null
  }>) {
    if (!row.boss_type || !row.team_composition) continue
    if (!bossMap.has(row.boss_type)) {
      bossMap.set(row.boss_type, { team_composition: row.team_composition })
    }
  }

  const bossTypes = Array.from(bossMap.keys())
  const { data: bossNames } = await supabaseAny
    .from('boss_mapping')
    .select('boss_type, boss_name')
    .in('boss_type', bossTypes)
    .eq('encounter_index', 0)

  const bossNameMap = new Map<string, string>()
  ;(
    (bossNames as Array<{ boss_type: string; boss_name: string }>) || []
  ).forEach((row) => bossNameMap.set(row.boss_type, row.boss_name))

  const targets: ScoringTarget[] = []
  for (const [bossType, info] of bossMap.entries()) {
    const parsed = parseTeamComposition(info.team_composition || '')
    if (parsed.units.length === 0) continue
    targets.push({
      id: bossType,
      name: bossNameMap.get(bossType) || bossType,
      source: 'global_thresholds',
      hero_names: parsed.units
    })
  }

  return { targets, thresholds }
}

const buildPerformanceMap = (
  data: Record<string, Array<{ player_vs_guild_avg: number }>> | null
) => {
  const normalized = new Map<string, Array<{ player_vs_guild_avg: number }>>()
  Object.entries(data || {}).forEach(([name, entries]) => {
    const key = name.trim().toLowerCase()
    if (!key) return
    normalized.set(key, entries)
  })
  return normalized
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const supabase = await db()
    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, { error: 'Authentication required' })
    )

    const access = await checkFeatureAccess(user.id, 'roster_development')
    if (!access.has_access) {
      throw Errors.fromResponse(403, {
        error: 'Roster development access required'
      })
    }

    const { data: profile, error: profileError } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('guild_code, cluster_code, role')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .single()

    if (profileError || !profile?.guild_code) {
      throw Errors.fromResponse(403, {
        error: 'Profile not found or access denied'
      })
    }

    if (!isOfficerLeaderOrAdminRole(profile.role)) {
      throw Errors.fromResponse(403, { error: 'Insufficient permissions' })
    }

    const searchParams = request.nextUrl.searchParams
    const coachMode = searchParams.get('coach_mode') === 'true'
    const requestedSeason = searchParams.get('season')

    const serviceClient = serviceDb()

    const { data: seasonData } = requestedSeason
      ? { data: requestedSeason }
      : await serviceClient.rpc('get_latest_season')
    const season = seasonData || requestedSeason || FALLBACK_SEASON

    const { config: scoringConfig } = await resolveScoringConfig(
      serviceClient,
      profile.guild_code
    )

    const sourceOrder = buildSourceOrder(scoringConfig.primary_source)

    let targets: ScoringTarget[] = []
    let activeSource: PrimarySource | null = null
    let targetsLabel = 'Targets'
    let globalThresholds: GlobalThreshold[] = []

    for (const source of sourceOrder) {
      if (source === 'playbook') {
        const playbookTargets = await fetchPlaybookTargets(
          serviceClient,
          profile.guild_code,
          profile.cluster_code ?? null
        )
        if (playbookTargets.length > 0) {
          targets = playbookTargets
          activeSource = source
          targetsLabel = 'Boss Targets'
          break
        }
      }

      if (source === 'global_thresholds') {
        const globalTargets = await fetchGlobalThresholdTargets(
          serviceClient,
          scoringConfig.strength_target_rarity_set ?? null,
          season
        )
        if (
          globalTargets.targets.length > 0 &&
          globalTargets.thresholds.length > 0
        ) {
          targets = globalTargets.targets
          globalThresholds = globalTargets.thresholds
          activeSource = source
          targetsLabel = 'Boss Targets'
          break
        }
      }
    }

    const { data: members, error: membersError } =
      await guildRosterQuery<GuildRosterApiKeyRow>(
        serviceClient,
        profile.guild_code,
        'player_id, display_name, tacticus_api_key_encrypted, api_key_is_valid'
      ).order('display_name')

    if (membersError || !members) {
      logger.error(
        { error: membersError },
        'Member gaps: failed to load guild members'
      )
      throw Errors.fromResponse(500, { error: 'Failed to load guild members' })
    }

    let performanceMap = new Map<
      string,
      Array<{ player_vs_guild_avg: number }>
    >()
    try {
      const performanceData = await getBossPerformance(
        profile.guild_code,
        season
      )
      performanceMap = buildPerformanceMap(performanceData)
    } catch (error) {
      logger.warn({ error }, 'Member gaps: boss performance unavailable')
    }

    const memberGaps: MemberGapData[] = []
    let liveLookupsUsed = 0
    let liveLookupCapLogged = false

    for (const member of members) {
      const hasApiKey = !!(
        member.tacticus_api_key_encrypted && member.api_key_is_valid !== false
      )

      const roster = new Map<
        string,
        {
          rank: number | null
          activeAbility: number | null
          passiveAbility: number | null
        }
      >()
      let hasRoster = false
      let rosterCount = 0

      const underLiveLookupCap = liveLookupsUsed < MAX_MEMBER_GAP_LIVE_LOOKUPS
      if (hasApiKey && !underLiveLookupCap && !liveLookupCapLogged) {
        liveLookupCapLogged = true
        logger.warn(
          { members: members.length, cap: MAX_MEMBER_GAP_LIVE_LOOKUPS },
          'Member gaps: live roster lookups truncated to per-request cap'
        )
      }

      if (hasApiKey && underLiveLookupCap) {
        try {
          liveLookupsUsed += 1
          const apiKey = await getPlayerApiKey(member)
          if (apiKey) {
            const player = await tacticusAPI.getPlayer(apiKey)
            if (player?.units) {
              hasRoster = true
              rosterCount = player.units.length
              for (const unit of player.units) {
                const name = (unit.name || unit.id || '').toLowerCase()
                if (name) {
                  const activeAbility =
                    unit.abilities?.find((a) => a.id === 'active')?.level ??
                    null
                  const passiveAbility =
                    unit.abilities?.find((a) => a.id === 'passive')?.level ??
                    null
                  roster.set(name, {
                    rank: unit.rank ?? null,
                    activeAbility,
                    passiveAbility
                  })
                }
              }
            }
          }
        } catch (err) {
          logger.warn(
            { playerId: member.player_id, error: err },
            'Failed to fetch member roster'
          )
        }
      }

      const performanceEntries = member.display_name
        ? performanceMap.get(member.display_name.trim().toLowerCase())
        : undefined
      const performanceAvg =
        performanceEntries && performanceEntries.length > 0
          ? Math.round(
              performanceEntries.reduce(
                (sum, entry) => sum + entry.player_vs_guild_avg,
                0
              ) / performanceEntries.length
            )
          : null

      if (targets.length === 0) {
        memberGaps.push({
          player_id: member.player_id,
          display_name: member.display_name || 'Unknown',
          has_roster: hasRoster,
          has_api_key: hasApiKey,
          roster_count: rosterCount,
          overall_score: null,
          performance_vs_guild_avg: performanceAvg,
          status: 'no-requirements',
          target_scores: []
        })
        continue
      }

      if (!hasRoster) {
        memberGaps.push({
          player_id: member.player_id,
          display_name: member.display_name || 'Unknown',
          has_roster: false,
          has_api_key: hasApiKey,
          roster_count: 0,
          overall_score: null,
          performance_vs_guild_avg: performanceAvg,
          status: 'no-roster',
          target_scores: []
        })
        continue
      }

      const targetScores: TargetScore[] = []
      let totalScore = 0
      let scoreCount = 0

      for (const target of targets) {
        let score: RosterStrengthScore | null = null

        if (target.hero_requirements) {
          score = scoreRosterAgainstPlaybook(roster, target.hero_requirements)
        } else if (target.hero_names) {
          score = scoreRosterAgainstThresholds(
            roster,
            target.hero_names,
            globalThresholds
          )
        }

        if (!score) {
          continue
        }

        const status = resolveStatus(score.percentage, scoringConfig.tiers)
        const coachHighlight = resolveCoachHighlight(
          score.percentage,
          scoringConfig.tiers,
          coachMode
        )

        targetScores.push({
          target_id: target.id,
          target_name: target.name,
          score: score.percentage,
          status,
          coach_highlight: coachHighlight,
          source: target.source,
          details: score
        })

        totalScore += score.percentage
        scoreCount++
      }

      const overallScore =
        scoreCount > 0 ? Math.round(totalScore / scoreCount) : null
      const overallStatus =
        overallScore === null
          ? 'no-requirements'
          : resolveStatus(overallScore, scoringConfig.tiers)

      memberGaps.push({
        player_id: member.player_id,
        display_name: member.display_name || 'Unknown',
        has_roster: hasRoster,
        has_api_key: hasApiKey,
        roster_count: rosterCount,
        overall_score: overallScore,
        performance_vs_guild_avg: performanceAvg,
        status: overallStatus,
        target_scores: targetScores
      })
    }

    memberGaps.sort((a, b) => {
      if (a.status === 'no-roster' && b.status !== 'no-roster') return 1
      if (a.status !== 'no-roster' && b.status === 'no-roster') return -1
      if (a.overall_score === null && b.overall_score !== null) return 1
      if (a.overall_score !== null && b.overall_score === null) return -1
      if (a.overall_score !== null && b.overall_score !== null) {
        return a.overall_score - b.overall_score
      }
      return (a.display_name || '').localeCompare(b.display_name || '')
    })

    const response: MemberGapsResponse = {
      guild_code: profile.guild_code,
      season,
      members: memberGaps,
      targets_analyzed: targets.map((target) => ({
        target_id: target.id,
        target_name: target.name
      })),
      targets_label: targetsLabel,
      coach_mode: coachMode,
      active_source: activeSource
    }

    return NextResponse.json(response)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Member gap analysis error')
    throw Errors.fromResponse(500, {
      error: 'Failed to generate member gap analysis'
    })
  }
})
