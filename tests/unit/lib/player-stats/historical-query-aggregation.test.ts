import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createChainedMock,
  createSupabaseMock
} from '@/tests/helpers/supabase-mock'
import { executeBulkQueries } from '@/app/lib/player-stats/build-historical-queries'
import { aggregateSeasonPerformance } from '@/app/lib/player-stats/aggregate-season-performance'
import type { HistoricalDataRow } from '@/app/lib/player-stats/types'

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({ debug: vi.fn(), warn: vi.fn() })
}))

function battle(damageDealt: number, remainingHp: number): HistoricalDataRow {
  return {
    Season: '9999',
    Name: 'SyntheticBoss',
    rarity: 'Legendary',
    set: 0,
    Guild: 'SYN001',
    userId: 'synthetic-player-a',
    damageType: 'Battle',
    damageDealt,
    remainingHp,
    maxHp: 1000
  }
}

async function queryAndAggregate(rows: HistoricalDataRow[]) {
  const client = createSupabaseMock(() => {
    let projection: string[] = []
    const chain = createChainedMock(null, null, ['gt'])
    chain.select.mockImplementation((columns: string) => {
      projection = columns.split(',').map((column) => column.trim())
      return chain
    })
    // PostgREST returns only selected columns, even when another column was filtered.
    chain.then = (
      resolve: (result: {
        data: Record<string, unknown>[]
        error: null
      }) => unknown
    ) =>
      resolve({
        data: rows.map((row) =>
          Object.fromEntries(
            projection.map((column) => [
              column,
              row[column as keyof HistoricalDataRow]
            ])
          )
        ),
        error: null
      })
    return chain
  })
  client.rpc.mockImplementation((name: string) =>
    Promise.resolve({
      data:
        name === 'get_guild_boss_averages_batch'
          ? [
              {
                season: '9999',
                boss_key: ['SyntheticBoss', 'Legendary', '0'].join('_'),
                avg_damage: 100,
                total_damage: 400,
                battle_count: 4
              }
            ]
          : [],
      error: null
    })
  )
  const data = await executeBulkQueries(
    client as unknown as SupabaseClient,
    'synthetic-player-a',
    'SYN001',
    ['SYN001'],
    ['9999'],
    null
  )
  return aggregateSeasonPerformance({
    ...data,
    seasons: ['9999'],
    guildCode: 'SYN001',
    resolvedPlayerId: 'synthetic-player-a'
  })
}

describe('historical query results consumed by season aggregation', () => {
  it('keeps only qualifying sweeps in the performance numerator after projection', async () => {
    const result = await queryAndAggregate([
      battle(100, 900),
      battle(200, 800),
      battle(175, 0),
      battle(50, 0)
    ])

    // Non-sweep average is 150: the 175 sweep qualifies, while the 50 sweep does not.
    expect(result.performanceData['9999'].vsGuild).toBeCloseTo(58.3333333333)
    expect(result.performanceData['9999'].bossDetails?.[0].battles).toBe(3)
    expect(result.historicalTokens['9999']).toBe(4)
    expect(result.historicalTotalDamage['9999']).toBe(131.25)
  })

  it('retains the ordinary two-battle average', async () => {
    const result = await queryAndAggregate([battle(100, 900), battle(200, 800)])
    expect(result.performanceData['9999'].vsGuild).toBe(50)
    expect(result.historicalTokens['9999']).toBe(2)
    expect(result.historicalTotalDamage['9999']).toBe(150)
  })
})
