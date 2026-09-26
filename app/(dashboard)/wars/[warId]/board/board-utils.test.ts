import { describe, it, expect } from 'vitest'
import type { PlayerStats, WarInfo } from '../../_types'
import {
  GUILD_MAX_TOKENS,
  WAR_ROSTER_SIZE,
  buildBoardSides,
  captureScoreCap,
  computeTotals,
  rankPlayers,
  resolveOutcome,
  type WarBattleRosterRow
} from './board-utils'

function battle(
  overrides: Partial<WarBattleRosterRow> = {}
): WarBattleRosterRow {
  return {
    attacker_player_id: null,
    attacker_player_name: null,
    defender_player_id: null,
    defender_player_name: null,
    is_guild_member: null,
    score_earned: 0,
    ...overrides
  }
}

function player(name: string, total: number, points: number): PlayerStats {
  return {
    playerId: `id-${name}`,
    playerName: name,
    attacks: {
      total,
      wins: 0,
      losses: 0,
      points,
      perfect: 0,
      failed: 0,
      winRate: 0,
      avgScore: 0
    },
    defenses: { total: 0, holds: 0, breaches: 0, conceded: 0, holdRate: 0 }
  }
}

function war(overrides: Partial<WarInfo> = {}): WarInfo {
  return {
    warId: 'w1',
    warSlug: 'a-vs-b',
    status: 'completed',
    startTime: '2026-06-01T00:00:00Z',
    guild: {
      guildCode: 'GK',
      guildName: 'Grey Knights',
      guildTag: 'GK',
      score: 0
    },
    opponent: { guildName: 'Iron Hydras', guildTag: 'IH', score: 0 },
    ...overrides
  }
}

describe('board-utils constants', () => {
  it('encodes the 30v30 / 10-token guild war cap', () => {
    expect(WAR_ROSTER_SIZE).toBe(30)
    expect(GUILD_MAX_TOKENS).toBe(300)
  })
})

describe('computeTotals', () => {
  it('sums tokens and score and averages over the 30-slot roster (not participant count)', () => {
    // 3 participants, but averages still divide by 30 like the in-game board.
    const players = [
      player('a', 10, 15_000),
      player('b', 10, 12_000),
      player('c', 8, 9_000)
    ]
    const t = computeTotals(players)
    expect(t.totalTokens).toBe(28)
    expect(t.totalScore).toBe(36_000)
    expect(t.participantCount).toBe(3)
    expect(t.avgTokens).toBeCloseTo(28 / 30, 5)
    expect(t.avgScore).toBeCloseTo(36_000 / 30, 5)
  })

  it('percent of used tokens is measured against the 300 cap', () => {
    const players = Array.from({ length: 30 }, (_, i) =>
      player(`p${i}`, 10, 100)
    )
    expect(computeTotals(players).pctUsed).toBe(100)
    expect(computeTotals([player('x', 9, 50)]).pctUsed).toBe(3) // 9/300 = 3%
  })

  it('handles an empty side without dividing by zero', () => {
    const t = computeTotals([])
    expect(t.totalTokens).toBe(0)
    expect(t.totalScore).toBe(0)
    expect(t.avgTokens).toBe(0)
    expect(t.avgScore).toBe(0)
    expect(t.pctUsed).toBe(0)
  })
})

describe('rankPlayers', () => {
  it('orders by score desc, then tokens desc, then name', () => {
    const players = [
      player('zeb', 5, 5_000),
      player('alpha', 10, 14_600), // tie on score with beta
      player('beta', 9, 14_600),
      player('gamma', 10, 15_000)
    ]
    const ranked = rankPlayers(players).map((p) => p.playerName)
    // gamma (15000) > alpha & beta (14600, alpha has more tokens) > zeb (5000)
    expect(ranked).toEqual(['gamma', 'alpha', 'beta', 'zeb'])
  })

  it('does not mutate the input array', () => {
    const players = [player('a', 1, 1), player('b', 2, 2)]
    const copy = [...players]
    rankPlayers(players)
    expect(players).toEqual(copy)
  })
})

