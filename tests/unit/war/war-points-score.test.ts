import { describe, expect, it } from 'vitest'
import {
  buildWarPointsScore,
  type AttemptRow,
  type WarMember
} from '@/app/(dashboard)/wars/_components/_hooks/useWarAnalyticsData'

function attempt(over: Partial<AttemptRow>): AttemptRow {
  return {
    war_id: 'w1',
    player_id: 'A',
    player_name: 'SharedName',
    is_guild_member: true,
    zone_id: 'z1',
    damage_dealt: 100,
    score_earned: 100,
    attempt_result: 'win',
    attempt_status: 'completed',
    buffs: null,
    raw_loki_data: null,
    attacker_units_json: null,
    defender_units_json: [{ remainingHPAfter: 0 }],
    attacker_units_lost: 0,
    attempt_end_time: '2026-01-01T00:00:00Z',
    ...over
  }
}

describe('buildWarPointsScore — keyed by player_id, not display name', () => {
  it('keeps same-named members as SEPARATE rows', () => {
    const attempts: AttemptRow[] = [
      attempt({ player_id: 'A', attempt_end_time: '2026-01-01T00:00:01Z' }),
      attempt({ player_id: 'A', attempt_end_time: '2026-01-01T00:00:02Z' }),
      attempt({ player_id: 'B', attempt_end_time: '2026-01-01T00:00:03Z' })
    ]
    const members: WarMember[] = [
      { playerId: 'A', label: 'SharedName (g_01)' },
      { playerId: 'B', label: 'SharedName (g_02)' }
    ]

    const { players } = buildWarPointsScore(attempts, members)

    expect(players).toHaveLength(2)
    const byId = new Map(players.map((p) => [p.playerId, p]))
    expect(byId.get('A')?.attempts).toBe(2)
    expect(byId.get('B')?.attempts).toBe(1)
    expect(byId.get('A')?.player).toBe('SharedName (g_01)')
    expect(byId.get('B')?.player).toBe('SharedName (g_02)')
  })

  it('does NOT sum distinct players who share a raw name', () => {
    const attempts: AttemptRow[] = [
      attempt({ player_id: 'A', attempt_end_time: '2026-01-01T00:00:01Z' }),
      attempt({ player_id: 'B', attempt_end_time: '2026-01-01T00:00:02Z' })
    ]
    const { players } = buildWarPointsScore(attempts, [])
    // A perfect oneshot is +7 atk; collapsed rows would show 14.
    expect(players.every((p) => p.atk === 7)).toBe(true)
    expect(players).toHaveLength(2)
  })

  it('adds absentee zero-rows per member id, not per name', () => {
    const attempts: AttemptRow[] = [attempt({ player_id: 'A' })]
    const members: WarMember[] = [
      { playerId: 'A', label: 'SharedName (g_01)' },
      { playerId: 'B', label: 'SharedName (g_02)' },
      { playerId: 'C', label: 'Someone Else' }
    ]
    const { players } = buildWarPointsScore(attempts, members)
    expect(players).toHaveLength(3)
    const absentees = players.filter((p) => p.attempts === 0)
    expect(absentees.map((p) => p.playerId).sort()).toEqual(['B', 'C'])
  })

  it('falls back to the raw battle name for ex-members off the roster', () => {
    const attempts: AttemptRow[] = [
      attempt({ player_id: 'X', player_name: 'GhostMember' })
    ]
    const { players } = buildWarPointsScore(attempts, [])
    expect(players).toHaveLength(1)
    expect(players[0]?.playerId).toBe('X')
    expect(players[0]?.player).toBe('GhostMember')
  })

  it('all-absent (no guild attempts) still keys zero-rows by id', () => {
    const members: WarMember[] = [
      { playerId: 'A', label: 'SharedName (g_01)' },
      { playerId: 'B', label: 'SharedName (g_02)' }
    ]
    const { players, totalAttempts } = buildWarPointsScore([], members)
    expect(totalAttempts).toBe(0)
    expect(players.map((p) => p.playerId).sort()).toEqual(['A', 'B'])
  })
})
