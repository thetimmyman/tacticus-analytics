import { describe, expect, it } from 'vitest'
import { orchestrateMultiStage } from '@/app/lib/boss-assignments/unified-orchestrator'
import { buildDamageModel } from '@/app/lib/boss-assignments/season-planner/damage-model'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'
import {
  initialSavedTokenState,
  verifySavedQueueTemporalAllocation,
  type SavedQueueTemporalInput
} from '@/app/lib/boss-assignments/saved-queue-temporal'

const AS_OF_MS = Date.parse('2026-06-02T08:00:00.000Z')
const SEASON_START_MS = Date.parse('2026-05-20T10:00:00.000Z')
const HOUR_MS = 3_600_000

function model(): SavedQueueTemporalInput {
  return {
    asOfMs: AS_OF_MS,
    seasonEndMs: AS_OF_MS + 72 * HOUR_MS,
    players: [
      {
        playerId: 'SYNQUEUE01',
        state: { available: 3, nextRegenAt: null },
        usedThisSeason: 0
      }
    ],
    stages: [
      {
        stageCode: 'L1',
        loopIndex: 0,
        startSeconds: 0,
        allocations: [{ playerId: 'SYNQUEUE01', tokens: 3 }]
      }
    ]
  }
}

function stage(code: string, hp: number, cap: number): BossStageEntry {
  return {
    stageCode: code,
    loopIndex: 0,
    isCurrentStage: code === 'L1',
    difficulty: 'easy',
    estimatedTokensNeeded: cap,
    encounters: {
      main: {
        bossName: 'Synthetic Main',
        bossType: 'Synthetic Main',
        maxHp: hp,
        remainingHp: hp,
        budgetTokens: cap,
        budgetSource: 'officer_target'
      },
      prime1: null,
      prime2: null
    }
  }
}

