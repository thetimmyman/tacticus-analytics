import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchGuildTokens } from '@/app/api/discord/interactions/command-handlers/handlers/tokens/fetch-guild-tokens'

const mocks = vi.hoisted(() => ({
  fetchGuildTokensFast: vi.fn(),
  loadGuildTokenStatuses: vi.fn()
}))

vi.mock(
  '@/app/api/discord/interactions/command-handlers/handlers/tokens/guild-raid-tokens',
  () => ({
    fetchGuildTokensFast: mocks.fetchGuildTokensFast
  })
)

vi.mock('@/app/api/guild-tokens/token-service', () => ({
  loadGuildTokenStatuses: mocks.loadGuildTokenStatuses
}))

function supabaseWithCurrentSeason(
  season: string,
  authorityRows: Record<string, unknown>[] = []
) {
  return {
    rpc: vi.fn((name: string) =>
      Promise.resolve(
        name === 'resolve_verified_discord_identities'
          ? { data: authorityRows, error: null }
          : { data: season, error: null }
      )
    )
  } as any
}

describe('fetchGuildTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchGuildTokensFast.mockResolvedValue(null)
    mocks.loadGuildTokenStatuses.mockResolvedValue({ players: [] })
  })

  it('tries the fast path when an explicit season is the current season', async () => {
    mocks.fetchGuildTokensFast.mockResolvedValue({
      ok: true,
      players: []
    })

    const result = await fetchGuildTokens(
      supabaseWithCurrentSeason('103'),
      'TEST',
      '103'
    )

    expect(result.ok).toBe(true)
    expect(mocks.fetchGuildTokensFast).toHaveBeenCalledWith(
      expect.anything(),
      'TEST'
    )
    expect(mocks.loadGuildTokenStatuses).not.toHaveBeenCalled()
  })

  it('retains a Discord mention only for the exact verified player and guild', async () => {
    const discordUserId = '700000000000000007'
    mocks.fetchGuildTokensFast.mockResolvedValue({
      ok: true,
      players: [
        {
          playerId: 'verified-player',
          displayName: 'Verified',
          discordUserId,
          tokensAvailable: 3,
          tokensUsed: 0,
          bombsAvailable: 1,
          tokenCooldown: null,
          tokenNextSeconds: null,
          bombCooldown: null
        },
        {
          playerId: 'unverified-duplicate',
          displayName: 'Unverified duplicate',
          discordUserId,
          tokensAvailable: 2,
          tokensUsed: 1,
          bombsAvailable: 0,
          tokenCooldown: '1h',
          tokenNextSeconds: 3600,
          bombCooldown: '2h'
        }
      ]
    })
    const supabase = supabaseWithCurrentSeason('103', [
      {
        mapping_id: 1,
        player_id: 'verified-player',
        user_id: 'auth-user',
        guild_code: 'TEST',
        role: 'member',
        is_app_admin: false,
        ownership_attestation_id: 'attestation-1',
        discord_user_id: discordUserId
      }
    ])

    const result = await fetchGuildTokens(supabase, 'TEST', '103')

    expect(result).toMatchObject({
      ok: true,
      players: [
        { displayName: 'Verified', discordUserId },
        { displayName: 'Unverified duplicate', discordUserId: null }
      ]
    })
    expect(
      result.ok && result.players.some((player) => 'playerId' in player)
    ).toBe(false)
    expect(supabase.rpc).toHaveBeenCalledWith(
      'resolve_verified_discord_identities',
      { p_discord_user_ids: [discordUserId] }
    )
  })

  it('falls back to the legacy loader when current-season fast path is unavailable', async () => {
    mocks.fetchGuildTokensFast.mockResolvedValue(null)

    const result = await fetchGuildTokens(
      supabaseWithCurrentSeason('103'),
      'TEST',
      '103'
    )

    expect(result.ok).toBe(true)
    expect(mocks.fetchGuildTokensFast).toHaveBeenCalledWith(
      expect.anything(),
      'TEST'
    )
    expect(mocks.loadGuildTokenStatuses).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        guildCode: 'TEST',
        season: '103'
      })
    )
  })

  it('uses the legacy loader for explicit historical seasons', async () => {
    await fetchGuildTokens(supabaseWithCurrentSeason('103'), 'TEST', '102')

    expect(mocks.fetchGuildTokensFast).not.toHaveBeenCalled()
    expect(mocks.loadGuildTokenStatuses).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        guildCode: 'TEST',
        season: '102'
      })
    )
  })

  it('does not expose raw unexpected loader errors', async () => {
    mocks.loadGuildTokenStatuses.mockRejectedValue(
      new Error('relation private_token_table does not exist at db.internal')
    )

    const result = await fetchGuildTokens(
      supabaseWithCurrentSeason('103'),
      'TEST',
      '102'
    )

    expect(result).toEqual({
      ok: false,
      message:
        'Unable to load guild token data right now. Please try again later.'
    })
  })
})
