import 'server-only'

import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { getRankIndexFromName, RANK_NAMES } from '@/app/lib/tacticus/ranks'
import { deriveStageCodeFromSetAndRarity } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import {
  evaluateStrengthState,
  getStrengthThresholdsForRaritySet,
  type StrengthState
} from '@/app/lib/meta/roster-strength'
import type { RosterHeroInput } from '@/app/lib/meta/roster-input'
import { parseTeamComposition } from '@/app/lib/roster-development/analysis'
import {
  rankInvestmentRecommendations,
  type InvestmentDemand,
  type InvestmentHeroState,
  type InvestmentRecommendation
} from '@/app/lib/boss-assignments/season-planner/roster-strategy-core'
import type {
  MetaAtlasRow,
  ProjectionContext,
  RosterHeroRow,
  RosterStrategyMember,
  SupabaseService
} from './types'

const loadInvestmentDemand = async (
  service: SupabaseService,
  contexts: ProjectionContext[]
): Promise<InvestmentDemand[]> => {
  const bossTypes = Array.from(
    new Set(
      contexts.flatMap((context) =>
        context.seasonBosses
          .map((boss) => boss.boss_type)
          .filter((value): value is string => Boolean(value))
      )
    )
  )
  const raritySets = Array.from(
    new Set(
      contexts.flatMap((context) =>
        context.seasonBosses.map((boss) =>
          deriveStageCodeFromSetAndRarity(boss.set, boss.rarity)
        )
      )
    )
  )

  if (bossTypes.length === 0 || raritySets.length === 0) return []
  const seasons = Array.from(new Set(contexts.map((context) => context.season)))

  const { data, error } = await service
    .from('meta_atlas_data')
    .select(
      'season, team_composition, boss_type, boss_unit_id, rarity_set, damage_p90, attack_count'
    )
    .in('season', seasons)
    .in('boss_type', bossTypes)
    .in('rarity_set', raritySets)
    .gte('attack_count', 20)
    .order('damage_p90', { ascending: false })
    .limit(500)

  if (error)
    throw new Error(`Failed to load Meta Atlas demand: ${error.message}`)

  const demand: InvestmentDemand[] = []
  for (const row of (data ?? []) as MetaAtlasRow[]) {
    if (!row.team_composition || !row.damage_p90) continue
    const parsed = parseTeamComposition(row.team_composition)
    const units = parsed.mow ? [...parsed.heroes, parsed.mow] : parsed.heroes
    const bossName = getBossDisplayName(row.boss_unit_id || row.boss_type || '')
    for (const unit of units) {
      if (!unit) continue
      demand.push({
        heroName: unit,
        unitId: null,
        bossName,
        raritySet: row.rarity_set ?? null,
        damageP90: Math.round(row.damage_p90),
        attackCount: Math.round(row.attack_count ?? 0)
      })
    }
  }

  return demand
}

const loadRosterHeroStates = async (
  service: SupabaseService,
  members: RosterStrategyMember[]
): Promise<Map<string, InvestmentHeroState[]>> => {
  const mappingIds = members.map((member) => member.mappingId)
  if (mappingIds.length === 0) return new Map()

  const { data, error } = await service
    .from('player_roster')
    .select(
      'player_mapping_id, user_id, rank_name, stars, progression_index, active_ability_level, passive_ability_level, hero_mappings(unit_id, display_name, category)'
    )
    .in('player_mapping_id', mappingIds)

  if (error) throw new Error(`Failed to load player rosters: ${error.message}`)

  const byMappingId = new Map<string, InvestmentHeroState[]>()
  for (const row of (data ?? []) as RosterHeroRow[]) {
    const mappingId =
      typeof row.player_mapping_id === 'number'
        ? String(row.player_mapping_id)
        : null
    if (!mappingId) continue
    const hero = Array.isArray(row.hero_mappings)
      ? row.hero_mappings[0]
      : row.hero_mappings
    const heroName = hero?.display_name ?? hero?.unit_id ?? null
    if (!heroName) continue
    const list = byMappingId.get(mappingId) ?? []
    list.push({
      heroName,
      unitId: hero?.unit_id ?? null,
      category: hero?.category ?? null,
      rankName: row.rank_name ?? null,
      rankIndex: getRankIndexFromName(row.rank_name),
      activeAbility: row.active_ability_level ?? null,
      passiveAbility: row.passive_ability_level ?? null,
      progressionIndex: row.progression_index ?? null,
      stars: row.stars ?? null
    })
    byMappingId.set(mappingId, list)
  }

  return byMappingId
}

