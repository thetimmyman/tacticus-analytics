import { describe, expect, it } from 'vitest'

import {
  lookupAvgDamageInBucket,
  lookupAvgDamageForPlayer,
  lookupAvgDamageForStage,
  resolveSlotBossNameForStage
} from '@/app/(dashboard)/guild-management/upcoming-assignments/components/queue-helpers'
import type {
  PerformanceData,
  QueueStageEntry
} from '@/app/(dashboard)/guild-management/upcoming-assignments/types'

const stageL4: QueueStageEntry = {
  stageCode: 'L4',
  loopIndex: 0,
  difficulty: 'medium',
  estimatedTokensNeeded: 10,
  isCurrentStage: false,
  mainBoss: 'Magnus',
  prime1Boss: 'Thaumacus',
  prime2Boss: 'Abraxas'
}

const stageM2: QueueStageEntry = {
  stageCode: 'M2',
  loopIndex: 0,
  difficulty: 'hard',
  estimatedTokensNeeded: 12,
  isCurrentStage: true,
  mainBoss: 'Magnus',
  prime1Boss: 'Thaumacus',
  prime2Boss: 'Abraxas'
}

describe('resolveSlotBossNameForStage', () => {
  it('maps _main to the main boss', () => {
    expect(resolveSlotBossNameForStage(stageL4, 'L4_main')).toBe('Magnus')
  })

  it('maps _prime1 / _prime2 to the prime slots', () => {
    expect(resolveSlotBossNameForStage(stageL4, 'L4_prime1')).toBe('Thaumacus')
    expect(resolveSlotBossNameForStage(stageL4, 'L4_prime2')).toBe('Abraxas')
  })

  it('returns null for unknown suffixes', () => {
    expect(resolveSlotBossNameForStage(stageL4, 'L4_somethingelse')).toBeNull()
  })
})

describe('lookupAvgDamageForStage', () => {
  it('returns the exact stage-keyed average when present', () => {
    const performanceData: PerformanceData = {
      TestPlayerA: {
        Magnus_L4: { player_vs_guild_avg: 1, average_damage: 2_500_000 }
      }
    }
    expect(
      lookupAvgDamageForStage(
        stageL4,
        performanceData,
        'TestPlayerA',
        'user-1',
        'L4_main'
      )
    ).toBe(2_500_000)
  })

  it('falls through to bare-name entry when no stage key', () => {
    const performanceData: PerformanceData = {
      TestPlayerA: {
        Magnus: { player_vs_guild_avg: 1, average_damage: 1_200_000 }
      }
    }
    expect(
      lookupAvgDamageForStage(
        stageL4,
        performanceData,
        'TestPlayerA',
        'user-1',
        'L4_main'
      )
    ).toBe(1_200_000)
  })

  it('prefers the stage-keyed average over the bare name (does not collide M2→L4)', () => {
    // Both stages exist in the bucket; L4 lookup must not leak the M2 number.
    const performanceData: PerformanceData = {
      TestPlayerA: {
        Magnus_L4: { player_vs_guild_avg: 0.5, average_damage: 800_000 },
        Magnus_M2: { player_vs_guild_avg: 1.5, average_damage: 5_000_000 }
      }
    }
    expect(
      lookupAvgDamageForStage(
        stageL4,
        performanceData,
        'TestPlayerA',
        'user-1',
        'L4_main'
      )
    ).toBe(800_000)
    expect(
      lookupAvgDamageForStage(
        stageM2,
        performanceData,
        'TestPlayerA',
        'user-1',
        'M2_main'
      )
    ).toBe(5_000_000)
  })

  it('returns null when bucket is missing for the player entirely', () => {
    const performanceData: PerformanceData = {}
    expect(
      lookupAvgDamageForStage(
        stageL4,
        performanceData,
        'TestPlayerA',
        'user-1',
        'L4_main'
      )
    ).toBeNull()
  })

  it('falls back to playerId when displayName is not a bucket key', () => {
    const performanceData: PerformanceData = {
      'user-1': {
        Magnus_L4: { player_vs_guild_avg: 1, average_damage: 999_999 }
      }
    }
    expect(
      lookupAvgDamageForStage(
        stageL4,
        performanceData,
        'NotTheName',
        'user-1',
        'L4_main'
      )
    ).toBe(999_999)
  })

  it('uses fuzzy match to absorb casing/spacing drift in stage-keyed names', () => {
    const performanceData: PerformanceData = {
      TestPlayerA: {
        'Magnus The Red_L4': {
          player_vs_guild_avg: 1,
          average_damage: 1_500_000
        }
      }
    }
    expect(
      lookupAvgDamageForStage(
        stageL4,
        performanceData,
        'TestPlayerA',
        'user-1',
        'L4_main'
      )
    ).toBe(1_500_000)
  })

  it('skips entries whose average_damage is not a positive number', () => {
    const performanceData: PerformanceData = {
      TestPlayerA: {
        Magnus_L4: { player_vs_guild_avg: 0, average_damage: 0 }
      }
    }
    expect(
      lookupAvgDamageForStage(
        stageL4,
        performanceData,
        'TestPlayerA',
        'user-1',
        'L4_main'
      )
    ).toBeNull()
  })

  it('returns null for an unresolvable bossId suffix', () => {
    const performanceData: PerformanceData = {
      TestPlayerA: {
        Magnus_L4: { player_vs_guild_avg: 1, average_damage: 1_000_000 }
      }
    }
    expect(
      lookupAvgDamageForStage(
        stageL4,
        performanceData,
        'TestPlayerA',
        'user-1',
        'L4_unknown'
      )
    ).toBeNull()
  })
})

