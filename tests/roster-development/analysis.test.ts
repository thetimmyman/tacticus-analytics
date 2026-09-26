import { describe, expect, it } from 'vitest'
import {
  analyzeRoster,
  normalizeUnitName,
  type MetaAtlasTeam
} from '@/app/lib/roster-development/analysis'

const buildRoster = (heroes: string[]) => new Set(heroes.map(normalizeUnitName))

describe('analyzeRoster', () => {
  it('ranks missing heroes by impact', () => {
    const roster = buildRoster(['Eldryon', 'Bellator', 'Calandis'])
    const teams: MetaAtlasTeam[] = [
      {
        boss_type: 'Mortarion',
        team_composition: 'Eldryon, Bellator, Maugan Ra',
        damage_p90: 1200,
        damage_avg: 900,
        attack_count: 40,
        rarity: 'L',
        rarity_set: 'M5'
      },
      {
        boss_type: 'Mortarion',
        team_composition: 'Bellator, Calandis, Aleph-Null',
        damage_p90: 900,
        damage_avg: 700,
        attack_count: 32,
        rarity: 'L',
        rarity_set: 'M5'
      }
    ]

    const result = analyzeRoster({ teams, roster })
    expect(result.gaps.length).toBe(2)
    expect(result.gaps[0].hero_name).toBe('Maugan Ra')
    expect(result.gaps[1].hero_name).toBe('Aleph-Null')
    expect(result.gaps[0].damage_boost_potential).toBeGreaterThan(
      result.gaps[1].damage_boost_potential
    )
  })

  it('builds coverage and recommendations per boss', () => {
    const roster = buildRoster(['Eldryon', 'Bellator', 'Calandis'])
    const teams: MetaAtlasTeam[] = [
      {
        boss_type: 'Mortarion',
        team_composition: 'Eldryon, Bellator, Maugan Ra',
        damage_p90: 1200,
        damage_avg: 900,
        attack_count: 40,
        rarity: 'L',
        rarity_set: 'M5'
      },
      {
        boss_type: 'Szarekh',
        team_composition: 'Eldryon, Bellator, Calandis',
        damage_p90: 800,
        damage_avg: 600,
        attack_count: 35,
        rarity: 'L',
        rarity_set: 'M5'
      }
    ]

    const result = analyzeRoster({ teams, roster })
    expect(result.coverage_by_boss.length).toBe(2)

    const szarekhCoverage = result.coverage_by_boss.find(
      (boss) => boss.boss_type === 'Szarekh'
    )
    expect(szarekhCoverage?.teams_available).toBe(1)

    const recommendations = result.recommendations_by_boss.find(
      (boss) => boss.boss_type === 'Szarekh'
    )
    expect(recommendations?.available_teams.length).toBe(1)
    expect(recommendations?.available_teams[0].composition).toContain('Eldryon')
  })
})
