import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getGuildTokenPerformance,
  type DamageRow
} from '@/app/lib/data/guild-token-performance'

const io = vi.hoisted(() => ({
  db: vi.fn(() => {
    throw new Error('Unexpected database access')
  }),
  bossHp: vi.fn(() => {
    throw new Error('Unexpected boss HP load')
  }),
  fetch: vi.fn(() => {
    throw new Error('Unexpected network access')
  })
}))

vi.mock('@/app/lib/db', () => ({ db: io.db }))
vi.mock('@/app/lib/data/boss-hp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/data/boss-hp')>()),
  getAllBossHp: io.bossHp
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', io.fetch)
})

afterEach(() => {
  try {
    expect(io.db).not.toHaveBeenCalled()
    expect(io.bossHp).not.toHaveBeenCalled()
    expect(io.fetch).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

const firstAttack: DamageRow = {
  displayName: 'Synthetic Twin',
  userId: 'SYN-PERF-A',
  Name: 'Riptide',
  set: 0,
  damageDealt: 1000000,
  remainingHp: 4000000,
  maxHp: 5000000,
  Season: '101',
  rarity: 'Legendary',
  loopIndex: 0,
  encounterId: 0
}

const secondAttack: DamageRow = {
  ...firstAttack,
  userId: 'SYN-PERF-B',
  damageDealt: 2000000,
  remainingHp: 2000000
}

function calculate(
  damageData: DamageRow[],
  currentNames: string[],
  includeHistoricalPlayers = false
) {
  return getGuildTokenPerformance('SYN-PERF', {
    seasonOverride: '101',
    includePerLoop: true,
    includeHistoricalPlayers,
    prefetched: {
      damageData,
      mostRecentSeasonPerBoss: { Riptide: '101' },
      bossHpData: { byBossName: { Riptide_L1: 5000000 } },
      activeCurrentPlayers: new Set(currentNames),
      officerTargetsByBossKey: { Riptide_L1_0: 4 }
    }
  })
}

describe('current-roster token performance uses stable player identity', () => {
  it('retains the canonical ID-keyed historical option and unchanged score math', async () => {
    const performance = await calculate(
      [firstAttack, secondAttack],
      ['synthetic twin'],
      true
    )

    expect(Object.keys(performance).sort()).toEqual([
      'SYN-PERF-A',
      'SYN-PERF-B'
    ])
    expect(performance['SYN-PERF-A']?.Riptide_L1).toMatchObject({
      playerId: 'SYN-PERF-A',
      tokensSpent: 1,
      actualDamage: 1000000,
      expectedDamage: 1250000,
      score: 0.8,
      tier: 'officer_target'
    })
    expect(performance['SYN-PERF-B']?.Riptide_L1).toMatchObject({
      playerId: 'SYN-PERF-B',
      tokensSpent: 1,
      actualDamage: 2000000,
      expectedDamage: 1250000,
      score: 1.6,
      tier: 'officer_target'
    })
  })
})
