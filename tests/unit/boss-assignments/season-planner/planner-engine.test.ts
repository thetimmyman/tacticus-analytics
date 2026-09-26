import { describe, expect, it } from 'vitest'
import type { ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'
import {
  planSeason,
  type EncounterId,
  type RaidState,
  type StageTemplate
} from '@/app/lib/boss-assignments/season-planner/planner-engine'

const PROGRESSION: ProgressionConfig = {
  firstPassSequence: ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2'],
  loopSequence: ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2'],
  loopStartStage: 'L1',
  gameVersion: 'test-fixture'
}

const makeStageTemplates = (
  maxHpForStage: (stageCode: string, encounterId: EncounterId) => number = (
    _stageCode,
    encounterId
  ) => (encounterId === 0 ? 100 : 0)
): StageTemplate[] =>
  PROGRESSION.firstPassSequence.map((stageCode) => ({
    stageCode,
    encounters: {
      0: {
        bossName: `Boss_${stageCode}`,
        maxHp: maxHpForStage(stageCode, 0)
      },
      1: {
        bossName: `Boss_${stageCode}_Prime1`,
        maxHp: maxHpForStage(stageCode, 1)
      },
      2: {
        bossName: `Boss_${stageCode}_Prime2`,
        maxHp: maxHpForStage(stageCode, 2)
      }
    }
  }))

describe('season planner engine', () => {
  it('spends tokens without wasting regen in a simple fixture', () => {
    const snapshotAt = Date.parse('2025-01-01T00:00:00.000Z')
    const seasonEndAt = Date.parse('2025-01-03T00:00:00.000Z')

    const stageTemplates = makeStageTemplates()

    const initialRaidState: RaidState = {
      stageCode: 'M1',
      loopIndex: 0,
      encounters: {
        0: {
          encounterId: 0,
          stageCode: 'M1',
          loopIndex: 0,
          bossName: 'Boss_M1',
          maxHp: 100,
          remainingHp: 100
        },
        1: {
          encounterId: 1,
          stageCode: 'M1',
          loopIndex: 0,
          bossName: 'Boss_M1_Prime1',
          maxHp: 0,
          remainingHp: 0
        },
        2: {
          encounterId: 2,
          stageCode: 'M1',
          loopIndex: 0,
          bossName: 'Boss_M1_Prime2',
          maxHp: 0,
          remainingHp: 0
        }
      }
    }

    const players = [
      {
        playerId: 'p1',
        displayName: 'Player 1',
        sessionsAt: [snapshotAt, snapshotAt + 86_400_000],
        tokenState: { available: 3, nextRegenAt: null }
      },
      {
        playerId: 'p2',
        displayName: 'Player 2',
        sessionsAt: [snapshotAt, snapshotAt + 86_400_000],
        tokenState: { available: 3, nextRegenAt: null }
      }
    ]

    const result = planSeason({
      players,
      initialRaidState,
      stageTemplates,
      options: {
        snapshotAt,
        seasonEndAt,
        stamina: { max: 3, regenerationSeconds: 43_200, amountPerTick: 1 },
        optionalSpendMinHpMultiplier: 1.25
      },
      estimateDamage: ({ playerId }) => (playerId === 'p1' ? 60 : 30),
      progressionConfig: PROGRESSION
    })

    expect(result.metrics.wastedTokens).toBe(0)
    expect(result.metrics.tokensSpent).toBeGreaterThan(0)
    expect(
      result.sessions.some((s) => s.playerId === 'p1' && s.tokensSpent > 0)
    ).toBe(true)
    expect(
      result.sessions.some((s) => s.playerId === 'p2' && s.tokensSpent > 0)
    ).toBe(true)
    expect(result.metrics.bossesDefeated).toBeGreaterThan(0)
  })

  it('counts and advances a boss cleared by the final planned spend', () => {
    const snapshotAt = Date.parse('2025-01-01T00:00:00.000Z')
    const seasonEndAt = Date.parse('2025-01-02T00:00:00.000Z')
    const stageTemplates = makeStageTemplates()
    const initialRaidState: RaidState = {
      stageCode: 'M1',
      loopIndex: 0,
      encounters: {
        0: {
          encounterId: 0,
          stageCode: 'M1',
          loopIndex: 0,
          bossName: 'Boss_M1',
          maxHp: 100,
          remainingHp: 100
        },
        1: {
          encounterId: 1,
          stageCode: 'M1',
          loopIndex: 0,
          bossName: 'Boss_M1_Prime1',
          maxHp: 0,
          remainingHp: 0
        },
        2: {
          encounterId: 2,
          stageCode: 'M1',
          loopIndex: 0,
          bossName: 'Boss_M1_Prime2',
          maxHp: 0,
          remainingHp: 0
        }
      }
    }

    const result = planSeason({
      players: [
        {
          playerId: 'closer',
          displayName: 'Closer',
          sessionsAt: [snapshotAt],
          tokenState: { available: 1, nextRegenAt: null }
        }
      ],
      initialRaidState,
      stageTemplates,
      options: {
        snapshotAt,
        seasonEndAt,
        stamina: { max: 3, regenerationSeconds: 43_200, amountPerTick: 1 },
        optionalSpendMinHpMultiplier: 1
      },
      estimateDamage: () => 100,
      progressionConfig: PROGRESSION
    })

    expect(result.metrics.tokensSpent).toBe(1)
    expect(result.metrics.bossesDefeated).toBe(1)
    expect(result.finalRaidState.stageCode).not.toBe('M1')
  })

  it('routes required spend to a positive-damage active target', () => {
    const snapshotAt = Date.parse('2025-01-01T00:00:00.000Z')
    const seasonEndAt = Date.parse('2025-01-01T13:00:00.000Z')
    const stageTemplates = makeStageTemplates((_stageCode, encounterId) =>
      encounterId === 2 ? 0 : 100
    )
    const initialRaidState: RaidState = {
      stageCode: 'M1',
      loopIndex: 0,
      encounters: {
        0: {
          encounterId: 0,
          stageCode: 'M1',
          loopIndex: 0,
          bossName: 'Boss_M1',
          maxHp: 100,
          remainingHp: 100
        },
        1: {
          encounterId: 1,
          stageCode: 'M1',
          loopIndex: 0,
          bossName: 'Boss_M1_Prime1',
          maxHp: 100,
          remainingHp: 100
        },
        2: {
          encounterId: 2,
          stageCode: 'M1',
          loopIndex: 0,
          bossName: 'Boss_M1_Prime2',
          maxHp: 0,
          remainingHp: 0
        }
      }
    }

    const result = planSeason({
      players: [
        {
          playerId: 'prime-hitter',
          displayName: 'Prime Hitter',
          sessionsAt: [snapshotAt],
          tokenState: {
            available: 3,
            nextRegenAt: snapshotAt + 43_200_000
          }
        }
      ],
      initialRaidState,
      stageTemplates,
      options: {
        snapshotAt,
        seasonEndAt,
        stamina: { max: 3, regenerationSeconds: 43_200, amountPerTick: 1 },
        optionalSpendMinHpMultiplier: 999
      },
      estimateDamage: ({ encounter }) => (encounter.encounterId === 1 ? 50 : 0),
      progressionConfig: PROGRESSION
    })

    expect(result.sessions[0]?.actions).toHaveLength(1)
    expect(result.sessions[0]?.actions[0]?.encounterId).toBe(1)
    expect(result.sessions[0]?.actions[0]?.expectedDamage).toBe(50)
  })

  it('honors tokens already spent against the season token cap', () => {
    const snapshotAt = Date.parse('2025-01-01T00:00:00.000Z')
    const seasonEndAt = Date.parse('2025-01-02T00:00:00.000Z')
    const stageTemplates = makeStageTemplates()
    const initialRaidState: RaidState = {
      stageCode: 'M1',
      loopIndex: 0,
      encounters: {
        0: {
          encounterId: 0,
          stageCode: 'M1',
          loopIndex: 0,
          bossName: 'Boss_M1',
          maxHp: 100,
          remainingHp: 100
        },
        1: {
          encounterId: 1,
          stageCode: 'M1',
          loopIndex: 0,
          bossName: 'Boss_M1_Prime1',
          maxHp: 0,
          remainingHp: 0
        },
        2: {
          encounterId: 2,
          stageCode: 'M1',
          loopIndex: 0,
          bossName: 'Boss_M1_Prime2',
          maxHp: 0,
          remainingHp: 0
        }
      }
    }

    const result = planSeason({
      players: [
        {
          playerId: 'capped',
          displayName: 'Capped Player',
          sessionsAt: [snapshotAt],
          tokenState: { available: 3, nextRegenAt: null },
          seasonSpent: 28
        }
      ],
      initialRaidState,
      stageTemplates,
      options: {
        snapshotAt,
        seasonEndAt,
        stamina: { max: 3, regenerationSeconds: 43_200, amountPerTick: 1 },
        optionalSpendMinHpMultiplier: 1.25,
        seasonMaxTokens: 28
      },
      estimateDamage: () => 1_000,
      progressionConfig: PROGRESSION
    })

    expect(result.metrics.tokensSpent).toBe(0)
    expect(result.metrics.bossesDefeated).toBe(0)
    expect(result.sessions[0]?.tokensHeld).toBe(3)
  })
})
