import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockDb: vi.fn(),
  mockGetCurrentDisplayName: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({
  db: mocks.mockDb
}))

vi.mock('@/app/lib/utils/player-resolution', () => ({
  getCurrentDisplayName: mocks.mockGetCurrentDisplayName
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    error: vi.fn(),
    warn: vi.fn()
  })
}))

describe('getComprehensiveHistoricalPerformance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses one batch player_mapping query for unambiguous current display names', async () => {
    const battleRows = [
      {
        Season: '100',
        userId: 'player-1',
        displayName: 'Old One',
        Name: 'Boss A',
        damageDealt: 120,
        rarity: 'Legendary',
        encounterId: 'enc-1',
        damageType: 'Battle',
        remainingHp: 1000,
        maxHp: 2000
      },
      {
        Season: '100',
        userId: 'player-2',
        displayName: 'Old Two',
        Name: 'Boss A',
        damageDealt: 80,
        rarity: 'Legendary',
        encounterId: 'enc-2',
        damageType: 'Battle',
        remainingHp: 1000,
        maxHp: 2000
      }
    ]

    const eotQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: battleRows, error: null })
    }
    const mappingQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [
          { player_id: 'player-1', display_name: 'Current One' },
          { player_id: 'player-2', display_name: 'Current Two' }
        ],
        error: null
      })
    }
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'EOT_GR_data') return eotQuery
        if (table === 'player_mapping') return mappingQuery
        throw new Error(`unexpected table ${table}`)
      })
    }
    mocks.mockDb.mockResolvedValue(supabase)

    const { getComprehensiveHistoricalPerformance } =
      await import('@/app/lib/data/historical-boss-performance')

    const result = await getComprehensiveHistoricalPerformance('GUILD1')

    expect(result['player-1']?.['Boss A']).toBeCloseTo(20)
    expect(result['player-2']?.['Boss A']).toBeCloseTo(-20)
    expect(supabase.from).toHaveBeenCalledWith('player_mapping')
    expect(mappingQuery.in).toHaveBeenCalledWith('player_id', [
      'player-1',
      'player-2'
    ])
    expect(mocks.mockGetCurrentDisplayName).not.toHaveBeenCalled()
  })

  it('falls back to per-player resolution when the current mapping is ambiguous', async () => {
    const battleRows = [
      {
        Season: '100',
        userId: 'player-1',
        displayName: 'Battle Name',
        Name: 'Boss A',
        damageDealt: 100,
        rarity: 'Legendary',
        encounterId: 'enc-1',
        damageType: 'Battle',
        remainingHp: 1000,
        maxHp: 2000
      }
    ]

    const eotQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: battleRows, error: null })
    }
    const mappingQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [
          { player_id: 'player-1', display_name: 'First Current' },
          { player_id: 'player-1', display_name: 'Second Current' }
        ],
        error: null
      })
    }
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'EOT_GR_data') return eotQuery
        if (table === 'player_mapping') return mappingQuery
        throw new Error(`unexpected table ${table}`)
      })
    }
    mocks.mockDb.mockResolvedValue(supabase)
    mocks.mockGetCurrentDisplayName.mockResolvedValue('Resolved Fallback')

    const { getComprehensiveHistoricalPerformance } =
      await import('@/app/lib/data/historical-boss-performance')

    await getComprehensiveHistoricalPerformance('GUILD1')

    expect(mocks.mockGetCurrentDisplayName).toHaveBeenCalledTimes(1)
    expect(mocks.mockGetCurrentDisplayName).toHaveBeenCalledWith(
      supabase,
      'player-1'
    )
  })
})
