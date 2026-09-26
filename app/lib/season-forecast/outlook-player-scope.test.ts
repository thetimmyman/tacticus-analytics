import { describe, it, expect } from 'vitest'
import {
  resolveOutlookPlayerScope,
  scopeOutlookPlayers
} from '@/app/lib/season-forecast/outlook-player-scope'
import type { PlayerTokenPaceRow } from '@/app/lib/season-forecast/season-token-economy'

// Privacy boundary: officer/leader see the roster, everyone else at most their own row.

const row = (playerId: string): PlayerTokenPaceRow => ({
  playerId,
  displayName: `Name ${playerId}`,
  tokensUsed: 5,
  tokensRemaining: 10,
  projectedWaste: 2,
  atCapRisk: true
})

const ROSTER = [row('p1'), row('p2'), row('p3')]

describe('resolveOutlookPlayerScope', () => {
  it('grants all only to officer and leader', () => {
    expect(resolveOutlookPlayerScope('officer')).toBe('all')
    expect(resolveOutlookPlayerScope('leader')).toBe('all')
  })

  it('case-normalizes the legacy capitalized enum variants to officer scope', () => {
    // Live roles are lowercase; guards the enum's capitalized variants.
    expect(resolveOutlookPlayerScope('Officer')).toBe('all')
    expect(resolveOutlookPlayerScope('Leader')).toBe('all')
    expect(resolveOutlookPlayerScope('OFFICER')).toBe('all')
  })

  it('scopes everyone else to self, including unknown and spoof-shaped roles', () => {
    expect(resolveOutlookPlayerScope('member')).toBe('self')
    expect(resolveOutlookPlayerScope(null)).toBe('self')
    expect(resolveOutlookPlayerScope(undefined)).toBe('self')
    expect(resolveOutlookPlayerScope('')).toBe('self')
    // No admin branch on purpose: there is no profile-role 'admin' and the
    // string check would be spoofable.
    expect(resolveOutlookPlayerScope('admin')).toBe('self')
    expect(resolveOutlookPlayerScope('officer-of-nothing')).toBe('self')
    expect(resolveOutlookPlayerScope('LEADERBOARD')).toBe('self')
  })
})

describe('scopeOutlookPlayers', () => {
  it('returns the full roster for an officer-level caller', () => {
    expect(
      scopeOutlookPlayers({
        players: ROSTER,
        role: 'officer',
        selfPlayerId: 'p2'
      })
    ).toEqual(ROSTER)
    expect(
      scopeOutlookPlayers({
        players: ROSTER,
        role: 'leader',
        selfPlayerId: null
      })
    ).toEqual(ROSTER)
  })

  it("returns only the caller's own row for a member", () => {
    expect(
      scopeOutlookPlayers({
        players: ROSTER,
        role: 'member',
        selfPlayerId: 'p2'
      })
    ).toEqual([row('p2')])
  })

  it('returns nothing for a member with no mapping row', () => {
    expect(
      scopeOutlookPlayers({
        players: ROSTER,
        role: 'member',
        selfPlayerId: null
      })
    ).toEqual([])
    expect(
      scopeOutlookPlayers({ players: ROSTER, role: 'member', selfPlayerId: '' })
    ).toEqual([])
  })

  it('returns nothing when the member has no row in the roster', () => {
    expect(
      scopeOutlookPlayers({
        players: ROSTER,
        role: 'member',
        selfPlayerId: 'p-elsewhere'
      })
    ).toEqual([])
  })
})
