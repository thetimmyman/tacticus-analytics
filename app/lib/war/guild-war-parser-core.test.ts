import { describe, it, expect } from 'vitest'
import {
  buildBattlePayload,
  extractGuildTagFromPlayerName,
  getMostCommonMapKey,
  looksLikeSelfOpponent,
  selectGuildWarSnapshot
} from './guild-war-parser-core'
import type {
  GuildWarActivityLog,
  SnapshotGuildWarCandidate
} from './war-payload-types'

describe('extractGuildTagFromPlayerName', () => {
  it('extracts a bracketed tag and uppercases it', () => {
    expect(extractGuildTagFromPlayerName('[syn01] synthetic-player-a')).toBe(
      'SYN01'
    )
  })

  it('extracts tags wrapped in full-width Japanese brackets', () => {
    expect(extractGuildTagFromPlayerName('【syn02】synthetic-player-b')).toBe(
      'SYN02'
    )
    expect(extractGuildTagFromPlayerName('〘syn03〙synthetic-player-c')).toBe(
      'SYN03'
    )
    expect(extractGuildTagFromPlayerName('〖syn04〗synthetic-player-d')).toBe(
      'SYN04'
    )
  })

  it('returns null when no tag pattern matches', () => {
    expect(extractGuildTagFromPlayerName('synthetic-player-e')).toBeNull()
  })

  it('returns null for an empty or whitespace-only name', () => {
    expect(extractGuildTagFromPlayerName('   ')).toBeNull()
    expect(extractGuildTagFromPlayerName('')).toBeNull()
  })
})

describe('looksLikeSelfOpponent', () => {
  it('treats a missing or empty opponent name as self', () => {
    expect(looksLikeSelfOpponent(undefined, 'Synthetic Guild', 'SYN01')).toBe(
      true
    )
    expect(looksLikeSelfOpponent('   ', 'Synthetic Guild', 'SYN01')).toBe(true)
  })

  it('treats the literal "unknown opponent" placeholder as self', () => {
    expect(
      looksLikeSelfOpponent('Unknown Opponent', 'Synthetic Guild', 'SYN01')
    ).toBe(true)
  })

  it('treats an opponent name containing our guild name as self', () => {
    expect(
      looksLikeSelfOpponent('Synthetic Guild', 'Synthetic Guild', 'SYN01')
    ).toBe(true)
  })

  it('treats an opponent name containing our guild code as self', () => {
    expect(
      looksLikeSelfOpponent('[SYN01] roster', 'Synthetic Guild', 'SYN01')
    ).toBe(true)
  })

  it('returns false for a genuinely different opponent', () => {
    expect(
      looksLikeSelfOpponent('Rival Guild', 'Synthetic Guild', 'SYN01')
    ).toBe(false)
  })
})

describe('getMostCommonMapKey', () => {
  it('returns the key with the highest count', () => {
    const counter = new Map([
      ['zone-a', 2],
      ['zone-b', 5],
      ['zone-c', 1]
    ])
    expect(getMostCommonMapKey(counter)).toBe('zone-b')
  })

  it('returns null for an empty map', () => {
    expect(getMostCommonMapKey(new Map())).toBeNull()
  })
})

describe('buildBattlePayload', () => {
  const nameMap = new Map<string, string>([
    ['syn-user-a', 'synthetic-player-a'],
    ['syn-user-b', 'synthetic-player-b']
  ])

  it('summarizes attacker and defender units and prefers the passed display name', () => {
    const log: GuildWarActivityLog = {
      type: 'battleFinished',
      attacker: {
        userId: 'syn-user-a',
        displayName: 'stale-name',
        lineupPower: 1000,
        units: [{ unitId: 'u1', remainingHPAfter: 100 }]
      },
      defender: {
        userId: 'syn-user-b',
        displayName: 'synthetic-player-b',
        lineupPower: 900,
        units: [{ unitId: 'u2', remainingHPAfter: 0 }]
      },
      buffs: [{ abilityId: 'buff-1', scope: 'team' }]
    }

    const payload = buildBattlePayload(log, nameMap, 'synthetic-player-a')

    expect(payload.battleSummary.attacker.displayName).toBe(
      'synthetic-player-a'
    )
    expect(payload.battleSummary.attacker.unitsSurvived).toBe(1)
    expect(payload.battleSummary.attacker.unitsLost).toBe(0)
    expect(payload.battleSummary.defender.displayName).toBe(
      'synthetic-player-b'
    )
    expect(payload.battleSummary.defender.unitsLost).toBe(1)
    expect(payload.battleSummary.buffs).toEqual([
      { abilityId: 'buff-1', scope: 'team' }
    ])
    expect(payload.log).toBe(log)
  })

  it('falls back to resolving names from the map when no display name is given', () => {
    const log: GuildWarActivityLog = {
      type: 'battleFinished',
      attacker: { userId: 'syn-user-a', units: [] },
      defender: { userId: 'syn-user-b', units: [] }
    }

    const payload = buildBattlePayload(log, nameMap, '')

    expect(payload.battleSummary.attacker.displayName).toBe(
      'synthetic-player-a'
    )
    expect(payload.battleSummary.defender.displayName).toBe(
      'synthetic-player-b'
    )
  })

  it('treats a missing units array as empty rather than throwing', () => {
    const log: GuildWarActivityLog = {
      type: 'battleFinished',
      attacker: { userId: 'syn-user-a' },
      defender: { userId: 'syn-user-b' }
    }

    const payload = buildBattlePayload(log, nameMap, 'synthetic-player-a')

    expect(payload.battleSummary.attacker.units).toEqual([])
    expect(payload.battleSummary.defender.units).toEqual([])
  })
})

