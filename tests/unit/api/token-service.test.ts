import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/app/lib/calculations/token-calculation', () => ({
  calculateTokenAvailability: vi.fn()
}))

vi.mock('@/app/lib/services/season-timing-service', () => ({
  getSeasonTiming: vi.fn()
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/app/lib/sync/api-operations', () => ({
  fetchGuildMembersViaLoki: vi.fn(),
  fetchGuildMembersViaTacticus: vi.fn()
}))

vi.mock('@/app/lib/auth/server', () => ({
  createServiceClient: vi.fn()
}))

vi.mock('@/app/lib/api/tacticus-client', () => ({
  tacticusAPI: {
    getPlayerWithRetry: vi.fn()
  }
}))

vi.mock('@tacticus/app-core/api-key-helper', () => ({
  getPlayerApiKey: vi.fn()
}))

describe('Token Service', () => {
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let calculateTokenAvailability: ReturnType<typeof vi.fn>
  let getSeasonTiming: ReturnType<typeof vi.fn>
  let fetchGuildMembersViaLoki: ReturnType<typeof vi.fn>
  let fetchGuildMembersViaTacticus: ReturnType<typeof vi.fn>
  let createServiceClient: ReturnType<typeof vi.fn>
  let getPlayerWithRetry: ReturnType<typeof vi.fn>
  let getPlayerApiKey: ReturnType<typeof vi.fn>

  const mockMember = {
    player_id: 'player-123',
    display_name: 'TestPlayer',
    user_id: 'user-123',
    discord_user_id: 'discord-123',
    last_sync_tokens: 5,
    last_sync_bombs: 2,
    last_sync_at: '2024-01-15T10:00:00Z',
    next_token_seconds: 3600,
    next_bomb_seconds: 7200,
    api_key_is_valid: true,
    tacticus_api_key_encrypted: 'encrypted-key'
  }

  const mockMemberNoKey = {
    ...mockMember,
    api_key_is_valid: false,
    tacticus_api_key_encrypted: null
  }

  const mockBattle = {
    userId: 'player-123',
    displayName: 'TestPlayer',
    damageType: 'Battle',
    startedOn: '2024-01-15T09:00:00Z',
    damageDealt: 100000
  }

  const mockPlayerApiResponse = {
    progress: {
      guildRaid: {
        tokens: { current: 2, max: 3, nextTokenInSeconds: 7200 },
        bombTokens: { current: 1, max: 1, nextTokenInSeconds: null }
      }
    }
  }

  function createMockFrom(overrides: Record<string, () => unknown> = {}) {
    return (table: string) => {
      if (overrides[table]) return overrides[table]()

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
              in: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            }),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              then: vi.fn((cb: (result: { error: null }) => void) =>
                cb({ error: null })
              )
            })
          })
        })
      }
    }
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'RPC unavailable' }
      })
    }

    const tokenCalc = await import('@/app/lib/calculations/token-calculation')
    const seasonTiming =
      await import('@/app/lib/services/season-timing-service')
    const apiOps = await import('@/app/lib/sync/api-operations')
    const authServer = await import('@/app/lib/auth/server')
    const tacticusClient = await import('@/app/lib/api/tacticus-client')
    const apiKeyHelper = await import('@tacticus/app-core/api-key-helper')

    calculateTokenAvailability = vi.mocked(tokenCalc.calculateTokenAvailability)
    getSeasonTiming = vi.mocked(seasonTiming.getSeasonTiming)
    fetchGuildMembersViaLoki = vi.mocked(apiOps.fetchGuildMembersViaLoki)
    fetchGuildMembersViaTacticus = vi.mocked(
      apiOps.fetchGuildMembersViaTacticus
    )
    createServiceClient = vi.mocked(authServer.createServiceClient)
    getPlayerWithRetry = vi.mocked(
      tacticusClient.tacticusAPI.getPlayerWithRetry
    )
    getPlayerApiKey = vi.mocked(apiKeyHelper.getPlayerApiKey)

    getPlayerApiKey.mockResolvedValue('decrypted-api-key')
    getPlayerWithRetry.mockResolvedValue(mockPlayerApiResponse)

    calculateTokenAvailability.mockReturnValue({
      tokensAvailable: 3,
      bombsAvailable: 1,
      tokenCooldown: null,
      bombCooldown: null,
      tokenNextSeconds: null,
      bombNextSeconds: null,
      dataSource: 'calculated',
      tokenStatus: { count: 3, refreshTime: 0 }
    })

    getSeasonTiming.mockResolvedValue({ seasonStart: '2024-01-01T00:00:00Z' })
    createServiceClient.mockReturnValue(mockSupabase)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('loadGuildTokenStatuses', () => {
    it('returns empty players array when no members found', async () => {
      mockSupabase.from.mockImplementation(
        createMockFrom({
          player_mapping: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: [], error: null })
                })
              })
            })
          })
        })
      )

      const { loadGuildTokenStatuses } =
        await import('@/app/api/guild-tokens/token-service')
      const result = await loadGuildTokenStatuses(
        mockSupabase as unknown as SupabaseClient,
        {
          guildCode: 'TEST'
        }
      )

      expect(result.players).toEqual([])
      expect(result.debug.total_battles).toBe(0)
    })

    it('throws error when members query fails', async () => {
      mockSupabase.from.mockImplementation(
        createMockFrom({
          player_mapping: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Database error' }
                  })
                })
              })
            })
          })
        })
      )

      const { loadGuildTokenStatuses } =
        await import('@/app/api/guild-tokens/token-service')

      await expect(
        loadGuildTokenStatuses(mockSupabase as unknown as SupabaseClient, {
          guildCode: 'TEST'
        })
      ).rejects.toThrow('Failed to fetch guild members: Database error')
    })

    it('fetches live API data for members with API keys', async () => {
      mockSupabase.from.mockImplementation(
        createMockFrom({
          player_mapping: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi
                    .fn()
                    .mockResolvedValue({ data: [mockMember], error: null })
                })
              })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  then: vi.fn((cb: (r: { error: null }) => void) =>
                    cb({ error: null })
                  )
                })
              })
            })
          }),
          token_burn_state: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            })
          }),
          EOT_GR_data: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: [], error: null })
                  })
                })
              })
            })
          })
        })
      )

      const { loadGuildTokenStatuses } =
        await import('@/app/api/guild-tokens/token-service')
      const result = await loadGuildTokenStatuses(
        mockSupabase as unknown as SupabaseClient,
        {
          guildCode: 'TEST',
          season: '42'
        }
      )

      expect(getPlayerApiKey).toHaveBeenCalled()
      expect(getPlayerWithRetry).toHaveBeenCalledWith('decrypted-api-key', {
        timeoutMs: 3000,
        maxRetries: 0
      })
      expect(result.players.length).toBe(1)
      expect(result.players[0].data_source).toBe('live')
      expect(result.players[0].tokens_available).toBe(2)
      expect(result.players[0].bombs_available).toBe(1)
      expect(result.players[0].token_next_in_seconds).toBe(7200)
    })

    it('falls back to calculation when API returns no data', async () => {
      getPlayerWithRetry.mockResolvedValue(null)

      mockSupabase.from.mockImplementation(
        createMockFrom({
          player_mapping: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi
                    .fn()
                    .mockResolvedValue({ data: [mockMember], error: null })
                })
              })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  then: vi.fn((cb: (r: { error: null }) => void) =>
                    cb({ error: null })
                  )
                })
              })
            })
          }),
          token_burn_state: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            })
          }),
          EOT_GR_data: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: [], error: null })
                  })
                })
              })
            })
          })
        })
      )

      const { loadGuildTokenStatuses } =
        await import('@/app/api/guild-tokens/token-service')
      const result = await loadGuildTokenStatuses(
        mockSupabase as unknown as SupabaseClient,
        {
          guildCode: 'TEST',
          season: '42'
        }
      )

      expect(result.players[0].data_source).toBe('calculated')
      expect(calculateTokenAvailability).toHaveBeenCalled()
    })

    it('uses calculation for members without API keys', async () => {
      mockSupabase.from.mockImplementation(
        createMockFrom({
          player_mapping: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi
                    .fn()
                    .mockResolvedValue({ data: [mockMemberNoKey], error: null })
                })
              })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  then: vi.fn((cb: (r: { error: null }) => void) =>
                    cb({ error: null })
                  )
                })
              })
            })
          }),
          token_burn_state: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            })
          }),
          EOT_GR_data: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: [], error: null })
                  })
                })
              })
            })
          })
        })
      )

      const { loadGuildTokenStatuses } =
        await import('@/app/api/guild-tokens/token-service')
      const result = await loadGuildTokenStatuses(
        mockSupabase as unknown as SupabaseClient,
        {
          guildCode: 'TEST',
          season: '42'
        }
      )

      expect(result.players[0].data_source).toBe('calculated')
      expect(result.players[0].api_key_is_valid).toBe(false)
    })

    it('retains replay spends whose historical display name is null', async () => {
      mockSupabase.from.mockImplementation(
        createMockFrom({
          player_mapping: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi
                    .fn()
                    .mockResolvedValue({ data: [mockMemberNoKey], error: null })
                })
              })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  then: vi.fn((cb: (r: { error: null }) => void) =>
                    cb({ error: null })
                  )
                })
              })
            })
          }),
          token_burn_state: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            })
          }),
          EOT_GR_data: () => {
            let queriedSeason = ''
            const query = {
              select: vi.fn(() => query),
              eq: vi.fn((column: string, value: string) => {
                if (column === 'Season') queriedSeason = value
                return query
              }),
              in: vi.fn(() => query),
              order: vi.fn().mockImplementation(() =>
                Promise.resolve({
                  data:
                    queriedSeason === '42'
                      ? [{ ...mockBattle, displayName: null }]
                      : [],
                  error: null
                })
              )
            }
            return query
          }
        })
      )

      const { loadGuildTokenStatuses } =
        await import('@/app/api/guild-tokens/token-service')
      await loadGuildTokenStatuses(mockSupabase as unknown as SupabaseClient, {
        guildCode: 'TEST',
        season: '42'
      })

      expect(calculateTokenAvailability).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            displayName: mockMemberNoKey.display_name,
            damageType: 'Battle',
            startedOn: mockBattle.startedOn
          })
        ],
        expect.any(Date)
      )
    })

    it('fetches burn state for current season', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          {
            player_id: 'player-123',
            display_name: 'TestPlayer',
            discord_user_id: 'discord-123',
            tokens_available: 2,
            bombs_available: 1,
            data_source: 'calculated',
            token_next_in_seconds: null,
            bomb_next_in_seconds: null,
            tokens_used: 0,
            max_possible: 0,
            burned_tokens: 3,
            time_over_cap_seconds: 1800
          }
        ],
        error: null
      })
      mockSupabase.from.mockImplementation(
        createMockFrom({
          player_mapping: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi
                    .fn()
                    .mockResolvedValue({ data: [mockMember], error: null })
                })
              })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  then: vi.fn((cb: (r: { error: null }) => void) =>
                    cb({ error: null })
                  )
                })
              })
            })
          }),
          token_burn_state: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      player_id: 'player-123',
                      burned_tokens: 3,
                      time_over_cap_seconds: 1800
                    }
                  ],
                  error: null
                })
              })
            })
          }),
          EOT_GR_data: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: [], error: null })
                  })
                })
              })
            })
          })
        })
      )

      const { loadGuildTokenStatuses } =
        await import('@/app/api/guild-tokens/token-service')
      const result = await loadGuildTokenStatuses(
        mockSupabase as unknown as SupabaseClient,
        {
          guildCode: 'TEST',
          season: '42'
        }
      )

      expect(result.players[0].burned_tokens).toBe(3)
      expect(result.players[0].time_over_cap_seconds).toBe(1800)
    })

    it('includes live_api debug info', async () => {
      mockSupabase.from.mockImplementation(
        createMockFrom({
          player_mapping: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi
                    .fn()
                    .mockResolvedValue({ data: [mockMember], error: null })
                })
              })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  then: vi.fn((cb: (r: { error: null }) => void) =>
                    cb({ error: null })
                  )
                })
              })
            })
          }),
          token_burn_state: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            })
          }),
          EOT_GR_data: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: [], error: null })
                  })
                })
              })
            })
          })
        })
      )

      const { loadGuildTokenStatuses } =
        await import('@/app/api/guild-tokens/token-service')
      const result = await loadGuildTokenStatuses(
        mockSupabase as unknown as SupabaseClient,
        {
          guildCode: 'TEST',
          season: '42'
        }
      )

      expect(result.debug.live_api_fetched).toBe(1)
      expect(result.debug.live_api_eligible).toBe(1)
    })

    it('formats cooldowns with seconds for calculated data', async () => {
      calculateTokenAvailability.mockReturnValue({
        tokensAvailable: 2,
        bombsAvailable: 0,
        tokenCooldown: '1h 30m 45s',
        bombCooldown: '3h 0m 0s',
        tokenNextSeconds: 5445,
        bombNextSeconds: 10800,
        dataSource: 'calculated',
        tokenStatus: { count: 2, refreshTime: 0 }
      })

      mockSupabase.from.mockImplementation(
        createMockFrom({
          player_mapping: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi
                    .fn()
                    .mockResolvedValue({ data: [mockMemberNoKey], error: null })
                })
              })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  then: vi.fn((cb: (r: { error: null }) => void) =>
                    cb({ error: null })
                  )
                })
              })
            })
          }),
          token_burn_state: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            })
          }),
          EOT_GR_data: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: [], error: null })
                  })
                })
              })
            })
          })
        })
      )

      const { loadGuildTokenStatuses } =
        await import('@/app/api/guild-tokens/token-service')
      const result = await loadGuildTokenStatuses(
        mockSupabase as unknown as SupabaseClient,
        {
          guildCode: 'TEST',
          season: '42'
        }
      )

      expect(result.players[0].token_cooldown).toBe('1h 30m 45s')
      expect(result.players[0].bomb_cooldown).toBe('3h 0m 0s')
    })

    it('calculates previous season for numeric seasons', async () => {
      mockSupabase.from.mockImplementation(
        createMockFrom({
          player_mapping: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi
                    .fn()
                    .mockResolvedValue({ data: [mockMember], error: null })
                })
              })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  then: vi.fn((cb: (r: { error: null }) => void) =>
                    cb({ error: null })
                  )
                })
              })
            })
          }),
          token_burn_state: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            })
          }),
          EOT_GR_data: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: [], error: null })
                  })
                })
              })
            })
          })
        })
      )

      const { loadGuildTokenStatuses } =
        await import('@/app/api/guild-tokens/token-service')
      const result = await loadGuildTokenStatuses(
        mockSupabase as unknown as SupabaseClient,
        {
          guildCode: 'TEST',
          season: '42'
        }
      )

      expect(result.debug.seasons_checked).toContain('42')
    })

    it('filters players by live roster when verifyLiveRoster is true', async () => {
      fetchGuildMembersViaTacticus.mockResolvedValue({
        success: true,
        memberIds: ['player-123']
      })

      const members = [
        {
          ...mockMember,
          player_id: 'player-123',
          display_name: 'CurrentPlayer'
        },
        {
          ...mockMember,
          player_id: 'player-stale',
          display_name: 'StalePlayer'
        }
      ]

      mockSupabase.from.mockImplementation(
        createMockFrom({
          guild_config: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    guild_id: 'guild-123',
                    user_id: 'user-123',
                    session_id: 'session-123',
                    client_secret: 'secret',
                    api_key_encrypted: 'encrypted-key'
                  },
                  error: null
                })
              })
            })
          }),
          player_mapping: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi
                    .fn()
                    .mockResolvedValue({ data: members, error: null })
                })
              })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  then: vi.fn((cb: (r: { error: null }) => void) =>
                    cb({ error: null })
                  )
                })
              })
            })
          }),
          token_burn_state: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            })
          }),
          EOT_GR_data: () => ({
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: [], error: null })
                  })
                })
              })
            })
          })
        })
      )

      const { loadGuildTokenStatuses } =
        await import('@/app/api/guild-tokens/token-service')
      const result = await loadGuildTokenStatuses(
        mockSupabase as unknown as SupabaseClient,
        {
          guildCode: 'TEST',
          season: '42',
          verifyLiveRoster: true
        }
      )

      expect(result.players.length).toBe(1)
      expect(result.players[0].player_id).toBe('player-123')
    })
  })

  describe('fetchLiveTokenDataForMembers bounded fan-out', () => {
    // Matching the last-sync fields keeps the write-back change-guard cold.
    const unchangedLivePlayer = {
      progress: {
        guildRaid: {
          tokens: { current: 5, nextTokenInSeconds: 3600 },
          bombTokens: { current: 2, nextTokenInSeconds: 7200 }
        }
      }
    }
    const makeMembers = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ...mockMember,
        player_id: `player-${i}`,
        display_name: `Player${i}`
      }))

    it('caps in-flight upstream requests at the fan-out concurrency', async () => {
      let inFlight = 0
      let peak = 0
      getPlayerWithRetry.mockImplementation(async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 0))
        inFlight -= 1
        return unchangedLivePlayer
      })

      const { fetchLiveTokenDataForMembers } =
        await import('@/app/api/guild-tokens/token-service')
      const result = await fetchLiveTokenDataForMembers(
        makeMembers(23),
        {} as unknown as SupabaseClient
      )

      expect(peak).toBeLessThanOrEqual(4)
      expect(peak).toBeGreaterThan(1)
      expect(result.size).toBe(23)
      expect(getPlayerWithRetry).toHaveBeenCalledTimes(23)
    })

    it('hard-caps the number of members fetched per invocation', async () => {
      getPlayerWithRetry.mockResolvedValue(unchangedLivePlayer)

      const { fetchLiveTokenDataForMembers } =
        await import('@/app/api/guild-tokens/token-service')
      const result = await fetchLiveTokenDataForMembers(
        makeMembers(55),
        {} as unknown as SupabaseClient
      )

      expect(getPlayerWithRetry).toHaveBeenCalledTimes(40)
      expect(result.size).toBe(40)
    })
  })

  describe('writeBackPlayerTokenSnapshot (Phase 3 S1)', () => {
    function makeUpdateChain(error: { message: string } | null = null) {
      const chain: {
        update: ReturnType<typeof vi.fn>
        eq: ReturnType<typeof vi.fn>
        or: ReturnType<typeof vi.fn>
        then: ReturnType<typeof vi.fn>
      } = {
        update: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        or: vi.fn(() => chain),
        then: vi.fn((cb: (r: { error: { message: string } | null }) => void) =>
          cb({ error })
        )
      }
      return chain
    }

    const changedLive = {
      tokensAvailable: 2,
      bombsAvailable: 1,
      tokenNextSeconds: 7200,
      bombNextSeconds: null
    }

    const unchangedLive = {
      tokensAvailable: 5,
      bombsAvailable: 2,
      tokenNextSeconds: 3600,
      bombNextSeconds: 7200
    }

    const client = () => mockSupabase as unknown as SupabaseClient

    it('does not write when no value changed since the last sync', async () => {
      const { writeBackPlayerTokenSnapshot } =
        await import('@/app/api/guild-tokens/token-service')

      const wrote = writeBackPlayerTokenSnapshot(
        client(),
        mockMember,
        unchangedLive
      )

      expect(wrote).toBe(false)
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('writes the changed snapshot with a change-guarded update', async () => {
      const chain = makeUpdateChain()
      mockSupabase.from.mockReturnValue(chain)
      const { writeBackPlayerTokenSnapshot } =
        await import('@/app/api/guild-tokens/token-service')

      const wrote = writeBackPlayerTokenSnapshot(
        client(),
        mockMember,
        changedLive
      )

      expect(wrote).toBe(true)
      expect(mockSupabase.from).toHaveBeenCalledWith('player_mapping')
      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          last_sync_tokens: 2,
          last_sync_bombs: 1,
          next_token_seconds: 7200,
          next_bomb_seconds: null,
          api_key_is_valid: true
        })
      )
      expect(chain.eq).toHaveBeenCalledWith('player_id', 'player-123')
      expect(chain.eq).toHaveBeenCalledWith('is_current', true)
      // No race guard unless the caller asked for one (live-overlay path).
      expect(chain.or).not.toHaveBeenCalled()
    })

    it('writes when only api_key_is_valid needs repair', async () => {
      const chain = makeUpdateChain()
      mockSupabase.from.mockReturnValue(chain)
      const { writeBackPlayerTokenSnapshot } =
        await import('@/app/api/guild-tokens/token-service')

      const wrote = writeBackPlayerTokenSnapshot(
        client(),
        { ...mockMember, api_key_is_valid: false },
        unchangedLive
      )

      expect(wrote).toBe(true)
      expect(chain.update).toHaveBeenCalled()
    })

    it('applies the last_sync_at race guard when onlyIfLastSyncBefore is given', async () => {
      const chain = makeUpdateChain()
      mockSupabase.from.mockReturnValue(chain)
      const { writeBackPlayerTokenSnapshot } =
        await import('@/app/api/guild-tokens/token-service')

      const fetchedAt = '2026-07-17T12:00:00.000Z'
      writeBackPlayerTokenSnapshot(client(), mockMember, changedLive, {
        onlyIfLastSyncBefore: fetchedAt
      })

      // Skips the write when last_sync_at is newer than the fetch (a Discord overlay raced us).
      // The UNQUOTED PostgREST form is canonical; a reshaped value is a regression.
      expect(chain.or).toHaveBeenCalledWith(
        `last_sync_at.is.null,last_sync_at.lt.${fetchedAt}`
      )
    })

    it('logs and does not throw when the update fails', async () => {
      const chain = makeUpdateChain({ message: 'db down' })
      mockSupabase.from.mockReturnValue(chain)
      const { writeBackPlayerTokenSnapshot } =
        await import('@/app/api/guild-tokens/token-service')

      expect(() =>
        writeBackPlayerTokenSnapshot(client(), mockMember, changedLive)
      ).not.toThrow()
    })
  })
})
