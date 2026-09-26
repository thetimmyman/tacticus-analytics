import { describe, it, expect } from 'vitest'
import {
  buildRosterLookup,
  evaluateStrengthState,
  getStrengthThresholdsForRaritySet,
  type RosterLookup,
  type StrengthThresholds
} from '@/app/lib/meta/roster-strength'

describe('roster-strength', () => {
  describe('buildRosterLookup', () => {
    it('returns empty lookup for null roster', () => {
      const lookup = buildRosterLookup(null)

      expect(lookup.hasEntries).toBe(false)
      expect(lookup.entries).toHaveLength(0)
      expect(lookup.hasStrengthData).toBe(false)
    })

    it('returns empty lookup for undefined roster', () => {
      const lookup = buildRosterLookup(undefined)

      expect(lookup.hasEntries).toBe(false)
    })

    it('returns empty lookup for empty array', () => {
      const lookup = buildRosterLookup([])

      expect(lookup.hasEntries).toBe(false)
      expect(lookup.entries).toHaveLength(0)
    })

    it('parses string entries', () => {
      const lookup = buildRosterLookup(['Alpha', 'Bravo', 'Charlie'])

      expect(lookup.hasEntries).toBe(true)
      expect(lookup.entries).toHaveLength(3)
      expect(lookup.find('Alpha')).not.toBeNull()
      expect(lookup.find('alpha')).not.toBeNull()
    })

    it('parses object entries with name', () => {
      const lookup = buildRosterLookup([
        { name: 'Delta', rank: 15, progressionIndex: 12 }
      ])

      expect(lookup.hasEntries).toBe(true)
      expect(lookup.find('Delta')).not.toBeNull()
      expect(lookup.hasStrengthData).toBe(true)
    })

    it('parses object entries with engineId', () => {
      const lookup = buildRosterLookup([
        { engineId: 'hero_marneus', name: 'Marneus Calgar' }
      ])

      expect(lookup.find('hero_marneus')).not.toBeNull()
      expect(lookup.find('Marneus Calgar')).not.toBeNull()
    })

    it('resolves canonical display name when name/id/engineId diverge', () => {
      // rosterLookup must match display_name, raw Loki ID and engineId alias.
      const lookup = buildRosterLookup([
        {
          id: 'templHelbrecht',
          engineId: 'helbrecht',
          name: 'High Marshal Helbrecht',
          rank: 19,
          progressionIndex: 19
        }
      ])

      expect(lookup.find('High Marshal Helbrecht')).not.toBeNull()
      expect(lookup.find('templHelbrecht')).not.toBeNull()
      expect(lookup.find('Helbrecht')).not.toBeNull()
    })

    it('finds entries by normalized token', () => {
      const lookup = buildRosterLookup([{ name: 'Aethana the Wanderer' }])

      expect(lookup.find('aethanathewanderer')).not.toBeNull()
      expect(lookup.find('AETHANA THE WANDERER')).not.toBeNull()
    })

    it('finds entries by prefix match', () => {
      const lookup = buildRosterLookup([{ name: 'Inquisitor Greyfax' }])

      expect(lookup.find('inquisitorgreyfax')).not.toBeNull()
      expect(lookup.find('inquisitor')).not.toBeNull()
    })

    it('derives power from rank and progressionIndex', () => {
      const lookup = buildRosterLookup([
        { name: 'TestHero', rank: 15, progressionIndex: 12 }
      ])

      const entry = lookup.find('TestHero')
      expect(entry).not.toBeNull()
      expect(entry?.power).toBeGreaterThan(0)
      expect(entry?.powerSource).toBe('derived')
      expect(entry?.hasStrengthData).toBe(true)
    })

    it('uses provided power when available', () => {
      const lookup = buildRosterLookup([{ name: 'PowerHero', power: 750 }])

      const entry = lookup.find('PowerHero')
      expect(entry?.power).toBe(750)
      expect(entry?.powerSource).toBe('provided')
    })

    it('handles abilities in power calculation', () => {
      const lookup = buildRosterLookup([
        {
          name: 'AbilityHero',
          rank: 12,
          progressionIndex: 9,
          abilities: [{ level: 30 }, { level: 25 }, { level: 20 }]
        }
      ])

      const entry = lookup.find('AbilityHero')
      expect(entry?.power).toBeGreaterThan(0)
      expect(entry?.hasStrengthData).toBe(true)
    })

    it('returns null for entries without tokens', () => {
      const lookup = buildRosterLookup([{ name: '' }, { name: '   ' }])

      expect(lookup.entries).toHaveLength(0)
    })

    it('replaces entry when incoming has power and existing does not', () => {
      const lookup = buildRosterLookup([
        { name: 'DupeHero' },
        { name: 'DupeHero', power: 500 }
      ])

      const entry = lookup.find('DupeHero')
      expect(entry?.power).toBe(500)
    })
  })

  describe('getStrengthThresholdsForRaritySet', () => {
    it('returns none source for null input', () => {
      const thresholds = getStrengthThresholdsForRaritySet(null)

      expect(thresholds.source).toBe('none')
      expect(thresholds.suitable).toBe(0)
    })

    it('returns none source for invalid format', () => {
      const thresholds = getStrengthThresholdsForRaritySet('invalid')

      expect(thresholds.source).toBe('none')
    })

    it('parses L1 rarity set', () => {
      const thresholds = getStrengthThresholdsForRaritySet('L1')

      expect(thresholds.source).toBe('fallback')
      expect(thresholds.rarity).toBe('Legendary')
      expect(thresholds.suitable).toBeGreaterThan(0)
      expect(thresholds.strong).toBeGreaterThan(thresholds.suitable)
      expect(thresholds.optimal).toBeGreaterThan(thresholds.strong)
    })

    it('parses M3 rarity set', () => {
      const thresholds = getStrengthThresholdsForRaritySet('M3')

      expect(thresholds.rarity).toBe('Mythic')
      expect(thresholds.rankThresholds).not.toBeNull()
    })

    it('parses E2 rarity set', () => {
      const thresholds = getStrengthThresholdsForRaritySet('E2')

      expect(thresholds.rarity).toBe('Epic')
    })

    it('parses R1 rarity set', () => {
      const thresholds = getStrengthThresholdsForRaritySet('R1')

      expect(thresholds.rarity).toBe('Rare')
    })

    it('parses U1 rarity set', () => {
      const thresholds = getStrengthThresholdsForRaritySet('U1')

      expect(thresholds.rarity).toBe('Uncommon')
    })

    it('parses C1 rarity set', () => {
      const thresholds = getStrengthThresholdsForRaritySet('C1')

      expect(thresholds.rarity).toBe('Common')
    })

    it('includes ability minimums for rarity', () => {
      const thresholds = getStrengthThresholdsForRaritySet('L1')

      expect(thresholds.abilityMinimums).not.toBeNull()
      expect(thresholds.abilityMinimums?.suitable).toBeGreaterThan(0)
    })

    it('is case insensitive', () => {
      const lower = getStrengthThresholdsForRaritySet('l2')
      const upper = getStrengthThresholdsForRaritySet('L2')

      expect(lower.rarity).toBe(upper.rarity)
      expect(lower.suitable).toBe(upper.suitable)
    })
  })

  describe('evaluateStrengthState', () => {
    const legendaryThresholds = getStrengthThresholdsForRaritySet('L1')

    it('returns null for null entry', () => {
      const result = evaluateStrengthState(null, legendaryThresholds)

      expect(result).toBeNull()
    })

    it('returns null for null thresholds', () => {
      const result = evaluateStrengthState({ name: 'Hero' }, null)

      expect(result).toBeNull()
    })

    it('returns null for none source thresholds', () => {
      const noneThresholds = getStrengthThresholdsForRaritySet(null)
      const result = evaluateStrengthState(
        { name: 'Hero', rank: 15 },
        noneThresholds
      )

      expect(result).toBeNull()
    })

    it('returns Invalid for missing rank', () => {
      const result = evaluateStrengthState(
        { name: 'Hero' },
        legendaryThresholds
      )

      expect(result).toBe('Invalid')
    })

    it('returns Weak for low rank', () => {
      const result = evaluateStrengthState(
        { name: 'Hero', rank: 5, abilities: [{ level: 35 }, { level: 35 }] },
        legendaryThresholds
      )

      expect(result).toBe('Weak')
    })

    it('returns EXACTLY Suitable at the suitable-rank boundary (rank 16, abilities >= 30 but < 42)', () => {
      // Rank 16 with abilities 35 is below both L1 strong floors (17 / 42), so exactly 'Suitable'.
      expect(legendaryThresholds.rankThresholds).toEqual({
        weak: 15,
        suitable: 16,
        strong: 17,
        optimal: 18
      })

      const result = evaluateStrengthState(
        { name: 'Hero', rank: 16, abilities: [{ level: 35 }, { level: 35 }] },
        legendaryThresholds
      )

      expect(result).toBe('Suitable')
    })

    it('returns EXACTLY Strong at the strong-rank boundary (rank 17, abilities >= 42 but < 50)', () => {
      const result = evaluateStrengthState(
        { name: 'Hero', rank: 17, abilities: [{ level: 42 }, { level: 42 }] },
        legendaryThresholds
      )

      expect(result).toBe('Strong')
    })

    it('demotes a suitable-rank hero to Weak when its weakest ability is below the suitable floor', () => {
      // minAbility 29 < 30 must trip the Weak AND; a rank-only check would say 'Suitable'.
      const result = evaluateStrengthState(
        { name: 'Hero', rank: 16, abilities: [{ level: 29 }, { level: 40 }] },
        legendaryThresholds
      )

      expect(result).toBe('Weak')
    })

    it('returns Optimal for meeting optimal threshold', () => {
      const result = evaluateStrengthState(
        { name: 'Hero', rank: 18, abilities: [{ level: 50 }, { level: 50 }] },
        legendaryThresholds
      )

      expect(result).toBe('Optimal')
    })

    it('handles MoW entries differently', () => {
      const mowEntry = {
        name: 'Land Raider',
        category: 'mow',
        abilities: [{ level: 45 }, { level: 40 }, { level: 30 }]
      }

      const result = evaluateStrengthState(mowEntry, legendaryThresholds)

      expect(result).not.toBeNull()
    })

    it('returns Weak when abilities below threshold', () => {
      const result = evaluateStrengthState(
        { name: 'Hero', rank: 18, abilities: [{ level: 10 }, { level: 10 }] },
        legendaryThresholds
      )

      expect(result).toBe('Weak')
    })

    it('handles missing abilities gracefully', () => {
      const result = evaluateStrengthState(
        { name: 'Hero', rank: 16 },
        legendaryThresholds
      )

      expect(result).not.toBeNull()
    })

    it('handles empty abilities array', () => {
      const result = evaluateStrengthState(
        { name: 'Hero', rank: 16, abilities: [] },
        legendaryThresholds
      )

      expect(result).not.toBeNull()
    })
  })

  describe('integration scenarios', () => {
    it('full workflow: build lookup, get thresholds, evaluate strength', () => {
      const roster = [
        {
          name: 'Marneus Calgar',
          rank: 17,
          progressionIndex: 14,
          abilities: [{ level: 40 }, { level: 38 }]
        },
        {
          name: 'Aethana',
          rank: 12,
          progressionIndex: 12,
          abilities: [{ level: 25 }, { level: 22 }]
        }
      ]

      const lookup = buildRosterLookup(roster)
      const thresholds = getStrengthThresholdsForRaritySet('L2')

      const marneus = lookup.find('Marneus Calgar')
      const aethana = lookup.find('Aethana')

      expect(marneus).not.toBeNull()
      expect(aethana).not.toBeNull()

      const marneusState = evaluateStrengthState(marneus!.raw, thresholds)
      const aethanaState = evaluateStrengthState(aethana!.raw, thresholds)

      expect(marneusState).not.toBeNull()
      expect(aethanaState).not.toBeNull()
    })

    it('handles mixed roster with owned and missing units', () => {
      const roster = [
        { name: 'OwnedHero', rank: 15, progressionIndex: 12 },
        'StringOnlyHero'
      ]

      const lookup = buildRosterLookup(roster)

      expect(lookup.find('OwnedHero')?.hasStrengthData).toBe(true)
      expect(lookup.find('StringOnlyHero')?.hasStrengthData).toBe(false)
      expect(lookup.find('MissingHero')).toBeNull()
    })
  })
})
