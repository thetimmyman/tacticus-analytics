import { describe, expect, it } from 'vitest'
import {
  calculateWarStats,
  type WarMatch
} from '@/app/(dashboard)/wars/_components/war-reports-model'

const match = (patch: Partial<WarMatch> = {}): WarMatch => ({
  id: '1',
  war_id: 'war-1',
  opponent_guild_name: 'Opponent',
  war_status: 'completed',
  guild_score: 100,
  opponent_score: 90,
  war_result: 'win',
  war_start_date: '2026-08-17T00:00:00Z',
  war_end_date: '2026-08-19T12:00:00Z',
  war_season: 4,
  battlefield_level: 1,
  raw_loki_data: { warNumber: 3 },
  ...patch
})

describe('war reports model', () => {
  it('summarizes completed results, streak, form, and score differential', () => {
    const stats = calculateWarStats([
      match({ war_end_date: '2026-08-18T00:00:00Z' }),
      match({ war_end_date: '2026-08-17T00:00:00Z', guild_score: 110 }),
      match({
        war_end_date: '2026-08-16T00:00:00Z',
        war_result: 'loss',
        guild_score: 80,
        opponent_score: 100
      })
    ])

    expect(stats).toMatchObject({
      total_wars: 3,
      wars_won: 2,
      wars_lost: 1,
      current_streak: 2,
      streak_type: 'win',
      recent_form: 'WWL',
      avg_score_differential: 3
    })
  })
})
