import { describe, expect, it } from 'vitest'
import { computeTokensFromGuildRaid } from '@/app/api/discord/interactions/command-handlers/handlers/tokens/guild-raid-tokens'
import { calculateTokenAvailability } from '@/app/lib/calculations/token-calculation'
import type { GuildRaidEntry } from '@/app/lib/api/tacticus-client'

const NOW = new Date('2026-05-03T18:00:00.000Z')

const epochMs = (iso: string) => new Date(iso).getTime()

function entry(
  partial: Partial<GuildRaidEntry> & { userId: string; startedOn: number }
): GuildRaidEntry {
  return {
    username: 'Player',
    damageType: 'Battle',
    completedOn: partial.startedOn + 60_000,
    unitId: 'u',
    damageDealt: 100,
    encounterType: 'Boss',
    tier: 1,
    set: 0,
    ...partial
  }
}

describe('computeTokensFromGuildRaid', () => {
  it('normalizes millisecond timestamps for Discord token and bomb availability', () => {
    const status = computeTokensFromGuildRaid(
      [
        entry({
          userId: 'A',
          username: 'Player A',
          damageType: 'Battle',
          startedOn: epochMs('2026-05-03T17:00:00.000Z')
        }),
        entry({
          userId: 'A',
          username: 'Player A',
          damageType: 'Bomb',
          startedOn: epochMs('2026-05-03T17:30:00.000Z')
        })
      ],
      [],
      ['A'],
      NOW
    )

    expect(status).toHaveLength(1)
    expect(status[0]).toMatchObject({
      userId: 'A',
      tokensAvailable: 1,
      tokensUsed: 1,
      bombsAvailable: 0,
      tokenNextSeconds: 11 * 60 * 60
    })
    expect(status[0]?.bombCooldown).toBe('17h 30m')
  })

  it('matches the canonical token engine for a player who battles while at 0 tokens (WI-2210 parity)', () => {
    // The Discord fast path must agree with calculateTokenAvailability (the web path).
    const t1 = epochMs('2026-05-03T17:00:00.000Z')
    const t2 = epochMs('2026-05-03T17:10:00.000Z')
    const t3 = epochMs('2026-05-03T17:20:00.000Z')

    const status = computeTokensFromGuildRaid(
      [
        entry({ userId: 'Z', username: 'Zed', startedOn: t1 }),
        entry({ userId: 'Z', username: 'Zed', startedOn: t2 }),
        entry({ userId: 'Z', username: 'Zed', startedOn: t3 })
      ],
      [],
      ['Z'],
      NOW
    )

    const canonical = calculateTokenAvailability(
      [t1, t2, t3].map((ms) => ({
        displayName: 'Zed',
        damageType: 'Battle' as const,
        startedOn: new Date(ms).toISOString()
      })),
      undefined,
      NOW
    )

    expect(status).toHaveLength(1)
    expect(status[0]?.tokensAvailable).toBe(canonical.tokensAvailable)
    expect(status[0]?.tokenNextSeconds).toBe(canonical.tokenNextSeconds)
    expect(status[0]?.tokensAvailable).toBe(0)
    // Spends never re-anchor the regen timer.
    expect(status[0]?.tokenNextSeconds).toBe(11 * 60 * 60) // 11h
    expect(status[0]?.tokensUsed).toBe(3)
  })

  it('anchors the replay at the season start when provided', () => {
    const anchorStart = new Date(NOW.getTime() - 30 * 60 * 60 * 1000)
    const status = computeTokensFromGuildRaid(
      [
        entry({
          userId: 'A',
          username: 'Player A',
          startedOn: NOW.getTime() - 4 * 60 * 60 * 1000
        })
      ],
      [],
      ['A'],
      NOW,
      anchorStart
    )

    expect(status).toHaveLength(1)
    expect(status[0]).toMatchObject({
      tokensAvailable: 2,
      tokensUsed: 1,
      tokenNextSeconds: 8 * 60 * 60
    })
  })

  it('gives roster members with no entries the anchored no-battle baseline', () => {
    const anchorStart = new Date(NOW.getTime() - 26 * 60 * 60 * 1000)
    const status = computeTokensFromGuildRaid(
      [],
      [],
      ['IDLE'],
      NOW,
      anchorStart
    )

    expect(status).toHaveLength(1)
    expect(status[0]).toMatchObject({
      userId: 'IDLE',
      tokensAvailable: 3,
      bombsAvailable: 1,
      tokenCooldown: null
    })
  })
})