describe('resolveOutcome', () => {
  it('prefers the authoritative war.result over score comparison', () => {
    // result=draw wins over unequal stored scores.
    expect(
      resolveOutcome(
        war({
          result: 'draw',
          guild: {
            guildCode: 'GK',
            guildName: 'GK',
            guildTag: 'GK',
            score: 700
          },
          opponent: { guildName: 'IH', guildTag: 'IH', score: 500 }
        })
      )
    ).toBe('draw')
    expect(resolveOutcome(war({ result: 'win' }))).toBe('guild')
    expect(resolveOutcome(war({ result: 'loss' }))).toBe('opponent')
  })

  it('falls back to scores when result is not recorded', () => {
    expect(
      resolveOutcome(
        war({
          result: null,
          guild: {
            guildCode: 'GK',
            guildName: 'GK',
            guildTag: 'GK',
            score: 736
          },
          opponent: { guildName: 'IH', guildTag: 'IH', score: 520 }
        })
      )
    ).toBe('guild')
    expect(
      resolveOutcome(
        war({
          guild: {
            guildCode: 'GK',
            guildName: 'GK',
            guildTag: 'GK',
            score: 100
          },
          opponent: { guildName: 'IH', guildTag: 'IH', score: 200 }
        })
      )
    ).toBe('opponent')
    expect(
      resolveOutcome(
        war({
          guild: {
            guildCode: 'GK',
            guildName: 'GK',
            guildTag: 'GK',
            score: 50
          },
          opponent: { guildName: 'IH', guildTag: 'IH', score: 50 }
        })
      )
    ).toBe('draw')
  })

  it('returns pending for non-completed wars', () => {
    expect(resolveOutcome(war({ status: 'in_progress', result: null }))).toBe(
      'pending'
    )
    expect(resolveOutcome(war({ status: 'scheduled' }))).toBe('pending')
  })
})