describe('lookupAvgDamageInBucket', () => {
  it('shares the exact stage → bare → fuzzy stage → fuzzy bare fallback order', () => {
    const bucket: PerformanceData[string] = {
      Magnus_L4: { player_vs_guild_avg: 1, average_damage: 2_500_000 },
      Magnus: { player_vs_guild_avg: 1, average_damage: 1_200_000 }
    }
    expect(lookupAvgDamageInBucket(bucket, 'Magnus', 'L4')).toBe(2_500_000)
  })

  it('returns null for missing or non-positive averages', () => {
    expect(lookupAvgDamageInBucket(undefined, 'Magnus', 'L4')).toBeNull()
    expect(
      lookupAvgDamageInBucket(
        {
          Magnus_L4: { player_vs_guild_avg: 0, average_damage: 0 }
        },
        'Magnus',
        'L4'
      )
    ).toBeNull()
  })
})

describe('lookupAvgDamageForPlayer', () => {
  it('prefers the display-name bucket over the player-id bucket', () => {
    const performanceData: PerformanceData = {
      PlayerName: {
        Magnus_L4: { player_vs_guild_avg: 1, average_damage: 2_000_000 }
      },
      'player-1': {
        Magnus_L4: { player_vs_guild_avg: 1, average_damage: 1_000_000 }
      }
    }

    expect(
      lookupAvgDamageForPlayer(
        performanceData,
        { display_name: 'PlayerName', player_id: 'player-1' },
        'Magnus',
        'L4'
      )
    ).toBe(2_000_000)
  })

  it('falls back to the player-id bucket when display name is absent', () => {
    const performanceData: PerformanceData = {
      'player-1': {
        Magnus_L4: { player_vs_guild_avg: 1, average_damage: 1_000_000 }
      }
    }

    expect(
      lookupAvgDamageForPlayer(
        performanceData,
        { display_name: 'MissingName', player_id: 'player-1' },
        'Magnus',
        'L4'
      )
    ).toBe(1_000_000)
  })

  it('returns null for missing boss or player buckets', () => {
    const performanceData: PerformanceData = {
      'player-1': {
        Magnus_L4: { player_vs_guild_avg: 1, average_damage: 1_000_000 }
      }
    }

    expect(
      lookupAvgDamageForPlayer(
        performanceData,
        { display_name: 'PlayerName', player_id: 'player-1' },
        null,
        'L4'
      )
    ).toBeNull()
    expect(
      lookupAvgDamageForPlayer(
        performanceData,
        { display_name: 'MissingName', player_id: 'missing-player' },
        'Magnus',
        'L4'
      )
    ).toBeNull()
  })
})
