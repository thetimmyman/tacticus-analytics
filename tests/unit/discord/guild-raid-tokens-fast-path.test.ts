import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchGuildTokensFast } from '@/app/api/discord/interactions/command-handlers/handlers/tokens/guild-raid-tokens'
import type { GuildRaidEntry } from '@/app/lib/api/tacticus-client'

const mocks = vi.hoisted(() => ({
  getCurrentGuildRaid: vi.fn(),
  getGuildRaidBySeason: vi.fn(),
  getGuild: vi.fn(),
  decryptApiKey: vi.fn(),
  getSeasonTiming: vi.fn(),
  fetchLiveTokenDataForMembers: vi.fn(),
  loadGuildTokenStatuses: vi.fn()
}))

vi.mock('@/app/lib/api/tacticus-client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/lib/api/tacticus-client')>()
  return {
    ...actual,
    tacticusAPI: {
      getCurrentGuildRaid: mocks.getCurrentGuildRaid,
      getGuildRaidBySeason: mocks.getGuildRaidBySeason,
      getGuild: mocks.getGuild
    }
  }
})

vi.mock('@tacticus/app-core/encryption', () => ({
  decryptApiKey: mocks.decryptApiKey
}))

vi.mock('@/app/lib/services/season-timing-service', () => ({
  getSeasonTiming: mocks.getSeasonTiming
}))

vi.mock('@/app/api/guild-tokens/token-service', () => ({
  fetchLiveTokenDataForMembers: mocks.fetchLiveTokenDataForMembers,
  loadGuildTokenStatuses: mocks.loadGuildTokenStatuses
}))

const NOW_MS = Date.now()
const HOUR = 60 * 60 * 1000

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
  } as GuildRaidEntry
}

type MappingRowFixture = Record<string, string | boolean | null>

function supabaseMock(mappings: MappingRowFixture[]) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'guild_config') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: { api_key_encrypted: 'enc' } })
            })
          })
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: mappings, error: null })
            })
          })
        })
      }
    })
  } as never
}

