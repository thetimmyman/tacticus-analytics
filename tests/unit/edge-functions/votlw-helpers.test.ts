import { describe, it, expect } from 'vitest'
import {
  type RpcSetWinnerRow,
  type SeasonAwardsDataRow,
  type SeasonAwards,
  calculatePlayerPoints,
  calculateSeasonAwards
} from '../../../supabase/functions/calculate-votlw/votlw-core.ts'
import { resolveDisplayName } from '../../../supabase/functions/_shared/player-name-resolution-core.ts'

const emptySeasonAwards: SeasonAwards = {
  topKiller: { player: '', value: 0 },
  bestBomber: { player: '', value: 0 }
}

describe('Edge Function: calculate-votlw helpers', () => {
  describe('resolveDisplayName', () => {
    // Only uid-like or missing names hit playerNameMap (or a Player#XXXXXX fallback).
    const UID = '123e4567-e89b-12d3-a456-426614174000'

    it('returns a non-uid-like displayName verbatim, ignoring the map', () => {
      const playerNameMap = new Map([['user-123', 'MappedName']])
      expect(
        resolveDisplayName('OriginalName', 'user-123', playerNameMap)
      ).toBe('OriginalName')
    })

    it('resolves a uid-like displayName via userId mapping', () => {
      const playerNameMap = new Map([['user-123', 'MappedName']])
      expect(resolveDisplayName(UID, 'user-123', playerNameMap)).toBe(
        'MappedName'
      )
    })

    it('resolves a uid-like displayName via lowercased userId mapping', () => {
      const playerNameMap = new Map([['user-123', 'MappedName']])
      expect(resolveDisplayName(UID, 'USER-123', playerNameMap)).toBe(
        'MappedName'
      )
    })

    it('uses userId mapping when displayName is missing', () => {
      const playerNameMap = new Map([['user-123', 'MappedName']])
      expect(resolveDisplayName(null, 'user-123', playerNameMap)).toBe(
        'MappedName'
      )
    })

    it('synthesizes Player#<id> for a uid-like name with no mapping', () => {
      const playerNameMap = new Map<string, string>()
      expect(resolveDisplayName(UID, 'abc123-def456', playerNameMap)).toBe(
        'Player#ABC123'
      )
    })

    it('synthesizes Player#UNKNWN when uid-like name has no userId', () => {
      const playerNameMap = new Map<string, string>()
      expect(resolveDisplayName(UID, null, playerNameMap)).toBe('Player#UNKNWN')
    })
  })

  describe('calculateSeasonAwards', () => {
    const emptyMap = new Map<string, string>()
    const hit = (name: string): SeasonAwardsDataRow => ({
      display_name: name,
      user_id: null
    })
    const bomb = (name: string, damage: number): SeasonAwardsDataRow => ({
      display_name: name,
      user_id: null,
      damage_dealt: damage
    })

    it('returns empty awards when there is no data', () => {
      const result = calculateSeasonAwards([], [], emptyMap)
      expect(result.topKiller).toEqual({ player: '', value: 0 })
      expect(result.bestBomber).toEqual({ player: '', value: 0 })
    })

    it('picks the top killer by number of last hits', () => {
      const result = calculateSeasonAwards(
        [hit('Alpha'), hit('Alpha'), hit('Alpha'), hit('Bravo')],
        [],
        emptyMap
      )
      expect(result.topKiller).toEqual({ player: 'Alpha', value: 3 })
    })

    it('picks the best bomber by single biggest positive bomb', () => {
      const result = calculateSeasonAwards(
        [],
        [
          bomb('Alpha', 500_000),
          bomb('Bravo', 900_000),
          bomb('Alpha', 100_000)
        ],
        emptyMap
      )
      expect(result.bestBomber).toEqual({ player: 'Bravo', value: 900_000 })
    })

    it('ignores non-positive bomb damage', () => {
      const result = calculateSeasonAwards(
        [],
        [bomb('Alpha', 0), bomb('Bravo', -5)],
        emptyMap
      )
      expect(result.bestBomber).toEqual({ player: '', value: 0 })
    })

    it('resolves uid-like killer names through the player name map', () => {
      const uid = '123e4567-e89b-12d3-a456-426614174000'
      const map = new Map([['user-1', 'RealName']])
      const result = calculateSeasonAwards(
        [{ display_name: uid, user_id: 'user-1' }],
        [],
        map
      )
      expect(result.topKiller.player).toBe('RealName')
    })
  })

  describe('calculatePlayerPoints', () => {
    const setRow = (overrides: Partial<RpcSetWinnerRow>): RpcSetWinnerRow => ({
      rarity: 'Legendary',
      set: 0,
      levelString: 'L1',
      bossName: 'Szarekh',
      gold: {},
      silver: {},
      bronze: {},
      mostDamage: {},
      sideBoss1: {},
      sideBoss2: {},
      biggestHit: {},
      ...overrides
    })

    it('awards 3/2/1 points for gold/silver/bronze medals', () => {
      const points = calculatePlayerPoints(
        [
          setRow({
            gold: { player: 'Alpha', value: 1_000_000 },
            silver: { player: 'Bravo', value: 900_000 },
            bronze: { player: 'Charlie', value: 800_000 }
          })
        ],
        emptySeasonAwards
      )
      expect(points.find((p) => p.player === 'Alpha')).toMatchObject({
        totalPoints: 3,
        goldMedals: 1
      })
      expect(points.find((p) => p.player === 'Bravo')).toMatchObject({
        totalPoints: 2,
        silverMedals: 1
      })
      expect(points.find((p) => p.player === 'Charlie')).toMatchObject({
        totalPoints: 1,
        bronzeMedals: 1
      })
    })

    it('awards 1 point for most damage and biggest hit, 2 per side boss', () => {
      const points = calculatePlayerPoints(
        [
          setRow({
            mostDamage: { player: 'Alpha', value: 20_000_000 },
            sideBoss1: { player: 'Bravo', value: 700_000 },
            sideBoss2: { player: 'Bravo', value: 650_000 },
            biggestHit: { player: 'Charlie', value: 2_000_000 }
          })
        ],
        emptySeasonAwards
      )
      expect(points.find((p) => p.player === 'Alpha')?.totalPoints).toBe(1)
      expect(points.find((p) => p.player === 'Bravo')?.totalPoints).toBe(4)
      expect(points.find((p) => p.player === 'Charlie')?.totalPoints).toBe(1)
    })

    it('awards 3 points for top killer and 0.5 for best bomber', () => {
      const points = calculatePlayerPoints([], {
        topKiller: { player: 'Alpha', value: 12 },
        bestBomber: { player: 'Bravo', value: 900_000 }
      })
      expect(points.find((p) => p.player === 'Alpha')?.totalPoints).toBe(3)
      expect(points.find((p) => p.player === 'Bravo')?.totalPoints).toBe(0.5)
    })

    it('accumulates points across multiple sets (Legendary + Mythic)', () => {
      const points = calculatePlayerPoints(
        [
          setRow({
            gold: { player: 'Alpha', value: 1_000_000 },
            mostDamage: { player: 'Alpha', value: 15_000_000 }
          }),
          setRow({
            rarity: 'Mythic',
            levelString: 'M1',
            gold: { player: 'Alpha', value: 2_000_000 }
          })
        ],
        emptySeasonAwards
      )
      expect(points.find((p) => p.player === 'Alpha')).toMatchObject({
        totalPoints: 7,
        goldMedals: 2
      })
    })

    it('ignores empty award objects (no winner)', () => {
      // The RPC emits '{}' for awards with no qualifier.
      const points = calculatePlayerPoints([setRow({})], emptySeasonAwards)
      expect(points).toEqual([])
    })

    it('sorts players by total points descending and filters zero-point players', () => {
      const points = calculatePlayerPoints(
        [
          setRow({
            gold: { player: 'Bravo', value: 1_000_000 },
            bronze: { player: 'Alpha', value: 800_000 }
          })
        ],
        emptySeasonAwards
      )
      expect(points.map((p) => p.player)).toEqual(['Bravo', 'Alpha'])
    })
  })
})