describe('buildBoardSides', () => {
  it('aggregates a guild attacker: tokens = attack count, score = sum(score_earned)', () => {
    const rows = [
      battle({
        attacker_player_id: 'p1',
        attacker_player_name: 'TestPlayerA',
        is_guild_member: true,
        score_earned: 1500
      }),
      battle({
        attacker_player_id: 'p1',
        attacker_player_name: 'TestPlayerA',
        is_guild_member: true,
        score_earned: 1400
      })
    ]
    const { guild, opponent } = buildBoardSides(rows)
    expect(opponent).toHaveLength(0)
    expect(guild).toHaveLength(1)
    expect(guild[0]).toMatchObject({
      playerId: 'p1',
      playerName: 'TestPlayerA',
      isGuildMember: true,
      attacks: { total: 2, points: 2900 }
    })
  })

  it('recovers a defender who never attacked (zero tokens) on the opposite side', () => {
    // Spoon only defended; the union keeps them at 0 tokens.
    const rows = [
      battle({
        attacker_player_id: 'opp1',
        attacker_player_name: 'Hotshot',
        is_guild_member: false,
        defender_player_id: 'g1',
        defender_player_name: 'Spoon',
        score_earned: 900
      })
    ]
    const { guild, opponent } = buildBoardSides(rows)
    expect(opponent).toHaveLength(1)
    expect(opponent[0]).toMatchObject({
      playerId: 'opp1',
      attacks: { total: 1, points: 900 }
    })
    expect(guild).toHaveLength(1)
    expect(guild[0]).toMatchObject({
      playerId: 'g1',
      playerName: 'Spoon',
      isGuildMember: true,
      attacks: { total: 0, points: 0 }
    })
  })

  it('places opponent attackers and the members they hit on the correct sides', () => {
    // The opponent defender is recovered on the opponent side with 0 tokens.
    const rows = [
      battle({
        attacker_player_id: 'g1',
        attacker_player_name: 'Maldir',
        is_guild_member: true,
        defender_player_id: 'opp9',
        defender_player_name: 'Rivalus',
        score_earned: 1200
      })
    ]
    const { guild, opponent } = buildBoardSides(rows)
    expect(guild).toHaveLength(1)
    expect(guild[0]).toMatchObject({
      playerId: 'g1',
      attacks: { total: 1, points: 1200 }
    })
    expect(opponent).toHaveLength(1)
    expect(opponent[0]).toMatchObject({
      playerId: 'opp9',
      attacks: { total: 0 }
    })
  })

  it('does not double-count a player who both attacked and defended', () => {
    const rows = [
      battle({
        attacker_player_id: 'g1',
        attacker_player_name: 'Maldir',
        is_guild_member: true,
        score_earned: 1000
      }),
      // Same member defending later must stay one row.
      battle({
        attacker_player_id: 'opp2',
        attacker_player_name: 'Raider',
        is_guild_member: false,
        defender_player_id: 'g1',
        defender_player_name: 'Maldir',
        score_earned: 800
      })
    ]
    const { guild } = buildBoardSides(rows)
    const maldir = guild.filter((p) => p.playerId === 'g1')
    expect(maldir).toHaveLength(1)
    expect(maldir[0]!.attacks).toMatchObject({ total: 1, points: 1000 })
  })

  it('treats a null is_guild_member attacker as opponent (defender as guild)', () => {
    const rows = [
      battle({
        attacker_player_id: 'opp3',
        attacker_player_name: 'Invader',
        is_guild_member: null,
        defender_player_id: 'g5',
        defender_player_name: 'Keeper',
        score_earned: 700
      })
    ]
    const { guild, opponent } = buildBoardSides(rows)
    expect(opponent.map((p) => p.playerId)).toEqual(['opp3'])
    expect(guild.map((p) => p.playerId)).toEqual(['g5'])
  })

  it('splits the same id across sides on the is_guild_member axis (RPC GROUP-BY parity)', () => {
    // Mirrors get_war_player_stats grouping by (attacker_player_id, is_guild_member).
    const rows = [
      battle({
        attacker_player_id: 'x',
        attacker_player_name: 'X',
        is_guild_member: true,
        score_earned: 100
      }),
      battle({
        attacker_player_id: 'x',
        attacker_player_name: 'X',
        is_guild_member: false,
        score_earned: 200
      })
    ]
    const { guild, opponent } = buildBoardSides(rows)
    expect(guild).toHaveLength(1)
    expect(opponent).toHaveLength(1)
    expect(guild[0]!.attacks).toMatchObject({ total: 1, points: 100 })
    expect(opponent[0]!.attacks).toMatchObject({ total: 1, points: 200 })
  })

  it('ignores rows with empty/blank player ids', () => {
    const rows = [
      battle({
        attacker_player_id: '',
        attacker_player_name: 'ghost',
        is_guild_member: true
      }),
      battle({ attacker_player_id: '   ', is_guild_member: true }),
      battle({
        defender_player_id: null,
        attacker_player_id: 'g1',
        attacker_player_name: 'Real',
        is_guild_member: true,
        score_earned: 5
      })
    ]
    const { guild, opponent } = buildBoardSides(rows)
    expect(opponent).toHaveLength(0)
    expect(guild).toHaveLength(1)
    expect(guild[0]!.playerId).toBe('g1')
  })

  it('strips the zone-capture bonus from a capturing attack (WI-1571)', () => {
    // 9 normal 1600 attacks + a capture (41600) whose ~40k zone bonus belongs to the guild total.
    const rows: WarBattleRosterRow[] = []
    for (let i = 0; i < 9; i += 1) {
      rows.push(
        battle({
          attacker_player_id: 'cap',
          attacker_player_name: 'Capper',
          is_guild_member: true,
          score_earned: 1600
        })
      )
    }
    rows.push(
      battle({
        attacker_player_id: 'cap',
        attacker_player_name: 'Capper',
        is_guild_member: true,
        score_earned: 41600
      })
    )
    for (let i = 0; i < 10; i += 1) {
      rows.push(
        battle({
          attacker_player_id: 'chip',
          attacker_player_name: 'Chipper',
          is_guild_member: true,
          score_earned: 1500
        })
      )
    }

    const { guild } = buildBoardSides(rows)
    const capper = guild.find((p) => p.playerId === 'cap')!
    const chipper = guild.find((p) => p.playerId === 'chip')!

    // Raw sum 56000; capping the capture at 1600 strips the bonus -> 16000.
    expect(capper.attacks.total).toBe(10)
    expect(capper.attacks.points).toBe(16_000)
    expect(chipper.attacks.points).toBe(15_000)
  })
})

describe('captureScoreCap (WI-1571)', () => {
  it('detects the per-lineup cap as the lower edge of the capture-bonus gap', () => {
    const normals = Array.from({ length: 20 }, () => 1600)
    const captures = [15_050, 19_800, 41_600]
    expect(captureScoreCap([...normals, ...captures])).toBe(1600)
  })

  it('returns Infinity when there are no capture outliers', () => {
    expect(captureScoreCap([1600, 1500, 1400, 1600, 1200, 900])).toBe(
      Number.POSITIVE_INFINITY
    )
  })

  it('does not treat small within-normal variation as a capture gap', () => {
    expect(captureScoreCap([400, 450, 600, 850, 1400, 1600])).toBe(
      Number.POSITIVE_INFINITY
    )
  })

  it('does not cap when too few battles to distinguish a gap', () => {
    expect(captureScoreCap([1500, 41_600])).toBe(Number.POSITIVE_INFINITY)
  })

  it('does not flag a big cluster (>40% above the gap) as captures', () => {
    // Half the battles are "high": not a sparse minority, so no cap.
    expect(captureScoreCap([400, 400, 400, 1400, 1400, 1400])).toBe(
      Number.POSITIVE_INFINITY
    )
  })

  it('strips the zone-capture bonus from a capturing attack (WI-1571)', () => {
    const rows: WarBattleRosterRow[] = []
    for (let i = 0; i < 9; i += 1) {
      rows.push(
        battle({
          attacker_player_id: 'cap',
          attacker_player_name: 'Capper',
          is_guild_member: true,
          score_earned: 1600
        })
      )
    }
    rows.push(
      battle({
        attacker_player_id: 'cap',
        attacker_player_name: 'Capper',
        is_guild_member: true,
        score_earned: 41600
      })
    )
    for (let i = 0; i < 10; i += 1) {
      rows.push(
        battle({
          attacker_player_id: 'chip',
          attacker_player_name: 'Chipper',
          is_guild_member: true,
          score_earned: 1500
        })
      )
    }

    const { guild } = buildBoardSides(rows)
    const capper = guild.find((p) => p.playerId === 'cap')!
    const chipper = guild.find((p) => p.playerId === 'chip')!

    expect(capper.attacks.total).toBe(10)
    expect(capper.attacks.points).toBe(16_000)
    expect(chipper.attacks.points).toBe(15_000)
  })
})

