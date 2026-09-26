import { describe, it, expect } from 'vitest'
import {
  parseTeamComposition,
  calculateRosterCoverage,
  calculateAssignmentScore
} from '../../../supabase/functions/_shared/meta-analysis.ts'
import { parseTeamComposition as parseAppTeamComposition } from '@/app/lib/meta/team-coverage'

describe('Edge Function: meta-analysis helpers', () => {
  describe('parseTeamComposition', () => {
    it('parses team with heroes only', () => {
      const result = parseTeamComposition('Abraxas, Varro, Thaddeus')
      expect(result.heroes).toEqual(['Abraxas', 'Varro', 'Thaddeus'])
      expect(result.mow).toBeNull()
    })

    it('parses team with heroes and MoW', () => {
      const result = parseTeamComposition(
        'Abraxas, Varro, Thaddeus + Vindicator'
      )
      expect(result.heroes).toEqual(['Abraxas', 'Varro', 'Thaddeus'])
      expect(result.mow).toBe('Vindicator')
    })

    it('handles empty string', () => {
      const result = parseTeamComposition('')
      expect(result.heroes).toEqual([])
      expect(result.mow).toBeNull()
    })

    it('handles single hero', () => {
      const result = parseTeamComposition('Abraxas')
      expect(result.heroes).toEqual(['Abraxas'])
      expect(result.mow).toBeNull()
    })

    it('handles single hero with MoW', () => {
      const result = parseTeamComposition('Abraxas + Land Raider')
      expect(result.heroes).toEqual(['Abraxas'])
      expect(result.mow).toBe('Land Raider')
    })

    it('trims whitespace from hero names', () => {
      const result = parseTeamComposition('  Abraxas  ,  Varro  ')
      expect(result.heroes).toEqual(['Abraxas', 'Varro'])
    })

    it('trims whitespace from MoW name', () => {
      const result = parseTeamComposition('Abraxas +   Vindicator   ')
      expect(result.mow).toBe('Vindicator')
    })

    it('filters empty strings from heroes', () => {
      const result = parseTeamComposition('Abraxas, , Varro')
      expect(result.heroes).toEqual(['Abraxas', 'Varro'])
    })

    it.each(['A, B + M', 'A,B + M'])(
      'matches the app parser hero list for %s',
      (composition) => {
        expect(parseTeamComposition(composition).heroes).toEqual(
          parseAppTeamComposition(composition).heroes
        )
      }
    )
  })

  describe('calculateRosterCoverage', () => {
    it('returns 100% for full match', () => {
      const teamHeroes = ['Abraxas', 'Varro', 'Thaddeus']
      const rosterSet = new Set(['abraxas', 'varro', 'thaddeus', 'mephiston'])
      const result = calculateRosterCoverage(teamHeroes, rosterSet)
      expect(result.score).toBe(100)
      expect(result.missing).toEqual([])
    })

    it('returns 0% for no match', () => {
      const teamHeroes = ['Abraxas', 'Varro']
      const rosterSet = new Set(['mephiston', 'calgar'])
      const result = calculateRosterCoverage(teamHeroes, rosterSet)
      expect(result.score).toBe(0)
      expect(result.missing).toEqual(['Abraxas', 'Varro'])
    })

    it('returns partial coverage correctly', () => {
      const teamHeroes = ['Abraxas', 'Varro', 'Thaddeus', 'Unknown']
      const rosterSet = new Set(['abraxas', 'varro', 'mephiston'])
      const result = calculateRosterCoverage(teamHeroes, rosterSet)
      expect(result.score).toBe(50)
      expect(result.missing).toEqual(['Thaddeus', 'Unknown'])
    })

    it('uses fuzzy matching (substring)', () => {
      const teamHeroes = ['Abraxas the Great']
      const rosterSet = new Set(['abraxas'])
      const result = calculateRosterCoverage(teamHeroes, rosterSet)
      expect(result.score).toBe(100)
      expect(result.missing).toEqual([])
    })

    it('uses fuzzy matching (reverse substring)', () => {
      const teamHeroes = ['Abra']
      const rosterSet = new Set(['abraxas'])
      const result = calculateRosterCoverage(teamHeroes, rosterSet)
      expect(result.score).toBe(100)
      expect(result.missing).toEqual([])
    })

    it('returns 0 for empty team', () => {
      const result = calculateRosterCoverage([], new Set(['abraxas']))
      expect(result.score).toBe(0)
      expect(result.missing).toEqual([])
    })

    it('handles empty roster set', () => {
      const teamHeroes = ['Abraxas', 'Varro']
      const result = calculateRosterCoverage(teamHeroes, new Set())
      expect(result.score).toBe(0)
      expect(result.missing).toEqual(['Abraxas', 'Varro'])
    })

    it('is case insensitive on team heroes (lowercased for matching)', () => {
      const teamHeroes = ['ABRAXAS', 'varro', 'ThAdDeUs']
      const rosterSet = new Set(['abraxas', 'varro', 'thaddeus'])
      const result = calculateRosterCoverage(teamHeroes, rosterSet)
      expect(result.score).toBe(100)
      expect(result.missing).toEqual([])
    })
  })

  describe('calculateAssignmentScore', () => {
    it('returns positive score for good assignment', () => {
      const result = calculateAssignmentScore({
        damageP90: 1_000_000,
        coverageScore: 100,
        preference: 'neutral',
        reliability: 80
      })
      expect(result).toBeGreaterThan(0)
    })

    it('applies preference bonus for preferred', () => {
      const neutral = calculateAssignmentScore({
        damageP90: 1_000_000,
        coverageScore: 100,
        preference: 'neutral',
        reliability: 80
      })
      const preferred = calculateAssignmentScore({
        damageP90: 1_000_000,
        coverageScore: 100,
        preference: 'preferred',
        reliability: 80
      })
      expect(preferred).toBeGreaterThan(neutral)
    })

    it('applies preference penalty for avoid', () => {
      const neutral = calculateAssignmentScore({
        damageP90: 1_000_000,
        coverageScore: 100,
        preference: 'neutral',
        reliability: 80
      })
      const avoid = calculateAssignmentScore({
        damageP90: 1_000_000,
        coverageScore: 100,
        preference: 'avoid',
        reliability: 80
      })
      expect(avoid).toBeLessThan(neutral)
    })

    it('scales with damage', () => {
      const lowDamage = calculateAssignmentScore({
        damageP90: 500_000,
        coverageScore: 100,
        preference: 'neutral',
        reliability: 80
      })
      const highDamage = calculateAssignmentScore({
        damageP90: 2_000_000,
        coverageScore: 100,
        preference: 'neutral',
        reliability: 80
      })
      expect(highDamage).toBeGreaterThan(lowDamage)
    })

    it('scales with coverage', () => {
      const lowCoverage = calculateAssignmentScore({
        damageP90: 1_000_000,
        coverageScore: 25,
        preference: 'neutral',
        reliability: 80
      })
      const highCoverage = calculateAssignmentScore({
        damageP90: 1_000_000,
        coverageScore: 100,
        preference: 'neutral',
        reliability: 80
      })
      expect(highCoverage).toBeGreaterThan(lowCoverage)
    })

    it('scales with reliability', () => {
      const lowReliability = calculateAssignmentScore({
        damageP90: 1_000_000,
        coverageScore: 100,
        preference: 'neutral',
        reliability: 40
      })
      const highReliability = calculateAssignmentScore({
        damageP90: 1_000_000,
        coverageScore: 100,
        preference: 'neutral',
        reliability: 100
      })
      expect(highReliability).toBeGreaterThan(lowReliability)
    })

    it('uses custom weights when provided', () => {
      const defaultWeights = calculateAssignmentScore({
        damageP90: 1_000_000,
        coverageScore: 100,
        preference: 'preferred',
        reliability: 80
      })
      const customWeights = calculateAssignmentScore({
        damageP90: 1_000_000,
        coverageScore: 100,
        preference: 'preferred',
        reliability: 80,
        weights: { damage: 2.0, preference: 1.0, reliability: 0.5 }
      })
      expect(customWeights).not.toBe(defaultWeights)
    })

    it('never returns negative score', () => {
      const result = calculateAssignmentScore({
        damageP90: 0,
        coverageScore: 0,
        preference: 'avoid',
        reliability: 0
      })
      expect(result).toBeGreaterThanOrEqual(0)
    })

    it('returns 0 for zero damage and zero coverage with avoid preference', () => {
      const result = calculateAssignmentScore({
        damageP90: 0,
        coverageScore: 0,
        preference: 'avoid',
        reliability: 0
      })
      expect(result).toBe(0)
    })

    it('handles extremely high damage values', () => {
      const result = calculateAssignmentScore({
        damageP90: 10_000_000,
        coverageScore: 100,
        preference: 'neutral',
        reliability: 100
      })
      expect(result).toBeGreaterThan(10)
    })
  })
})