describe('saved queue token feasibility at projected stage starts', () => {
  it('refuses canonical allocations that reuse regeneration lost while capped', () => {
    const battles = [
      {
        displayName: 'Synthetic Planner',
        damageType: 'Battle' as const,
        startedOn: '2026-06-01T07:00:00.000Z'
      }
    ]
    const state = initialSavedTokenState({
      seasonStartMs: SEASON_START_MS,
      asOfMs: AS_OF_MS,
      battles
    })
    const damageModel = buildDamageModel(
      [
        {
          playerId: 'SYNQUEUE01',
          bossName: 'Synthetic Main',
          encounterId: 0,
          rarity: 'Legendary',
          set: 0,
          startedOn: battles[0].startedOn,
          damageDealt: 1000
        }
      ],
      { referenceAt: new Date(AS_OF_MS).toISOString() }
    )
    const starts = [0, 129600, 129601]
    const result = orchestrateMultiStage({
      players: [
        {
          playerId: 'SYNQUEUE01',
          displayName: 'Synthetic Planner',
          tier: 'mid',
          overallAvgDamage: 1000,
          avgDamageByStage: { L1: 1000, L2: 1000, L3: 1000 }
        }
      ],
      playerTokens: { SYNQUEUE01: 6 },
      bossSequence: [
        stage('L1', 1000, 1),
        stage('L2', 3000, 3),
        stage('L3', 2000, 2)
      ],
      damageModel,
      currentTokensByPlayer: { SYNQUEUE01: state.available },
      stageStartSecondsByIndex: starts
    })
    expect(state).toEqual({ available: 3, nextRegenAt: null })
    expect(
      result.stageAssignments.map((entry) =>
        entry.assignments.reduce(
          (sum, assignment) => sum + assignment.tokens,
          0
        )
      )
    ).toEqual([1, 3, 2])
    expect(
      result.stageAssignments.map(
        (entry) => entry.projections.main.projectedRemainingHp
      )
    ).toEqual([0, 0, 0])
    expect(
      verifySavedQueueTemporalAllocation({
        asOfMs: AS_OF_MS,
        seasonEndMs: AS_OF_MS + 72 * HOUR_MS,
        players: [{ playerId: 'SYNQUEUE01', state, usedThisSeason: 1 }],
        stages: result.stageAssignments.map((entry, index) => ({
          stageCode: entry.stageCode,
          loopIndex: entry.loopIndex,
          startSeconds: starts[index],
          allocations: entry.assignments.map(({ playerId, tokens }) => ({
            playerId,
            tokens
          }))
        }))
      })
    ).toEqual({ feasible: false, reason: 'insufficient-tokens' })
  })

  it.each([false, true])(
    'carries the actual two-hour next tick from history (Battle present: %s)',
    (hasBattle) => {
      const asOfMs = SEASON_START_MS + (hasBattle ? 22 : 10) * HOUR_MS
      const state = initialSavedTokenState({
        seasonStartMs: SEASON_START_MS,
        asOfMs,
        battles: hasBattle
          ? [
              {
                displayName: 'Synthetic Planner',
                damageType: 'Battle',
                startedOn: new Date(SEASON_START_MS).toISOString()
              }
            ]
          : []
      })
      expect(state).toEqual({
        available: 2,
        nextRegenAt: asOfMs + 2 * HOUR_MS
      })
      const args = model()
      args.asOfMs = asOfMs
      args.seasonEndMs = asOfMs + 4 * HOUR_MS
      args.players = [{ ...args.players[0], state }]
      args.stages = [{ ...args.stages[0], startSeconds: 7199 }]
      expect(verifySavedQueueTemporalAllocation(args)).toEqual({
        feasible: false,
        reason: 'insufficient-tokens'
      })
      args.stages = [{ ...args.stages[0], startSeconds: 7200 }]
      expect(verifySavedQueueTemporalAllocation(args)).toEqual({
        feasible: true
      })
    }
  )

  it('sums simultaneous boss allocations and does not reuse the bank across stages', () => {
    const args = model()
    args.stages = [
      {
        ...args.stages[0],
        allocations: [
          { playerId: 'SYNQUEUE01', tokens: 2 },
          { playerId: 'SYNQUEUE01', tokens: 1 }
        ]
      },
      {
        stageCode: 'L2',
        loopIndex: 0,
        startSeconds: 0,
        allocations: [{ playerId: 'SYNQUEUE01', tokens: 1 }]
      }
    ]
    expect(verifySavedQueueTemporalAllocation(args)).toEqual({
      feasible: false,
      reason: 'insufficient-tokens'
    })
    args.stages = [
      { ...args.stages[0] },
      { ...args.stages[1], startSeconds: 43200 }
    ]
    expect(verifySavedQueueTemporalAllocation(args)).toEqual({ feasible: true })
  })

  it('does not mutate input token clocks or allocations', () => {
    const args = model()
    const before = structuredClone(args)
    expect(verifySavedQueueTemporalAllocation(args)).toEqual({ feasible: true })
    expect(args).toEqual(before)
  })

  it('refuses season-end equality and a 29th season token', () => {
    const args = model()
    args.players = [{ ...args.players[0], usedThisSeason: 26 }]
    expect(verifySavedQueueTemporalAllocation(args)).toEqual({
      feasible: false,
      reason: 'season-token-limit'
    })
    args.players = [{ ...args.players[0], usedThisSeason: 25 }]
    expect(verifySavedQueueTemporalAllocation(args)).toEqual({ feasible: true })
    args.stages = [{ ...args.stages[0], startSeconds: 72 * 3600 }]
    expect(verifySavedQueueTemporalAllocation(args)).toEqual({
      feasible: false,
      reason: 'outside-season'
    })
  })

  it.each([
    [
      'unknown player',
      { allocations: [{ playerId: 'SYNUNKNOWN', tokens: 1 }] }
    ],
    [
      'negative token count',
      { allocations: [{ playerId: 'SYNQUEUE01', tokens: -1 }] }
    ],
    [
      'fractional token count',
      { allocations: [{ playerId: 'SYNQUEUE01', tokens: 0.5 }] }
    ],
    [
      'nonfinite token count',
      { allocations: [{ playerId: 'SYNQUEUE01', tokens: NaN }] }
    ],
    ['unknown stage', { stageCode: 'L6' }],
    ['untrimmed stage', { stageCode: ' L1' }],
    ['negative loop', { loopIndex: -1 }],
    ['fractional loop', { loopIndex: 0.5 }],
    ['nonfinite loop', { loopIndex: Infinity }],
    ['negative time', { startSeconds: -1 }],
    ['nonfinite time', { startSeconds: NaN }],
    ['sub-millisecond time', { startSeconds: 0.0001 }],
    [
      'too many allocations',
      {
        allocations: Array.from({ length: 91 }, () => ({
          playerId: 'SYNQUEUE01',
          tokens: 0
        }))
      }
    ]
  ])('refuses malformed stage input: %s', (_label, update) => {
    const args = model()
    args.stages = [{ ...args.stages[0], ...update }]
    expect(verifySavedQueueTemporalAllocation(args)).toEqual({
      feasible: false,
      reason: 'invalid-model'
    })
  })

  it.each([
    ['blank ID', { playerId: '' }],
    ['long ID', { playerId: 'S'.repeat(257) }],
    ['untrimmed ID', { playerId: ' SYNQUEUE01' }],
    ['control-character ID', { playerId: 'SYN\nQUEUE01' }],
    [
      'negative bank',
      { state: { available: -1, nextRegenAt: AS_OF_MS + HOUR_MS } }
    ],
    [
      'fractional bank',
      { state: { available: 2.5, nextRegenAt: AS_OF_MS + HOUR_MS } }
    ],
    ['over-cap bank', { state: { available: 4, nextRegenAt: null } }],
    [
      'capped clock',
      { state: { available: 3, nextRegenAt: AS_OF_MS + HOUR_MS } }
    ],
    ['missing partial clock', { state: { available: 2, nextRegenAt: null } }],
    ['past clock', { state: { available: 2, nextRegenAt: AS_OF_MS - 1 } }],
    [
      'late clock',
      { state: { available: 2, nextRegenAt: AS_OF_MS + 13 * HOUR_MS } }
    ],
    [
      'fractional clock',
      { state: { available: 2, nextRegenAt: AS_OF_MS + 0.5 } }
    ],
    ['negative used count', { usedThisSeason: -1 }],
    ['fractional used count', { usedThisSeason: 0.5 }]
  ])('refuses malformed player input: %s', (_label, update) => {
    const args = model()
    args.players = [{ ...args.players[0], ...update }]
    expect(verifySavedQueueTemporalAllocation(args)).toEqual({
      feasible: false,
      reason: 'invalid-model'
    })
  })

  it('refuses duplicate identities, reversed chronology and overflowing array bounds', () => {
    const args = model()
    expect(
      verifySavedQueueTemporalAllocation({
        ...args,
        players: [...args.players, ...args.players]
      })
    ).toEqual({ feasible: false, reason: 'invalid-model' })
    expect(
      verifySavedQueueTemporalAllocation({
        ...args,
        stages: [...args.stages, ...args.stages]
      })
    ).toEqual({ feasible: false, reason: 'invalid-model' })
    expect(
      verifySavedQueueTemporalAllocation({
        ...args,
        stages: [
          { ...args.stages[0], startSeconds: 1 },
          { ...args.stages[0], stageCode: 'L2', startSeconds: 0 }
        ]
      })
    ).toEqual({ feasible: false, reason: 'invalid-model' })
    expect(
      verifySavedQueueTemporalAllocation({
        ...args,
        players: Array.from({ length: 31 }, (_, i) => ({
          ...args.players[0],
          playerId: `SYN${i}`
        }))
      })
    ).toEqual({ feasible: false, reason: 'invalid-model' })
    expect(
      verifySavedQueueTemporalAllocation({
        ...args,
        stages: Array.from({ length: 51 }, (_, i) => ({
          ...args.stages[0],
          loopIndex: i,
          startSeconds: i,
          allocations: []
        }))
      })
    ).toEqual({ feasible: false, reason: 'invalid-model' })
  })

  it('accepts bounded empty allocations, distinct loop identities and millisecond stage times', () => {
    const args = model()
    expect(
      verifySavedQueueTemporalAllocation({
        ...args,
        stages: Array.from({ length: 50 }, (_, i) => ({
          ...args.stages[0],
          loopIndex: i,
          startSeconds: i / 2,
          allocations: []
        }))
      })
    ).toEqual({ feasible: true })
    expect(
      verifySavedQueueTemporalAllocation({
        ...args,
        players: Array.from({ length: 30 }, (_, i) => ({
          ...args.players[0],
          playerId: `SYN${i}`
        })),
        stages: []
      })
    ).toEqual({ feasible: true })
    expect(
      verifySavedQueueTemporalAllocation({
        ...args,
        stages: [
          {
            ...args.stages[0],
            allocations: Array.from({ length: 90 }, () => ({
              playerId: 'SYNQUEUE01',
              tokens: 0
            }))
          }
        ]
      })
    ).toEqual({ feasible: true })
    expect(
      verifySavedQueueTemporalAllocation({
        ...args,
        stages: [
          {
            ...args.stages[0],
            allocations: [{ playerId: 'SYNQUEUE01', tokens: 2 }]
          },
          {
            ...args.stages[0],
            loopIndex: 1,
            startSeconds: 0.5,
            allocations: [{ playerId: 'SYNQUEUE01', tokens: 1 }]
          }
        ]
      })
    ).toEqual({ feasible: true })
  })

  it.each([NaN, Infinity, -1, 8_640_000_000_000_001, AS_OF_MS + 0.5])(
    'refuses an invalid model timestamp %s',
    (asOfMs) => {
      expect(
        verifySavedQueueTemporalAllocation({ ...model(), asOfMs })
      ).toEqual({ feasible: false, reason: 'invalid-model' })
    }
  )

  it('refuses missing arrays and malformed runtime objects instead of throwing', () => {
    for (const args of [
      null,
      {},
      { ...model(), players: null },
      { ...model(), stages: null },
      { ...model(), stages: [{ ...model().stages[0], allocations: null }] },
      { ...model(), players: [null] }
    ]) {
      expect(
        verifySavedQueueTemporalAllocation(
          args as unknown as SavedQueueTemporalInput
        )
      ).toEqual({ feasible: false, reason: 'invalid-model' })
    }
  })

  it('refuses a sub-millisecond projected start that an ISO preview cannot represent', () => {
    const args = model()
    args.asOfMs = 8_000_000_000_000_000
    args.seasonEndMs = args.asOfMs + HOUR_MS
    args.stages = [{ ...args.stages[0], startSeconds: 0.0005 }]
    expect(verifySavedQueueTemporalAllocation(args)).toEqual({
      feasible: false,
      reason: 'invalid-model'
    })
  })

  it.each([
    '2026-02-30T10:00:00Z',
    'invalid',
    '2026-06-02T09:00:00Z',
    '2026-05-20T09:59:59Z'
  ])(
    'refuses malformed or out-of-window imported token time %s',
    (startedOn) => {
      expect(() =>
        initialSavedTokenState({
          seasonStartMs: SEASON_START_MS,
          asOfMs: AS_OF_MS,
          battles: [{ displayName: '', damageType: 'Battle', startedOn }]
        })
      ).toThrow('Invalid saved token history')
    }
  )

  it('accepts database offset instants, ignores bombs for token spend and bounds history', () => {
    expect(
      initialSavedTokenState({
        seasonStartMs: SEASON_START_MS,
        asOfMs: SEASON_START_MS + 10 * HOUR_MS,
        battles: [
          {
            displayName: '',
            damageType: 'Bomb',
            startedOn: '2026-05-20T10:00:00.123456+00:00'
          }
        ]
      })
    ).toEqual({ available: 2, nextRegenAt: SEASON_START_MS + 12 * HOUR_MS })
    expect(() =>
      initialSavedTokenState({
        seasonStartMs: SEASON_START_MS,
        asOfMs: AS_OF_MS,
        battles: Array.from({ length: 10001 }, () => ({
          displayName: '',
          damageType: 'Battle',
          startedOn: '2026-06-01T07:00:00Z'
        }))
      })
    ).toThrow('Invalid saved token history')
  })
})