describe('captureScoreCap (WI-1571)', () => {
  it('detects the per-lineup cap as the lower edge of the capture-bonus gap', () => {
    const normals = Array.from({ length: 20 }, () => 1600)
    const captures = [15_050, 19_800, 41_600]
    expect(captureScoreCap([...normals, ...captures])).toBe(1600)
  })

  it('returns Infinity when there are no capture outliers', () => {
    expect(captureScoreCap([1600, 1500, 1400, 1600, 1200, 900])).toBe(
      Number.POSITIVE_INFINITY
    )
  })

  it('does not treat small within-normal variation as a capture gap', () => {
    expect(captureScoreCap([400, 450, 600, 850, 1400, 1600])).toBe(
      Number.POSITIVE_INFINITY
    )
  })

  it('does not cap when too few battles to distinguish a gap', () => {
    expect(captureScoreCap([1500, 41_600])).toBe(Number.POSITIVE_INFINITY)
  })

  it('does not flag a big cluster (>40% above the gap) as captures', () => {
    expect(captureScoreCap([400, 400, 400, 1400, 1400, 1400])).toBe(
      Number.POSITIVE_INFINITY
    )
  })

  it('does not cap a sparse high-but-normal cluster below capture magnitude', () => {
    // A 16x gap, but 1600 is below MIN_CAPTURE_SCORE; capping would clip real attacks.
    expect(captureScoreCap([100, 100, 100, 1600, 1600])).toBe(
      Number.POSITIVE_INFINITY
    )
  })

  it('still detects real capture-magnitude outliers above a sparse cluster', () => {
    // Same shape, but the outliers are capture-magnitude.
    expect(captureScoreCap([1600, 1600, 1600, 15_050, 41_600])).toBe(1600)
  })

  it('sheds the first-blood +1 when the bonus attack is the cap edge', () => {
    // The first attack scores normal+1; without the strip the cap is 1601.
    const normals = [...Array.from({ length: 20 }, () => 1600), 1601]
    const captures = [10_450, 17_400]
    expect(captureScoreCap([...normals, ...captures])).toBe(1600)
  })

  it('leaves the cap alone when the first-blood attack is below the edge', () => {
    // The bonus attack (1201) is not the max, so the cap stays 1600.
    const scores = [1201, 1400, 1600, 1600, 1600, 1600, 15_050]
    expect(captureScoreCap(scores)).toBe(1600)
  })
})

describe('first-blood +1 personal score (war-first attack)', () => {
  it('the bonus holder keeps their +1 while cappers are clamped to the clean cap', () => {
    // Opener keeps his first-blood +1; the teammate's capture clamps to the clean 1600.
    const rows: WarBattleRosterRow[] = [
      battle({
        attacker_player_id: 'opener',
        attacker_player_name: 'Opener',
        is_guild_member: true,
        score_earned: 1601
      }),
      ...Array.from({ length: 3 }, () =>
        battle({
          attacker_player_id: 'opener',
          attacker_player_name: 'Opener',
          is_guild_member: true,
          score_earned: 1600
        })
      ),
      ...Array.from({ length: 4 }, () =>
        battle({
          attacker_player_id: 'filler',
          attacker_player_name: 'Filler',
          is_guild_member: true,
          score_earned: 1600
        })
      ),
      battle({
        attacker_player_id: 'capper',
        attacker_player_name: 'Capper',
        is_guild_member: true,
        score_earned: 11_100
      }),
      battle({
        attacker_player_id: 'capper',
        attacker_player_name: 'Capper',
        is_guild_member: true,
        score_earned: 250
      })
    ]
    const { guild } = buildBoardSides(rows)
    const opener = guild.find((p) => p.playerId === 'opener')!
    const capper = guild.find((p) => p.playerId === 'capper')!
    // 1601 + 3*1600, the expected first-blood total.
    expect(opener.attacks.points).toBe(6_401)
    // Capture clamped to the clean 1600 (not 1601) + 250 = 1850.
    expect(capper.attacks.points).toBe(1_850)
  })
})

