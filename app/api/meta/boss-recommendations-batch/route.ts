import { NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import {
  resolveDagProgression,
  type DagProgressionResult
} from '@/app/lib/meta/dag-progression'
import {
  parseRosterPayload,
  type RosterInputEntry
} from '@/app/lib/meta/roster-input'
import { normalizeCurrentTeams } from '@/app/lib/meta/current-team-input'
import { requireFeatureAccess } from '@/app/lib/services/feature-access-gate'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.boss-recommendations-batch')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'

export interface BossRecommendation {
  team_hash: string
  team_composition: string
  meta_team: string | null
  rarity_set: string | null
  sub_boss_name: string | null
  encounter_index: number
  damage_p90: number
  damage_p75: number
  damage_max: number
  damage_avg: number
  attack_count: number
  season: string
  boss_type: string
}

interface BossDataResult {
  boss_type: string
  boss_name: string
  recommendations: BossRecommendation[]
  error: string | null
  progressions?: Record<string, DagProgressionResult>
  current_team?: DagProgressionResult['current_team']
  target_team?: DagProgressionResult['target_team']
  current_team_info?: DagProgressionResult['current_team_info']
  target_team_info?: DagProgressionResult['target_team_info']
  best_buildable_team?: DagProgressionResult['best_buildable_team']
  best_buildable_info?: DagProgressionResult['best_buildable_info']
  best_buildable_is_suitable?: DagProgressionResult['best_buildable_is_suitable']
  is_optimal?: DagProgressionResult['is_optimal']
  is_optimal_from_history?: DagProgressionResult['is_optimal_from_history']
  is_optimal_from_roster?: DagProgressionResult['is_optimal_from_roster']
  history_equals_roster?: DagProgressionResult['history_equals_roster']
  optimal_message?: DagProgressionResult['optimal_message']
  upgrade_path?: DagProgressionResult['upgrade_path']
  upgrade_path_from_history?: DagProgressionResult['upgrade_path_from_history']
  upgrade_path_from_roster?: DagProgressionResult['upgrade_path_from_roster']
  upgrade_paths?: DagProgressionResult['upgrade_paths']
  progression_path?: DagProgressionResult['progression_path']
  total_damage_increase?: DagProgressionResult['total_damage_increase']
  total_damage_increase_from_history?: DagProgressionResult['total_damage_increase_from_history']
  total_damage_increase_from_roster?: DagProgressionResult['total_damage_increase_from_roster']
  final_team?: DagProgressionResult['final_team']
  meta_team_progressions?: DagProgressionResult['meta_team_progressions']
  progression_message?: string
  progression_error?: string
}

export const POST = withErrorHandler(async (request: Request) => {
  try {
    const authSupabase = await db()
    const user = await requireSessionUser(authSupabase, () =>
      Errors.fromResponse(401, { error: 'Authentication required' })
    )

    await requireFeatureAccess(
      user.id,
      'meta_atlas',
      'Meta Atlas feature access required'
    )

    const body = await request.json()
    const {
      boss_types,
      season,
      min_attacks = 20,
      limit = 20,
      roster,
      current_teams
    } = body as {
      boss_types: string[]
      season?: string
      min_attacks?: number
      limit?: number
      roster?: RosterInputEntry[]
      current_teams?: unknown
    }

    if (!boss_types || !Array.isArray(boss_types) || boss_types.length === 0) {
      throw Errors.fromResponse(400, { error: 'boss_types array is required' })
    }

    if (boss_types.length > 50) {
      throw Errors.fromResponse(400, {
        error: 'Maximum 50 boss types per request'
      })
    }

    const { roster: rosterList, error: rosterError } =
      parseRosterPayload(roster)
    if (rosterError) {
      throw Errors.fromResponse(400, { error: rosterError })
    }

    const currentTeamsLookup = normalizeCurrentTeams(current_teams)

    const supabase = serviceDb()

    let query = supabase
      .from('meta_atlas_data')
      .select(
        'team_hash, team_composition, meta_team, rarity_set, sub_boss_name, boss_type, encounter_index, damage_p90, damage_p75, damage_max, damage_avg, attack_count, season'
      )
      .in('boss_type', boss_types)
      .gte('attack_count', min_attacks)

    if (season) {
      query = query.eq('season', season)
    }

    const { data: rawData, error } = await query
      .order('boss_type')
      .order('rarity_set')
      .order('damage_p90', { ascending: false })

    type MetaAtlasRow = {
      team_hash: string
      team_composition: string | null
      meta_team: string | null
      rarity_set: string | null
      sub_boss_name: string
      boss_type: string
      encounter_index: number
      damage_p90: number | null
      damage_p75: number | null
      damage_max: number | null
      damage_avg: number | null
      attack_count: number | null
      season: string
    }
    const data = rawData as unknown as MetaAtlasRow[] | null

    if (error) {
      logger.error({ error }, 'Batch boss recommendations error')
      throw Errors.fromResponse(500, {
        error: 'Failed to fetch recommendations'
      })
    }

    const { data: bossMappings } = await supabase
      .from('boss_mapping')
      .select('boss_type, boss_name, encounter_index')
      .in('boss_type', boss_types)

    const bossNameMap = new Map<string, Map<number, string>>()
    for (const mapping of bossMappings || []) {
      if (!bossNameMap.has(mapping.boss_type)) {
        bossNameMap.set(mapping.boss_type, new Map())
      }
      bossNameMap
        .get(mapping.boss_type)!
        .set(mapping.encounter_index, mapping.boss_name)
    }

    const resultsByBoss = new Map<string, BossDataResult>()

    for (const bossType of boss_types) {
      const bossNames = bossNameMap.get(bossType)
      const displayName = bossNames?.get(0) || getBossDisplayName(bossType)
      resultsByBoss.set(bossType, {
        boss_type: bossType,
        boss_name: displayName,
        recommendations: [],
        error: null
      })
    }

    const teamCountsByBossRarity = new Map<string, number>()

    for (const row of data || []) {
      const result = resultsByBoss.get(row.boss_type)
      if (!result) continue

      const encounterIndex = row.encounter_index ?? 0

      const countKey = `${row.boss_type}|${row.rarity_set}|${encounterIndex}`
      const currentCount = teamCountsByBossRarity.get(countKey) || 0

      if (currentCount >= limit) continue

      teamCountsByBossRarity.set(countKey, currentCount + 1)

      result.recommendations.push({
        team_hash: row.team_hash,
        team_composition: row.team_composition ?? '',
        meta_team: row.meta_team,
        rarity_set: row.rarity_set,
        sub_boss_name: row.sub_boss_name,
        encounter_index: encounterIndex,
        damage_p90: row.damage_p90 ?? 0,
        damage_p75: row.damage_p75 ?? 0,
        damage_max: row.damage_max ?? 0,
        damage_avg: row.damage_avg ?? 0,
        attack_count: row.attack_count ?? 0,
        season: row.season,
        boss_type: row.boss_type
      })
    }

    const hasRoster = Array.isArray(rosterList) && rosterList.length > 0
    const hasCurrentTeams = currentTeamsLookup.size > 0

    if (hasCurrentTeams || hasRoster) {
      for (const countKey of teamCountsByBossRarity.keys()) {
        const [bossType, raritySet, encounterIndexRaw] = countKey.split('|')
        if (!bossType || !raritySet || !encounterIndexRaw) continue
        const encounterIndex = Number(encounterIndexRaw)
        if (!Number.isFinite(encounterIndex)) continue
        const result = resultsByBoss.get(bossType)
        if (!result) continue

        const currentTeam = currentTeamsLookup.get(bossType)
        const hasMatchingHistory =
          currentTeam &&
          currentTeam.current_team &&
          currentTeam.rarity_set === raritySet &&
          (currentTeam.encounter_index ?? 0) === encounterIndex

        if (!hasMatchingHistory && !hasRoster) continue

        const progression = await resolveDagProgression(
          supabase,
          {
            bossType,
            encounterIndex,
            raritySet,
            season: currentTeam?.season ?? season ?? null,
            currentTeam: hasMatchingHistory
              ? (currentTeam.current_team ?? null)
              : null,
            currentTeamHash: hasMatchingHistory
              ? (currentTeam.current_team_hash ?? null)
              : null,
            roster: rosterList,
            minAttacks: min_attacks
          },
          { requireCurrentTeam: false }
        )

        if ('error' in progression) {
          result.progression_error = progression.error
          continue
        }

        if (!result.progressions) {
          result.progressions = {}
        }
        result.progressions[`${raritySet}|${encounterIndex}`] = progression

        if (!result.current_team && !result.best_buildable_team) {
          result.current_team = progression.current_team
          result.current_team_info = progression.current_team_info
          result.target_team = progression.target_team
          result.target_team_info = progression.target_team_info
          result.best_buildable_team = progression.best_buildable_team
          result.best_buildable_info = progression.best_buildable_info
          result.best_buildable_is_suitable =
            progression.best_buildable_is_suitable
          result.is_optimal = progression.is_optimal
          result.is_optimal_from_history = progression.is_optimal_from_history
          result.is_optimal_from_roster = progression.is_optimal_from_roster
          result.history_equals_roster = progression.history_equals_roster
          result.optimal_message = progression.optimal_message
          result.upgrade_path = progression.upgrade_path
          result.upgrade_path_from_history =
            progression.upgrade_path_from_history
          result.upgrade_path_from_roster = progression.upgrade_path_from_roster
          result.upgrade_paths = progression.upgrade_paths
          result.progression_path = progression.progression_path
          result.total_damage_increase = progression.total_damage_increase
          result.total_damage_increase_from_history =
            progression.total_damage_increase_from_history
          result.total_damage_increase_from_roster =
            progression.total_damage_increase_from_roster
          result.final_team = progression.final_team
          result.meta_team_progressions = progression.meta_team_progressions
          if (progression.message) {
            result.progression_message = progression.message
          }
        }
      }
    }

    return NextResponse.json({
      results: Object.fromEntries(resultsByBoss),
      filters: {
        boss_types,
        season,
        min_attacks,
        limit
      },
      count: resultsByBoss.size
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Batch boss recommendations error')
    throw Errors.fromResponse(500, { error: 'Failed to fetch recommendations' })
  }
})
