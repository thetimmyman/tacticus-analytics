import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getActiveProgressionConfig: vi.fn(),
  ensureRotationSnapshot: vi.fn(),
  getAllBossHp: vi.fn(),
  getLatestSeason: vi.fn(),
  getSkippedPrimeEncounters: vi.fn()
}))

vi.mock('@/app/lib/boss-assignments/progression-config', () => ({
  getActiveProgressionConfig: mocks.getActiveProgressionConfig
}))

vi.mock('@/app/lib/loki/rotation-cache', () => ({
  ensureRotationSnapshot: mocks.ensureRotationSnapshot
}))

vi.mock('@/app/lib/data/boss-hp', () => ({
  getAllBossHp: mocks.getAllBossHp
}))

vi.mock('@/app/lib/data/get-latest-season', () => ({
  getLatestSeason: mocks.getLatestSeason
}))

vi.mock('@/app/lib/dashboard/skipped-primes', () => ({
  getSkippedPrimeEncounters: mocks.getSkippedPrimeEncounters
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  })
}))

import { loadBossOverviews } from './boss-metrics'

type QueryResult = { data: unknown; error: null }

function queryChain(result: QueryResult) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'or', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  chain.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject)
  return chain
}

describe('loadBossOverviews progression degradation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getActiveProgressionConfig.mockRejectedValue(
      new Error('No captured progression config')
    )
    mocks.ensureRotationSnapshot.mockResolvedValue({ currentBosses: [] })
    mocks.getAllBossHp.mockResolvedValue({
      legendary: {},
      mythic: {},
      primes: {},
      byBossName: {}
    })
    mocks.getSkippedPrimeEncounters.mockResolvedValue(new Set())
  })

  it('retains the observed defeated boss when config resolution fails', async () => {
    const mainRow = {
      Name: 'Szarekh',
      rarity: 'Legendary',
      set: 2,
      maxHp: 1000,
      remainingHp: 0,
      encounterId: 0,
      completedOn: '2026-08-24T12:00:00Z',
      loopIndex: 0
    }
    const results: QueryResult[] = [
      { data: mainRow, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: [], error: null }
    ]
    const from = vi.fn(() =>
      queryChain(results.shift() ?? { data: [], error: null })
    )

    const result = await loadBossOverviews({ from } as never, 'TEST', '104')

    expect(mocks.getActiveProgressionConfig).toHaveBeenCalledWith('TEST', 104)
    expect(result.current).toEqual(
      expect.objectContaining({
        name: 'Szarekh',
        levelCode: 'L3',
        maxHp: 1000,
        remainingHp: 0,
        hpPercentage: 0
      })
    )
    expect(result.prime1).toBeNull()
    expect(result.prime2).toBeNull()
  })
})