export const stateForHeroDemand = (
  hero: InvestmentHeroState,
  demand: InvestmentDemand
): StrengthState | null => {
  const thresholds = getStrengthThresholdsForRaritySet(demand.raritySet)
  const input: RosterHeroInput = {
    id: hero.unitId,
    name: hero.heroName,
    category: hero.category,
    rank: hero.rankIndex,
    progressionIndex: hero.progressionIndex,
    stars: hero.stars,
    abilities: [
      { id: 'active', level: hero.activeAbility },
      { id: 'passive', level: hero.passiveAbility }
    ]
  }
  return evaluateStrengthState(input, thresholds)
}

export const describeInvestmentStep = (
  hero: InvestmentHeroState,
  state: StrengthState | 'Unknown',
  demand: InvestmentDemand
): string => {
  const category = hero.category?.toLowerCase() ?? ''
  const isMow = category === 'mow' || category.includes('machine')
  const thresholds = getStrengthThresholdsForRaritySet(demand.raritySet)
  const rankTargets = thresholds.rankThresholds
  const abilityTargets = thresholds.abilityMinimums
  const targetRank =
    state === 'Weak'
      ? rankTargets?.suitable
      : state === 'Suitable'
        ? rankTargets?.strong
        : rankTargets?.optimal
  const targetAbility =
    state === 'Weak'
      ? abilityTargets?.suitable
      : state === 'Suitable'
        ? abilityTargets?.strong
        : abilityTargets?.optimal

  if (isMow) {
    if (
      targetAbility != null &&
      ((hero.activeAbility ?? 0) < targetAbility ||
        (hero.passiveAbility ?? hero.activeAbility ?? 0) < targetAbility)
    ) {
      return `Raise ${hero.heroName} abilities toward ${targetAbility} for ${demand.raritySet ?? 'this season'} teams.`
    }

    if (state === 'Strong') {
      return `Push ${hero.heroName} toward optimal ability levels for ${demand.raritySet ?? 'season'} teams.`
    }

    return `Improve ${hero.heroName} ability levels for ${demand.bossName} coverage.`
  }

  if (
    targetRank != null &&
    (hero.rankIndex == null || hero.rankIndex < targetRank)
  ) {
    return `Raise ${hero.heroName} to ${RANK_NAMES[targetRank] ?? `rank ${targetRank}`} for ${demand.raritySet ?? 'this season'} teams.`
  }

  if (
    targetAbility != null &&
    ((hero.activeAbility ?? 0) < targetAbility ||
      (hero.passiveAbility ?? 0) < targetAbility)
  ) {
    return `Raise active/passive abilities toward ${targetAbility} for ${demand.raritySet ?? 'this season'} teams.`
  }

  if (state === 'Strong') {
    return `Push ${hero.heroName} toward the optimal ${demand.raritySet ?? 'season'} floor.`
  }

  return `Improve ${hero.heroName} for ${demand.bossName} coverage.`
}

export const buildInvestments = async (args: {
  service: SupabaseService
  contexts: ProjectionContext[]
  members: RosterStrategyMember[]
  limitPerMember: number
}): Promise<InvestmentRecommendation[]> => {
  const [demand, heroStatesByMapping] = await Promise.all([
    loadInvestmentDemand(args.service, args.contexts),
    loadRosterHeroStates(args.service, args.members)
  ])

  if (demand.length === 0) return []

  return args.members.flatMap((member) => {
    const heroStates = heroStatesByMapping.get(String(member.mappingId)) ?? []
    return rankInvestmentRecommendations({
      playerId: member.playerId,
      displayName: member.displayName,
      heroStates,
      demand,
      resolveState: stateForHeroDemand,
      describeNextStep: describeInvestmentStep,
      limit: args.limitPerMember
    })
  })
}
