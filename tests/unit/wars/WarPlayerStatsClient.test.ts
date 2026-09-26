import { describe, expect, it } from 'vitest'

import { buildGuildSummary } from '@/app/(dashboard)/wars/_components/WarPlayerStatsClient'
import type { PlayerStats } from '@/app/(dashboard)/wars/_types'

function player(overrides: {
  playerId: string
  attacks?: Partial<PlayerStats['attacks']>
  defenses?: Partial<PlayerStats['defenses']>
}): PlayerStats {
  return {
    playerId: overrides.playerId,
    playerName: overrides.playerId,
    attacks: {
      total: 0,
      wins: 0,
      losses: 0,
      points: 0,
      perfect: 0,
      winRate: 0,
      ...overrides.attacks
    },
    defenses: {
      total: 0,
      holds: 0,
      breaches: 0,
      conceded: 0,
      holdRate: 0,
      ...overrides.defenses
    }
  }
}

describe('buildGuildSummary (WI-6270)', () => {
  it('weights rates by attempt counts, not a mean of per-player rates', () => {
    // Weighted gives 8/10 and 1/4; a per-player mean would give 40 and 12.5.
    const rows = [
      player({
        playerId: 'attacker',
        attacks: { total: 10, wins: 8, winRate: 80, points: 5000 }
      }),
      player({
        playerId: 'pure-defender',
        defenses: {
          total: 4,
          holds: 1,
          breaches: 3,
          conceded: 900,
          holdRate: 25
        }
      })
    ]

    const summary = buildGuildSummary(rows, 'Your Guild')

    expect(summary.winRate).toBe(80)
    expect(summary.holdRate).toBe(25)
    expect(summary.totalAttacks).toBe(10)
    expect(summary.totalDefenses).toBe(4)
    expect(summary.totalConceded).toBe(900)
  })

  it('attack-only and defense-only rows do not dilute the other rate', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) =>
        player({
          playerId: `attacker-${i}`,
          attacks: { total: 2, wins: 1, winRate: 50 }
        })
      ),
      player({
        playerId: 'defender',
        defenses: { total: 2, holds: 2, holdRate: 100 }
      })
    ]

    const summary = buildGuildSummary(rows, 'Your Guild')

    expect(summary.holdRate).toBe(100)
    expect(summary.winRate).toBe(50)
  })

  it('empty roster produces zero rates, not NaN', () => {
    const summary = buildGuildSummary([], 'Your Guild')
    expect(summary.winRate).toBe(0)
    expect(summary.holdRate).toBe(0)
  })
})
