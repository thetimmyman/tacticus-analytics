import { describe, it, expect } from 'vitest'
import {
  clampTokenRatio,
  applyTokenWeightingPercent,
  getTokenRatioForIdentifiers,
  deriveParticipationShareRatiosFromParticipants,
  mergeTokenRatioMap,
  type TokenRatioParticipant
} from '@tacticus/app-core/token-weighting'

describe('Token Weighting Utilities', () => {
  describe('clampTokenRatio', () => {
    it('returns fallback for non-finite values', () => {
      expect(clampTokenRatio(NaN)).toBe(1)
      expect(clampTokenRatio(Infinity)).toBe(1)
      expect(clampTokenRatio(-Infinity)).toBe(1)
    })

    it('clamps negative values to 0', () => {
      expect(clampTokenRatio(-0.5)).toBe(0)
      expect(clampTokenRatio(-1)).toBe(0)
    })

    it('clamps values above 1 to 1', () => {
      expect(clampTokenRatio(1.5)).toBe(1)
      expect(clampTokenRatio(2)).toBe(1)
      expect(clampTokenRatio(100)).toBe(1)
    })

    it('returns value unchanged when in range [0, 1]', () => {
      expect(clampTokenRatio(0)).toBe(0)
      expect(clampTokenRatio(0.5)).toBe(0.5)
      expect(clampTokenRatio(1)).toBe(1)
      expect(clampTokenRatio(0.75)).toBe(0.75)
    })

    it('uses custom fallback', () => {
      expect(clampTokenRatio(NaN, 0.5)).toBe(0.5)
      expect(clampTokenRatio(Infinity, 0)).toBe(0)
    })
  })

  describe('applyTokenWeightingPercent', () => {
    it('applies 100% ratio (no change)', () => {
      expect(applyTokenWeightingPercent(10, 1)).toBeCloseTo(10)
      expect(applyTokenWeightingPercent(50, 1)).toBeCloseTo(50)
      expect(applyTokenWeightingPercent(-20, 1)).toBeCloseTo(-20)
    })

    it('applies 0% ratio (zero result)', () => {
      expect(applyTokenWeightingPercent(10, 0)).toBe(-100)
      expect(applyTokenWeightingPercent(50, 0)).toBe(-100)
    })

    it('applies 50% ratio', () => {
      expect(applyTokenWeightingPercent(10, 0.5)).toBeCloseTo(-45)
    })

    it('clamps ratio before applying', () => {
      expect(applyTokenWeightingPercent(10, 1.5)).toBeCloseTo(10)
      expect(applyTokenWeightingPercent(10, -0.5)).toBe(-100)
    })
  })

  describe('getTokenRatioForIdentifiers', () => {
    it('returns fallback for empty/undefined map', () => {
      expect(getTokenRatioForIdentifiers(undefined, 'id1', 'name1')).toBe(1)
      expect(getTokenRatioForIdentifiers(new Map(), 'id1', 'name1')).toBe(1)
    })

    it('looks up by playerId first', () => {
      const ratios = new Map([
        ['player123', 0.8],
        ['testplayer', 0.6]
      ])

      expect(
        getTokenRatioForIdentifiers(ratios, 'player123', 'TestPlayer')
      ).toBe(0.8)
    })

    it('falls back to displayName if playerId not found', () => {
      const ratios = new Map([['testplayer', 0.6]])

      expect(
        getTokenRatioForIdentifiers(ratios, 'unknownId', 'TestPlayer')
      ).toBe(0.6)
    })

    it('normalizes displayName (lowercase, trimmed)', () => {
      const ratios = new Map([['testplayer', 0.6]])

      expect(getTokenRatioForIdentifiers(ratios, null, '  TestPlayer  ')).toBe(
        0.6
      )
      expect(getTokenRatioForIdentifiers(ratios, null, 'TESTPLAYER')).toBe(0.6)
    })

    it('returns fallback if neither found', () => {
      const ratios = new Map([['other', 0.5]])

      expect(
        getTokenRatioForIdentifiers(ratios, 'unknown', 'Unknown', 0.75)
      ).toBe(0.75)
    })

    it('trims playerId before lookup', () => {
      const ratios = new Map([['player123', 0.8]])

      expect(getTokenRatioForIdentifiers(ratios, '  player123  ', null)).toBe(
        0.8
      )
    })

    it('clamps returned ratio', () => {
      const ratios = new Map([
        ['player1', 1.5],
        ['player2', -0.5]
      ])

      expect(getTokenRatioForIdentifiers(ratios, 'player1', null)).toBe(1)
      expect(getTokenRatioForIdentifiers(ratios, 'player2', null)).toBe(0)
    })
  })

  describe('deriveParticipationShareRatiosFromParticipants', () => {
    it('returns empty map for empty participants', () => {
      expect(
        deriveParticipationShareRatiosFromParticipants([], 'max').size
      ).toBe(0)
    })

    describe('max mode', () => {
      it('calculates ratios relative to highest value', () => {
        const participants: TokenRatioParticipant[] = [
          { playerId: 'player1', displayName: 'Player1', value: 100 },
          { playerId: 'player2', displayName: 'Player2', value: 50 },
          { playerId: 'player3', displayName: 'Player3', value: 25 }
        ]

        const ratios = deriveParticipationShareRatiosFromParticipants(
          participants,
          'max'
        )

        expect(ratios.get('player1')).toBe(1)
        expect(ratios.get('player2')).toBe(0.5)
        expect(ratios.get('player3')).toBe(0.25)
      })

      it('returns empty map when highest value is 0', () => {
        const participants: TokenRatioParticipant[] = [
          { playerId: 'player1', value: 0 },
          { playerId: 'player2', value: -10 }
        ]

        const ratios = deriveParticipationShareRatiosFromParticipants(
          participants,
          'max'
        )

        expect(ratios.size).toBe(0)
      })
    })

    describe('average mode', () => {
      it('calculates ratios relative to average value', () => {
        const participants: TokenRatioParticipant[] = [
          { playerId: 'player1', displayName: 'Player1', value: 100 },
          { playerId: 'player2', displayName: 'Player2', value: 50 },
          { playerId: 'player3', displayName: 'Player3', value: 0 }
        ]

        const ratios = deriveParticipationShareRatiosFromParticipants(
          participants,
          'average'
        )

        expect(ratios.get('player1')).toBe(1) // 100/50 = 2, clamped to 1
        expect(ratios.get('player2')).toBe(1) // 50/50 = 1
        expect(ratios.get('player3')).toBe(0) // 0/50 = 0
      })

      it('returns empty map when average is 0', () => {
        const participants: TokenRatioParticipant[] = [
          { playerId: 'player1', value: 0 },
          { playerId: 'player2', value: 0 }
        ]

        const ratios = deriveParticipationShareRatiosFromParticipants(
          participants,
          'average'
        )

        expect(ratios.size).toBe(0)
      })
    })

    it('stores by both playerId and normalized displayName', () => {
      const participants: TokenRatioParticipant[] = [
        { playerId: 'player1', displayName: 'TestPlayer', value: 100 }
      ]

      const ratios = deriveParticipationShareRatiosFromParticipants(
        participants,
        'max'
      )

      expect(ratios.has('player1')).toBe(true)
      expect(ratios.has('testplayer')).toBe(true)
    })

    it('ignores empty playerId and displayName', () => {
      const participants: TokenRatioParticipant[] = [
        { playerId: '', displayName: '', value: 100 },
        { playerId: '  ', displayName: '  ', value: 50 }
      ]

      const ratios = deriveParticipationShareRatiosFromParticipants(
        participants,
        'max'
      )

      expect(ratios.size).toBe(0)
    })

    it('treats negative values as 0', () => {
      const participants: TokenRatioParticipant[] = [
        { playerId: 'player1', value: 100 },
        { playerId: 'player2', value: -50 }
      ]

      const ratios = deriveParticipationShareRatiosFromParticipants(
        participants,
        'max'
      )

      expect(ratios.get('player1')).toBe(1)
      expect(ratios.get('player2')).toBe(0)
    })
  })

  describe('mergeTokenRatioMap', () => {
    it('merges two maps with primary taking precedence', () => {
      const primary = new Map([
        ['player1', 0.8],
        ['player2', 0.6]
      ])
      const fallback = new Map([
        ['player2', 0.9],
        ['player3', 0.5]
      ])

      const merged = mergeTokenRatioMap(primary, fallback)

      expect(merged.get('player1')).toBe(0.8)
      expect(merged.get('player2')).toBe(0.6) // Primary takes precedence
      expect(merged.get('player3')).toBe(0.5)
    })

    it('returns copy of primary when fallback is empty', () => {
      const primary = new Map([['player1', 0.8]])
      const fallback = new Map<string, number>()

      const merged = mergeTokenRatioMap(primary, fallback)

      expect(merged.get('player1')).toBe(0.8)
      expect(merged.size).toBe(1)
    })

    it('returns copy of fallback when primary is empty', () => {
      const primary = new Map<string, number>()
      const fallback = new Map([['player1', 0.5]])

      const merged = mergeTokenRatioMap(primary, fallback)

      expect(merged.get('player1')).toBe(0.5)
      expect(merged.size).toBe(1)
    })

    it('does not mutate original maps', () => {
      const primary = new Map([['player1', 0.8]])
      const fallback = new Map([['player2', 0.5]])

      const merged = mergeTokenRatioMap(primary, fallback)
      merged.set('player3', 0.3)

      expect(primary.has('player3')).toBe(false)
      expect(fallback.has('player3')).toBe(false)
    })
  })
})
