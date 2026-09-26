import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchGuildTokensFast } from '@/app/api/discord/interactions/command-handlers/handlers/tokens/guild-raid-tokens'
import type { Supabase } from '@/app/api/discord/interactions/command-handlers/types'

const mocks = vi.hoisted(() => ({
  decryptApiKey: vi.fn(),
  getCurrentGuildRaid: vi.fn(),
  getGuildRaidBySeason: vi.fn(),
  getGuild: vi.fn()
}))

vi.mock('@tacticus/app-core/encryption', () => ({
  decryptApiKey: mocks.decryptApiKey
}))

// getSeasonTiming reads live game config over the network; keep the test offline.
vi.mock('@/app/lib/services/season-timing-service', () => ({
  getSeasonTiming: vi
    .fn()
    .mockResolvedValue({ seasonStart: '2026-01-01T00:00:00.000Z' })
}))

vi.mock('@/app/lib/api/tacticus-client', () => ({
  tacticusAPI: {
    getCurrentGuildRaid: mocks.getCurrentGuildRaid,
    getGuildRaidBySeason: mocks.getGuildRaidBySeason,
    getGuild: mocks.getGuild
  },
  normalizeGuildRaidEntryTimestamps: <T>(entry: T) => entry
}))

type SupabaseRow = Record<string, string | null> | null

function supabaseWithTables(rows: {
  guild_config: SupabaseRow
  player_mapping: Array<Record<string, string | null>>
}) {
  const from = vi.fn((table: string) => {
    if (table === 'guild_config') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockResolvedValue({ data: rows.guild_config, error: null })
          })
        })
      }
    }
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi
              .fn()
              .mockResolvedValue({ data: rows.player_mapping, error: null })
          })
        })
      })
    }
  })
  return { from } as unknown as Supabase
}

describe('fetchGuildTokensFast empty-statuses fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.decryptApiKey.mockResolvedValue('key')
    mocks.getGuildRaidBySeason.mockResolvedValue({ entries: [] })
  })

  it('returns null (falls back) when computed statuses are empty', async () => {
    // With an empty roster the fast path bails rather than report 0 players.
    mocks.getCurrentGuildRaid.mockResolvedValue({ season: 1, entries: [] })
    mocks.getGuild.mockResolvedValue({ members: [] })

    const supabase = supabaseWithTables({
      guild_config: { api_key_encrypted: 'enc' },
      player_mapping: []
    })

    const result = await fetchGuildTokensFast(supabase, 'TEST')

    expect(result).toBeNull()
  })

  it('still succeeds with zero entries when the roster has a member (control)', async () => {
    mocks.getCurrentGuildRaid.mockResolvedValue({ season: 1, entries: [] })
    mocks.getGuild.mockResolvedValue({ members: [{ userId: 'player-1' }] })

    const supabase = supabaseWithTables({
      guild_config: { api_key_encrypted: 'enc' },
      player_mapping: [
        {
          player_id: 'player-1',
          discord_user_id: 'discord-1',
          display_name: 'Player One'
        }
      ]
    })

    const result = await fetchGuildTokensFast(supabase, 'TEST')

    expect(result).not.toBeNull()
    expect(result?.ok).toBe(true)
    if (result?.ok) {
      expect(result.players).toHaveLength(1)
      expect(result.players[0]).toMatchObject({
        displayName: 'Player One',
        discordUserId: 'discord-1',
        tokensUsed: 0
      })
    }
  })
})