describe('fetchGuildTokensFast — D2 key-holder live overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadGuildTokenStatuses.mockResolvedValue({ players: [], debug: {} })
    mocks.decryptApiKey.mockResolvedValue('guild-api-key')
    mocks.getSeasonTiming.mockResolvedValue({
      seasonStart: NOW_MS - 20 * 24 * HOUR
    })
    mocks.getCurrentGuildRaid.mockResolvedValue({
      season: 105,
      entries: [
        entry({
          userId: 'KEYED',
          username: 'Keyed',
          startedOn: NOW_MS - 2 * HOUR
        }),
        entry({
          userId: 'KEYLESS',
          username: 'Keyless',
          startedOn: NOW_MS - 2 * HOUR
        })
      ]
    })
    mocks.getGuildRaidBySeason.mockResolvedValue({ entries: [] })
    mocks.getGuild.mockResolvedValue({
      members: [{ userId: 'KEYED' }, { userId: 'KEYLESS' }]
    })
  })

  it('overlays exact live player-API counts for key-holders and leaves keyless members on the replay', async () => {
    const mappings = [
      {
        player_id: 'KEYED',
        discord_user_id: 'd1',
        display_name: 'Keyed',
        user_id: null,
        last_sync_tokens: null,
        last_sync_bombs: null,
        last_sync_at: null,
        next_token_seconds: null,
        next_bomb_seconds: null,
        api_key_is_valid: true,
        tacticus_api_key_encrypted: 'enc-player-key'
      },
      {
        player_id: 'KEYLESS',
        discord_user_id: null,
        display_name: 'Keyless',
        user_id: null,
        last_sync_tokens: null,
        last_sync_bombs: null,
        last_sync_at: null,
        next_token_seconds: null,
        next_bomb_seconds: null,
        api_key_is_valid: null,
        tacticus_api_key_encrypted: null
      }
    ]
    mocks.fetchLiveTokenDataForMembers.mockResolvedValue(
      new Map([
        [
          'KEYED',
          {
            tokensAvailable: 0,
            bombsAvailable: 0,
            tokenNextSeconds: 1234,
            bombNextSeconds: 9876
          }
        ]
      ])
    )

    const result = await fetchGuildTokensFast(supabaseMock(mappings), 'EOT')

    expect(result?.ok).toBe(true)
    if (!result?.ok) return

    expect(mocks.fetchLiveTokenDataForMembers).toHaveBeenCalledTimes(1)
    const fanOutMembers = mocks.fetchLiveTokenDataForMembers.mock.calls[0]?.[0]
    expect(fanOutMembers).toHaveLength(1)
    expect(fanOutMembers?.[0]?.player_id).toBe('KEYED')

    const keyed = result.players.find((p) => p.displayName === 'Keyed')
    expect(keyed).toMatchObject({
      tokensAvailable: 0,
      bombsAvailable: 0,
      tokenNextSeconds: 1234
    })
    expect(keyed?.tokenCooldown).toBeTruthy()
    expect(keyed?.bombCooldown).toBeTruthy()

    const keyless = result.players.find((p) => p.displayName === 'Keyless')
    expect(keyless?.tokensAvailable).toBe(2)

    expect(mocks.loadGuildTokenStatuses).not.toHaveBeenCalled()
  })

  it('uses the snapshot projection (not the replay estimate) when the live fan-out misses a key-holder', async () => {
    const mappings = [
      {
        player_id: 'KEYED',
        discord_user_id: 'd1',
        display_name: 'Keyed',
        user_id: null,
        last_sync_tokens: null,
        last_sync_bombs: null,
        last_sync_at: null,
        next_token_seconds: null,
        next_bomb_seconds: null,
        api_key_is_valid: true,
        tacticus_api_key_encrypted: 'enc-player-key'
      }
    ]
    // Live fetch times out; the projection's 1 token beats the replay's wrong 2.
    mocks.fetchLiveTokenDataForMembers.mockResolvedValue(new Map())
    mocks.loadGuildTokenStatuses.mockResolvedValue({
      players: [
        {
          player_id: 'KEYED',
          tokens_available: 1,
          bombs_available: 0,
          token_next_in_seconds: 4321,
          next_bomb_seconds: 5555
        }
      ],
      debug: {}
    })

    const result = await fetchGuildTokensFast(supabaseMock(mappings), 'EOT')

    expect(result?.ok).toBe(true)
    if (!result?.ok) return

    expect(mocks.loadGuildTokenStatuses).toHaveBeenCalledTimes(1)
    expect(mocks.loadGuildTokenStatuses).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        guildCode: 'EOT',
        season: '105',
        skipLiveOverlay: true
      })
    )

    const keyed = result.players.find((p) => p.displayName === 'Keyed')
    expect(keyed?.tokensAvailable).toBe(1)
    expect(keyed?.bombsAvailable).toBe(0)
    expect(keyed?.tokenNextSeconds).toBe(4321)
    expect(keyed?.tokenCooldown).toBeTruthy()
  })

  it('keeps the replay estimate as a last resort when the projection has no row for the missed key-holder', async () => {
    const mappings = [
      {
        player_id: 'KEYED',
        discord_user_id: 'd1',
        display_name: 'Keyed',
        user_id: null,
        last_sync_tokens: null,
        last_sync_bombs: null,
        last_sync_at: null,
        next_token_seconds: null,
        next_bomb_seconds: null,
        api_key_is_valid: true,
        tacticus_api_key_encrypted: 'enc-player-key'
      }
    ]
    mocks.fetchLiveTokenDataForMembers.mockResolvedValue(new Map())
    mocks.loadGuildTokenStatuses.mockResolvedValue({ players: [], debug: {} })

    const result = await fetchGuildTokensFast(supabaseMock(mappings), 'EOT')

    expect(result?.ok).toBe(true)
    if (!result?.ok) return
    const keyed = result.players.find((p) => p.displayName === 'Keyed')
    expect(keyed?.tokensAvailable).toBe(2)
  })
})
