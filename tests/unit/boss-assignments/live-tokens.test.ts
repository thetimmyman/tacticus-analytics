import { describe, expect, it } from 'vitest'
import { derivePlayerTokensFromEntries } from '@/app/lib/boss-assignments/live-tokens'
import type { GuildRaidEntry } from '@/app/lib/api/tacticus-client'

const NOW = new Date('2026-05-03T18:00:00.000Z')

const epoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)

function entry(
  partial: Partial<GuildRaidEntry> & { userId: string; startedOn: number }
): GuildRaidEntry {
  return {
    username: 'Player',
    damageType: 'Battle',
    completedOn: partial.startedOn + 60,
    unitId: 'u',
    damageDealt: 100,
    encounterType: 'Boss',
    tier: 1,
    set: 0,
    ...partial
  }
}

describe('derivePlayerTokensFromEntries', () => {
  it('returns empty object when there are no entries', () => {
    expect(
      derivePlayerTokensFromEntries({ entries: [], currentTime: NOW })
    ).toEqual({})
  })

  it('groups by userId — one bucket per distinct player', () => {
    const recent = epoch('2026-05-03T17:00:00.000Z')
    const out = derivePlayerTokensFromEntries({
      currentTime: NOW,
      entries: [
        entry({ userId: 'A', startedOn: recent }),
        entry({ userId: 'A', startedOn: recent + 60 }),
        entry({ userId: 'B', startedOn: recent }),
        entry({ userId: 'C', startedOn: recent })
      ]
    })

    expect(Object.keys(out).sort()).toEqual(['A', 'B', 'C'])
  })

  it('produces values within the canonical [0, 3] token range', () => {
    const recent = epoch('2026-05-03T17:00:00.000Z')
    const out = derivePlayerTokensFromEntries({
      currentTime: NOW,
      entries: [
        entry({ userId: 'A', startedOn: recent }),
        entry({ userId: 'A', startedOn: recent + 30 }),
        entry({ userId: 'A', startedOn: recent + 60 }),
        entry({ userId: 'B', startedOn: recent, damageType: 'Bomb' })
      ]
    })

    for (const [userId, tokens] of Object.entries(out)) {
      expect(tokens, `${userId} tokens lower bound`).toBeGreaterThanOrEqual(0)
      expect(tokens, `${userId} tokens upper bound`).toBeLessThanOrEqual(3)
      expect(Number.isInteger(tokens), `${userId} integer`).toBe(true)
    }
  })

  it('Bomb-only player does not deduct Battle tokens (Bombs and Battles are separate counts)', () => {
    // Bomb-only history with no `seasonStart` falls back to MAX_TOKENS=3.
    const recent = epoch('2026-05-03T17:00:00.000Z')
    const out = derivePlayerTokensFromEntries({
      currentTime: NOW,
      entries: [
        entry({ userId: 'B', startedOn: recent, damageType: 'Bomb' }),
        entry({ userId: 'B', startedOn: recent + 60, damageType: 'Bomb' })
      ]
    })

    expect(out['B']).toBe(3)
  })

  it('Battle deductions reduce token count below the bomb-only baseline', () => {
    const recent = epoch('2026-05-03T17:00:00.000Z')
    const out = derivePlayerTokensFromEntries({
      currentTime: NOW,
      entries: [
        entry({ userId: 'A', startedOn: recent, damageType: 'Battle' }),
        entry({ userId: 'A', startedOn: recent + 60, damageType: 'Battle' })
      ]
    })

    expect(out['A']).toBeLessThan(3)
  })

  it('normalizes millisecond timestamps before deriving Battle token state', () => {
    const recentMs = new Date('2026-05-03T17:00:00.000Z').getTime()
    const out = derivePlayerTokensFromEntries({
      currentTime: NOW,
      entries: [
        entry({
          userId: 'A',
          startedOn: recentMs,
          completedOn: recentMs + 60_000,
          damageType: 'Battle'
        })
      ]
    })

    expect(out['A']).toBe(1)
  })

  it('does not include players absent from entries (caller falls back to stored sync)', () => {
    const out = derivePlayerTokensFromEntries({
      currentTime: NOW,
      entries: [
        entry({ userId: 'A', startedOn: epoch('2026-05-03T17:00:00.000Z') })
      ]
    })
    expect(out['B']).toBeUndefined()
  })
})