describe('failed-attack counting', () => {
  const aliveDefender = [{ unitId: 'a', remainingHPAfter: 500 }]
  const deadDefenders = [
    { unitId: 'a', remainingHPBefore: 900 },
    { unitId: 'b', remainingHPBefore: 700 }
  ]

  it('counts defenders-left-standing attacks as failed per player and in totals', () => {
    const rows: WarBattleRosterRow[] = [
      battle({
        attacker_player_id: 'g1',
        attacker_player_name: 'Hitter',
        is_guild_member: true,
        score_earned: 800,
        attempt_result: 'win', // LOKI misclassification — defender survived
        defender_units_json: aliveDefender
      }),
      battle({
        attacker_player_id: 'g1',
        attacker_player_name: 'Hitter',
        is_guild_member: true,
        score_earned: 1600,
        attempt_result: 'win',
        defender_units_json: deadDefenders
      }),
      battle({
        attacker_player_id: 'opp1',
        attacker_player_name: 'Foe',
        is_guild_member: false,
        score_earned: 0,
        attempt_result: 'loss'
      })
    ]
    const { guild, opponent } = buildBoardSides(rows)
    expect(guild[0]!.attacks).toMatchObject({ total: 2, failed: 1 })
    expect(opponent[0]!.attacks).toMatchObject({ total: 1, failed: 1 })
    expect(computeTotals(guild).totalFailed).toBe(1)
    expect(computeTotals(opponent).totalFailed).toBe(1)
  })

  it('falls back to attacker team wipe when defender data is missing', () => {
    const wiped = [{ unitId: 'x' }, { unitId: 'y' }] // no remainingHPAfter = dead
    const survived = [{ unitId: 'x', remainingHPAfter: 100 }]
    const rows: WarBattleRosterRow[] = [
      battle({
        attacker_player_id: 'g1',
        attacker_player_name: 'Wiped',
        is_guild_member: true,
        score_earned: 400,
        attempt_result: 'win',
        attacker_units_json: wiped
      }),
      battle({
        attacker_player_id: 'g2',
        attacker_player_name: 'Alive',
        is_guild_member: true,
        score_earned: 400,
        attempt_result: 'win',
        attacker_units_json: survived
      })
    ]
    const { guild } = buildBoardSides(rows)
    const wipedPlayer = guild.find((p) => p.playerId === 'g1')!
    const alivePlayer = guild.find((p) => p.playerId === 'g2')!
    expect(wipedPlayer.attacks.failed).toBe(1)
    expect(alivePlayer.attacks.failed).toBe(0)
  })

  it('treats rows with no unit data as not failed', () => {
    const rows: WarBattleRosterRow[] = [
      battle({
        attacker_player_id: 'g1',
        attacker_player_name: 'Bare',
        is_guild_member: true,
        score_earned: 1600,
        attempt_result: 'win'
      })
    ]
    const { guild } = buildBoardSides(rows)
    expect(guild[0]!.attacks.failed).toBe(0)
  })

  it('flags failure data as unavailable for pre-unit-JSON wars', () => {
    // No unit JSON and no recorded losses: render "—", not 0.
    const bare = buildBoardSides([
      battle({
        attacker_player_id: 'g1',
        attacker_player_name: 'Old',
        is_guild_member: true,
        score_earned: 1600,
        attempt_result: 'win'
      })
    ])
    expect(bare.failureDataAvailable).toBe(false)

    const withJson = buildBoardSides([
      battle({
        attacker_player_id: 'g1',
        attacker_player_name: 'New',
        is_guild_member: true,
        score_earned: 1600,
        attempt_result: 'win',
        defender_units_json: deadDefenders
      })
    ])
    expect(withJson.failureDataAvailable).toBe(true)

    // A recorded loss alone is a usable failure signal.
    const withLoss = buildBoardSides([
      battle({
        attacker_player_id: 'g1',
        attacker_player_name: 'Loser',
        is_guild_member: true,
        score_earned: 0,
        attempt_result: 'loss'
      })
    ])
    expect(withLoss.failureDataAvailable).toBe(true)
  })
})
