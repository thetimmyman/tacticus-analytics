import { describe, expect, it } from 'vitest'

import {
  buildBurnStatsLookup,
  buildBurnStatsSummary,
  buildPlayerMembershipMap,
  buildTokenRatioState
} from '@/app/components/performance/hooks/player-performance-data/model'
import { enrichTokenBurnRows } from '@/app/components/performance/hooks/player-performance-data/useTokenBurnRows'

describe('player performance model', () => {
  it('lets a current membership override historical aliases', () => {
    const map = buildPlayerMembershipMap([
      {
        player_id: 'player',
        display_name: 'Same Name',
        is_current: false,
        is_active: false
      },
      {
        player_id: 'player',
        display_name: 'Same Name',
        is_current: true,
        is_active: true
      }
    ])
    expect(map.get('player')).toBe(true)
    expect(map.get('same name')).toBe(true)
  })

  it('builds burn summaries scoped to visible players by stable id first', () => {
    const rows = [
      {
        player_id: 'one',
        display_name: 'Old Name',
        burned_tokens: 3,
        time_over_cap_seconds: 43200
      },
      {
        player_id: 'two',
        display_name: 'Hidden',
        burned_tokens: 9,
        time_over_cap_seconds: 86400
      }
    ]
    const lookup = buildBurnStatsLookup(rows)
    const summary = buildBurnStatsSummary({
      showFiveSeasonAverage: false,
      rows,
      summaries: [{ playerId: 'one', displayName: 'Current Name' }],
      lookup
    })
    expect(summary).toMatchObject({
      hasData: true,
      totalBurnedTokens: 3,
      totalOvercappedTokens: 1,
      playersWithBurnedTokens: 1
    })
    expect(summary.topBurnedPlayers[0]?.displayName).toBe('Current Name')
  })

  it('uses fallback ratios when no RPC rows exist', () => {
    const fallback = {
      max: new Map([['player', 0.7]]),
      average: new Map([['player', 0.5]])
    }
    const state = buildTokenRatioState([], fallback)
    expect(state.mapsByContext.guild.max.get('player')).toBe(0.7)
    expect(state.mapsByContext.cluster.average.get('player')).toBe(0.5)
    expect(state.hasRpc).toEqual({ guild: false, cluster: false })
  })

  it('enriches burn rows from live availability by player id before name', () => {
    const [row] = enrichTokenBurnRows(
      [
        {
          player_id: 'stable',
          display_name: 'Duplicate',
          tokens_used: 1,
          tokens_available: 0,
          token_next_in_seconds: null
        }
      ],
      [
        {
          player_id: 'stable',
          display_name: 'Other',
          tokens_available: 2,
          token_next_in_seconds: 30
        },
        {
          player_id: 'other',
          display_name: 'Duplicate',
          tokens_available: 1,
          token_next_in_seconds: 60
        }
      ]
    )
    expect(row.tokens_available).toBe(2)
    expect(row.token_next_in_seconds).toBe(30)
  })
})
