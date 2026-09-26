import { parseTeamComposition } from '@/app/lib/meta/team-coverage'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

export interface MetaAtlasTeam {
  boss_type: string
  team_composition: string | null
  damage_p90: number | null
  damage_avg: number | null
  attack_count: number | null
  rarity?: string | null
  rarity_set?: string | null
}

export interface RosterGap {
  hero_name: string
  appears_in_meta_teams: number
  damage_boost_potential: number
  boss_types: string[]
  priority_score: number
}

export interface RosterPriority {
  hero_name: string
  appears_in_meta_teams: number
  damage_potential: number
  boss_types: string[]
  priority_score: number
}

export interface BossCoverage {
  boss_type: string
  teams_analyzed: number
  teams_available: number
  coverage_pct: number
}

export interface TeamRecommendation {
  composition: string
  damage_p90: number
  damage_avg: number
  attack_count: number
  rarity?: string | null
  rarity_set?: string | null
  missing_units: string[]
}

export interface BossRecommendations {
  boss_type: string
  available_teams: TeamRecommendation[]
  close_teams: TeamRecommendation[]
  coverage_pct: number
}

export interface AnalyzeRosterOptions {
  teams: MetaAtlasTeam[]
  roster: Set<string>
  canonicalNameByNormalized?: Map<string, string>
  maxRecommendationsPerBoss?: number
  maxCloseTeamsPerBoss?: number
}

export interface AnalyzeRosterResult {
  gaps: RosterGap[]
  development_priorities: RosterPriority[]
  coverage_by_boss: BossCoverage[]
  recommendations_by_boss: BossRecommendations[]
  meta_teams_analyzed: number
}

const normalizeValue = normalizeIdentifier

export const normalizeUnitName = (value: string) => normalizeValue(value)

export { parseTeamComposition }

const resolveCanonicalName = (
  rawName: string,
  canonicalNameByNormalized?: Map<string, string>
) => {
  const normalized = normalizeValue(rawName)
  if (!normalized) return ''
  return canonicalNameByNormalized?.get(normalized) ?? rawName.trim()
}

