import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchBossLeaderboardSummary } from '@/app/api/discord/interactions/command-handlers/handlers/boss/data'

const mocks = vi.hoisted(() => ({
  loadActiveRoster: vi.fn(),
  isPlayerInRoster: vi.fn()
}))

vi.mock(
  '@/app/api/discord/interactions/command-handlers/utils/player-resolution',
  () => ({
    loadActiveRoster: mocks.loadActiveRoster,
    isPlayerInRoster: mocks.isPlayerInRoster
  })
)

type Row = {
  displayName: string
  userId: string
  Name: string
  damageDealt: number
  remainingHp: number
  maxHp: number
  tier: number
  loopIndex: number
  rarity: string
  set: number
}

const row = (overrides: Partial<Row>): Row => ({
  displayName: 'Alpha',
  userId: 'user-alpha',
  Name: 'Szarekh',
  damageDealt: 1_000_000,
  remainingHp: 500_000,
  maxHp: 30_000_000,
  tier: 4,
  loopIndex: 0,
  rarity: 'Legendary',
  set: 0,
  ...overrides
})

function supabaseWithRows(rows: Row[]) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null })
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order
  }
  return { from: vi.fn().mockReturnValue(chain) } as never
}

describe('fetchBossLeaderboardSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadActiveRoster.mockResolvedValue({ ok: true, roster: {} })
    mocks.isPlayerInRoster.mockReturnValue(true)
  })

  it('excludes sweeps and crashes from the displayed average but keeps raw totals', async () => {
    const rows = [
      row({ damageDealt: 1_000_000, remainingHp: 500_000 }),
      row({ damageDealt: 1_200_000, remainingHp: 300_000 }),
      // Sweep: a killing blow on a pre-damaged boss is not a fair per-token sample.
      row({ damageDealt: 200_000, remainingHp: 0 }),
      row({ damageDealt: 0, remainingHp: 500_000 })
    ]

    const result = await fetchBossLeaderboardSummary(supabaseWithRows(rows), {
      guild: 'EOT',
      season: '86'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const entry = result.summary.leaderboard[0]!
    expect(entry.averageDamage).toBe(1_100_000)
    expect(entry.totalDamage).toBe(2_400_000)
    expect(entry.attempts).toBe(4)
    expect(result.summary.totalDamage).toBe(2_400_000)
  })

  it('keeps one-shots in the average', async () => {
    const rows = [
      row({ damageDealt: 1_000_000, remainingHp: 500_000 }),
      row({ damageDealt: 30_000_000, remainingHp: 0, maxHp: 30_000_000 })
    ]

    const result = await fetchBossLeaderboardSummary(supabaseWithRows(rows), {
      guild: 'EOT',
      season: '86'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.leaderboard[0]!.averageDamage).toBe(15_500_000)
  })
})
