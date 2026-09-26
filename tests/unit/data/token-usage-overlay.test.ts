import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calculateTokenAvailability,
  MAX_TOKENS
} from '@/app/lib/calculations/token-calculation'

vi.mock('@/app/lib/db', () => ({
  db: vi.fn()
}))

vi.mock('@/app/lib/data/token-usage', () => ({
  getTokenUsage: vi.fn()
}))

// token-calculation is deliberately NOT mocked: the overlay's merge must run the real engine.

const HOUR_MS = 60 * 60 * 1000
const NOW_MS = Date.parse('2026-06-01T00:00:00.000Z')

function isoMinusHours(hours: number): string {
  return new Date(NOW_MS - hours * HOUR_MS).toISOString()
}

describe('getTokenUsageOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_MS))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('normalizes UUID guild identifiers before usage and battle queries', async () => {
    const inputGuild = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF'
    const canonicalGuild = 'abcdefab-cdef-4abc-8def-abcdefabcdef'
    const eq = vi.fn().mockReturnThis()
    const query = {
      select: vi.fn().mockReturnThis(),
      eq,
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [] })
    }
    const mockSupabase = {
      from: vi.fn().mockReturnValue(query)
    }

    const { db } = await import('@/app/lib/db')
    vi.mocked(db).mockResolvedValue(mockSupabase as never)

    const { getTokenUsage } = await import('@/app/lib/data/token-usage')
    vi.mocked(getTokenUsage).mockResolvedValue([
      {
        player_id: 'player-1',
        display_name: 'Player One',
        tokens_used: 12,
        max_possible: 18,
        tokens_below_offender: false,
        tokens_below_abuser: false
      }
    ])

    const { getTokenUsageOverlay } =
      await import('@/app/lib/data/token-usage-overlay')
    await getTokenUsageOverlay(inputGuild, '100')

    expect(getTokenUsage).toHaveBeenCalledWith(canonicalGuild, '100')
    expect(eq).toHaveBeenCalledWith('Guild', canonicalGuild)
  })

  it('overlays the REAL calculated availability per player from live battle rows', async () => {
    const rawBattles = [
      {
        displayName: 'Spender',
        damageType: 'Battle',
        startedOn: isoMinusHours(5)
      },
      {
        displayName: 'Spender',
        damageType: 'Battle',
        startedOn: isoMinusHours(4)
      },
      {
        displayName: 'Spender',
        damageType: 'Battle',
        startedOn: isoMinusHours(3)
      }
    ]

    const order = vi.fn().mockResolvedValue({ data: rawBattles })
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order
    }
    const mockSupabase = { from: vi.fn().mockReturnValue(query) }

    const { db } = await import('@/app/lib/db')
    vi.mocked(db).mockResolvedValue(mockSupabase as never)

    const { getTokenUsage } = await import('@/app/lib/data/token-usage')
    vi.mocked(getTokenUsage).mockResolvedValue([
      {
        player_id: 'p-spender',
        display_name: 'Spender',
        tokens_used: 3,
        max_possible: 18,
        tokens_below_offender: false,
        tokens_below_abuser: false
      },
      {
        player_id: 'p-idler',
        display_name: 'Idler',
        tokens_used: 0,
        max_possible: 18,
        tokens_below_offender: false,
        tokens_below_abuser: false
      }
    ])

    const { getTokenUsageOverlay } =
      await import('@/app/lib/data/token-usage-overlay')
    const rows = await getTokenUsageOverlay('guild-x', '100')

    const spenderExpected = calculateTokenAvailability([
      {
        displayName: 'Spender',
        damageType: 'Battle',
        startedOn: isoMinusHours(5)
      },
      {
        displayName: 'Spender',
        damageType: 'Battle',
        startedOn: isoMinusHours(4)
      },
      {
        displayName: 'Spender',
        damageType: 'Battle',
        startedOn: isoMinusHours(3)
      }
    ])

    const spenderRow = rows.find((r) => r.display_name === 'Spender')
    expect(spenderRow).toBeDefined()
    expect(spenderRow?.tokens_available).toBe(spenderExpected.tokensAvailable)
    expect(spenderRow?.token_next_in_seconds).toBe(
      spenderExpected.tokenNextSeconds ?? null
    )
    expect(spenderRow?.tokens_available).toBe(0)
    expect(spenderRow?.tokens_available).not.toBe(spenderRow?.tokens_used)

    // No battles => full token cap, not the usage row's tokens_used of 0.
    const idlerRow = rows.find((r) => r.display_name === 'Idler')
    expect(idlerRow?.tokens_available).toBe(MAX_TOKENS)
    expect(idlerRow?.token_next_in_seconds).toBeNull()
  })
})