export function analyzeRoster({
  teams,
  roster,
  canonicalNameByNormalized,
  maxRecommendationsPerBoss = 3,
  maxCloseTeamsPerBoss = 3
}: AnalyzeRosterOptions): AnalyzeRosterResult {
  const gapMap = new Map<
    string,
    { name: string; count: number; bosses: Set<string>; totalDamage: number }
  >()
  const ownedMap = new Map<
    string,
    { name: string; count: number; bosses: Set<string>; totalDamage: number }
  >()
  const coverageMap = new Map<
    string,
    {
      analyzed: number
      available: number
      availableTeams: TeamRecommendation[]
      closeTeams: TeamRecommendation[]
    }
  >()

  let teamsAnalyzed = 0

  teams.forEach((team) => {
    if (!team.team_composition) return

    const parsed = parseTeamComposition(team.team_composition)
    if (parsed.units.length === 0) return

    const bossType = team.boss_type
    const missingUnits: string[] = []
    const damageValue = Math.round(team.damage_p90 ?? team.damage_avg ?? 0)
    const damageAvg = Math.round(team.damage_avg ?? 0)
    const attackCount = Math.round(team.attack_count ?? 0)

    parsed.units.forEach((unit) => {
      const normalized = normalizeValue(unit)
      if (!normalized) return
      const canonical = resolveCanonicalName(unit, canonicalNameByNormalized)
      if (!roster.has(normalized)) {
        missingUnits.push(canonical)
        const existing = gapMap.get(normalized)
        if (!existing) {
          gapMap.set(normalized, {
            name: canonical,
            count: 1,
            bosses: new Set([bossType]),
            totalDamage: damageValue
          })
        } else {
          existing.count += 1
          existing.totalDamage += damageValue
          existing.bosses.add(bossType)
        }
      } else {
        const existing = ownedMap.get(normalized)
        if (!existing) {
          ownedMap.set(normalized, {
            name: canonical,
            count: 1,
            bosses: new Set([bossType]),
            totalDamage: damageValue
          })
        } else {
          existing.count += 1
          existing.totalDamage += damageValue
          existing.bosses.add(bossType)
        }
      }
    })

    teamsAnalyzed += 1

    const coverage = coverageMap.get(bossType) ?? {
      analyzed: 0,
      available: 0,
      availableTeams: [] as TeamRecommendation[],
      closeTeams: [] as TeamRecommendation[]
    }

    coverage.analyzed += 1

    const recommendation: TeamRecommendation = {
      composition: team.team_composition,
      damage_p90: damageValue,
      damage_avg: damageAvg,
      attack_count: attackCount,
      rarity: team.rarity ?? null,
      rarity_set: team.rarity_set ?? null,
      missing_units: missingUnits
    }

    if (missingUnits.length === 0) {
      coverage.available += 1
      coverage.availableTeams.push(recommendation)
    } else if (missingUnits.length <= 2) {
      coverage.closeTeams.push(recommendation)
    }

    coverageMap.set(bossType, coverage)
  })

  const gaps: RosterGap[] = Array.from(gapMap.values())
    .map((gap) => {
      const avgDamage = gap.count > 0 ? gap.totalDamage / gap.count : 0
      const score = Math.round(avgDamage * gap.count)
      return {
        hero_name: gap.name,
        appears_in_meta_teams: gap.count,
        damage_boost_potential: Math.round(avgDamage),
        boss_types: Array.from(gap.bosses),
        priority_score: score
      }
    })
    .sort((a, b) => b.priority_score - a.priority_score)

  const developmentPriorities: RosterPriority[] = Array.from(ownedMap.values())
    .map((hero) => {
      const avgDamage = hero.count > 0 ? hero.totalDamage / hero.count : 0
      const score = Math.round(avgDamage * hero.count)
      return {
        hero_name: hero.name,
        appears_in_meta_teams: hero.count,
        damage_potential: Math.round(avgDamage),
        boss_types: Array.from(hero.bosses),
        priority_score: score
      }
    })
    .sort((a, b) => b.priority_score - a.priority_score)

  const coverageByBoss: BossCoverage[] = Array.from(coverageMap.entries())
    .map(([bossType, coverage]) => {
      const coveragePct =
        coverage.analyzed > 0
          ? Math.round((coverage.available / coverage.analyzed) * 100)
          : 0
      return {
        boss_type: bossType,
        teams_analyzed: coverage.analyzed,
        teams_available: coverage.available,
        coverage_pct: coveragePct
      }
    })
    .sort((a, b) => a.coverage_pct - b.coverage_pct)

  const recommendationsByBoss: BossRecommendations[] = Array.from(
    coverageMap.entries()
  )
    .map(([bossType, coverage]) => {
      const coveragePct =
        coverage.analyzed > 0
          ? Math.round((coverage.available / coverage.analyzed) * 100)
          : 0
      const availableTeams = [...coverage.availableTeams]
        .sort((a, b) => b.damage_p90 - a.damage_p90)
        .slice(0, maxRecommendationsPerBoss)
      const closeTeams = [...coverage.closeTeams]
        .sort((a, b) => {
          if (a.missing_units.length !== b.missing_units.length) {
            return a.missing_units.length - b.missing_units.length
          }
          return b.damage_p90 - a.damage_p90
        })
        .slice(0, maxCloseTeamsPerBoss)

      return {
        boss_type: bossType,
        available_teams: availableTeams,
        close_teams: closeTeams,
        coverage_pct: coveragePct
      }
    })
    .sort((a, b) => a.coverage_pct - b.coverage_pct)

  return {
    gaps,
    development_priorities: developmentPriorities,
    coverage_by_boss: coverageByBoss,
    recommendations_by_boss: recommendationsByBoss,
    meta_teams_analyzed: teamsAnalyzed
  }
}