describe('selectGuildWarSnapshot', () => {
  const makeCandidate = (
    overrides: Partial<SnapshotGuildWarCandidate>
  ): SnapshotGuildWarCandidate => ({
    warUuid: 'war-uuid',
    module: { moduleType: 'guildWarEvent' },
    ...overrides
  })

  it('throws when given no candidates', () => {
    expect(() => selectGuildWarSnapshot([], false, 1_000)).toThrow()
  })

  it('returns the only candidate regardless of flags', () => {
    const only = makeCandidate({ warUuid: 'only-war' })
    expect(selectGuildWarSnapshot([only], true, 1_000)).toBe(only)
    expect(selectGuildWarSnapshot([only], false, 1_000)).toBe(only)
  })

  it('picks the currently active war when previousWar is false', () => {
    const nowMs = 10_000
    const active = makeCandidate({
      warUuid: 'active-war',
      startsOn: nowMs - 1000,
      endsOn: nowMs + 1000
    })
    const ended = makeCandidate({
      warUuid: 'ended-war',
      startsOn: nowMs - 5000,
      endsOn: nowMs - 2000
    })

    const result = selectGuildWarSnapshot([active, ended], false, nowMs)
    expect(result.warUuid).toBe('active-war')
  })

  it('picks the most recently ended war when previousWar is true', () => {
    const nowMs = 10_000
    const olderEnded = makeCandidate({
      warUuid: 'older-war',
      startsOn: nowMs - 9000,
      endsOn: nowMs - 5000
    })
    const recentEnded = makeCandidate({
      warUuid: 'recent-war',
      startsOn: nowMs - 4000,
      endsOn: nowMs - 1000
    })

    const result = selectGuildWarSnapshot(
      [olderEnded, recentEnded],
      true,
      nowMs
    )
    expect(result.warUuid).toBe('recent-war')
  })

  it('picks the nearest upcoming war when nothing is active and previousWar is false', () => {
    const nowMs = 10_000
    const soon = makeCandidate({
      warUuid: 'soon-war',
      startsOn: nowMs + 1000,
      endsOn: nowMs + 5000
    })
    const later = makeCandidate({
      warUuid: 'later-war',
      startsOn: nowMs + 9000,
      endsOn: nowMs + 15000
    })

    const result = selectGuildWarSnapshot([soon, later], false, nowMs)
    expect(result.warUuid).toBe('soon-war')
  })

  // Regression test for a confirmed bug: previousWar=true must never return
  // a war that is still active (or upcoming) just because none has ended.
  it('does not return a currently-active war when previousWar is true and none have ended', () => {
    const nowMs = 10_000
    const active = makeCandidate({
      warUuid: 'active-war',
      startsOn: nowMs - 1000,
      endsOn: nowMs + 1000
    })
    const unresolved = makeCandidate({
      warUuid: 'unresolved-war',
      startsOn: nowMs - 5000,
      endsOn: undefined
    })

    expect(() =>
      selectGuildWarSnapshot([active, unresolved], true, nowMs)
    ).toThrow()
  })

  it('throws when previousWar is true and every candidate is still active or upcoming', () => {
    const nowMs = 10_000
    const active = makeCandidate({
      warUuid: 'active-war',
      startsOn: nowMs - 1000,
      endsOn: nowMs + 1000
    })
    const upcoming = makeCandidate({
      warUuid: 'upcoming-war',
      startsOn: nowMs + 5000,
      endsOn: nowMs + 9000
    })

    expect(() =>
      selectGuildWarSnapshot([active, upcoming], true, nowMs)
    ).toThrow(
      'No completed guild-war snapshot candidate is available for previousWar'
    )
  })
})
