import { describe, expect, it, vi } from 'vitest'
import type { GuildRaidEntry } from '@/app/lib/api/tacticus-client'

const { computeGuildBombsAvailable } =
  await import('@/app/lib/tacticus/guild-bombs')

const epoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)
const epochMs = (iso: string) => new Date(iso).getTime()

function entry(
  partial: Partial<GuildRaidEntry> & { userId: string; startedOn: number }
): GuildRaidEntry {
  return {
    username: 'Player',
    damageType: 'Bomb',
    completedOn: partial.startedOn + 60_000,
    unitId: 'u',
    damageDealt: 100,
    encounterType: 'Boss',
    tier: 1,
    set: 0,
    ...partial
  }
}

describe('computeGuildBombsAvailable', () => {
  it('normalizes millisecond bomb timestamps before cooldown math', () => {
    const snapshot = computeGuildBombsAvailable(
      [
        entry({
          userId: 'A',
          startedOn: epochMs('2026-05-03T17:00:00.000Z')
        })
      ],
      [],
      ['A', 'B'],
      epoch('2026-05-03T18:00:00.000Z')
    )

    expect(snapshot.total).toBe(1)
    expect(snapshot.holderIds).toEqual(['B'])
  })

  it('returns every member with no recorded bomb as a holder', () => {
    const snapshot = computeGuildBombsAvailable(
      [],
      [],
      ['A', 'B', 'C'],
      epoch('2026-05-03T18:00:00.000Z')
    )

    expect(snapshot.total).toBe(3)
    expect(snapshot.holderIds).toEqual(['A', 'B', 'C'])
  })
})
