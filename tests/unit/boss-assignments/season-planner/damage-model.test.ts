import { describe, expect, it } from 'vitest'
import {
  buildDamageModel,
  estimateDamage
} from '@/app/lib/boss-assignments/season-planner/damage-model'

describe('season planner damage model', () => {
  it('uses player+target history when available', () => {
    const model = buildDamageModel(
      [
        {
          playerId: 'p1',
          bossName: 'RogalDorn',
          encounterId: 0,
          rarity: 'Legendary',
          set: 0,
          startedOn: '2025-01-09T00:00:00.000Z',
          damageDealt: 100
        },
        {
          playerId: 'p1',
          bossName: 'RogalDorn',
          encounterId: 0,
          rarity: 'Legendary',
          set: 0,
          startedOn: '2025-01-10T00:00:00.000Z',
          damageDealt: 200
        }
      ],
      { referenceAt: '2025-01-10T00:00:00.000Z', halfLifeDays: 10 }
    )

    const estimate = estimateDamage(model, {
      playerId: 'p1',
      bossName: 'RogalDorn',
      stageCode: 'L1',
      encounterId: 0
    })

    expect(estimate.source).toBe('player_target')
    expect(estimate.sampleCount).toBe(2)
    expect(estimate.confidence).toBe('medium')
    expect(estimate.expectedDamage).toBeGreaterThan(100)
    expect(estimate.expectedDamage).toBeLessThan(200)
  })

  it('falls back to player-overall before guild-target', () => {
    const model = buildDamageModel(
      [
        {
          playerId: 'p1',
          bossName: 'RogalDorn',
          encounterId: 0,
          rarity: 'Legendary',
          set: 0,
          startedOn: '2025-01-10T00:00:00.000Z',
          damageDealt: 200
        },
        {
          playerId: 'p2',
          bossName: 'SilentKing',
          encounterId: 0,
          rarity: 'Mythic',
          set: 0,
          startedOn: '2025-01-10T00:00:00.000Z',
          damageDealt: 300
        }
      ],
      { referenceAt: '2025-01-10T00:00:00.000Z' }
    )

    const estimate = estimateDamage(model, {
      playerId: 'p2',
      bossName: 'RogalDorn',
      stageCode: 'L1',
      encounterId: 0
    })

    expect(estimate.source).toBe('player_overall')
    expect(estimate.expectedDamage).toBe(300)
  })

  it('returns null expectedDamage with source=no_signal when no history exists', () => {
    // No default: fabricated 0-history scores would leak into the guild mean and solver capacity.
    const model = buildDamageModel([], {
      referenceAt: '2025-01-10T00:00:00.000Z'
    })

    const estimate = estimateDamage(model, {
      playerId: 'p3',
      bossName: 'RogalDorn',
      stageCode: 'L1',
      encounterId: 0
    })

    expect(estimate.source).toBe('no_signal')
    expect(estimate.expectedDamage).toBeNull()
    expect(estimate.confidence).toBe('low')
    expect(estimate.sampleCount).toBe(0)
  })
})
