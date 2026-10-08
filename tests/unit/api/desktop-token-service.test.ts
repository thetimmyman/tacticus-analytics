import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const live = vi.hoisted(() => vi.fn())
const roster = vi.hoisted(() => vi.fn())
const guildRoster = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/token-service/live-fetch', () => ({
  fetchLiveTokenDataForMembers: live
}))
vi.mock('@/app/lib/sync/api-operations', () => ({
  fetchGuildMembersViaLoki: roster,
  fetchGuildMembersViaTacticus: roster
}))
vi.mock('@/app/lib/data/guild-roster', () => ({
  guildRosterQuery: guildRoster
}))
import { loadGuildTokenStatuses } from '@/app/lib/token-service'

const row = {
  player_id: 'synthetic-player',
  display_name: 'Synthetic Member',
  tokens_available: 2,
  token_next_in_seconds: 1800,
  bombs_available: 0,
  bomb_next_in_seconds: 3600,
  tokens_used: 4,
  max_possible: 7,
  burned_tokens: 1,
  time_over_cap_seconds: 43200,
  last_sync_at: '2026-01-01T00:00:00Z',
  data_source: 'cached'
}
describe('desktop cached token-state adapter', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
    vi.clearAllMocks()
  })
  afterEach(() => vi.unstubAllEnvs())
  it('uses canonical local adapter with honest snapshot metadata and cannot opt into live fetch', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null })
    const db = { rpc } as unknown as SupabaseClient
    const result = await loadGuildTokenStatuses(db, {
      guildCode: 'SYN001',
      season: '100',
      clusterCode: 'SYN',
      verifyLiveRoster: true,
      skipLiveOverlay: false
    })
    expect(rpc).toHaveBeenCalledWith('desktop_get_player_token_state', {
      p_guild_code: 'SYN001',
      p_season: '100',
      p_cluster_code: 'SYN',
      p_player_id: null
    })
    expect(result.players[0]).toMatchObject({
      tokens_available: 2,
      bombs_available: 0,
      data_source: 'cached',
      last_sync_at: '2026-01-01T00:00:00Z',
      api_key_is_valid: false,
      burned_tokens: 1,
      time_over_cap_seconds: 43200
    })
    expect(result.debug.live_api_fetched).toBe(0)
    expect(live).not.toHaveBeenCalled()
    expect(roster).not.toHaveBeenCalled()
    expect(guildRoster).not.toHaveBeenCalled()
  })
  it('fails closed if selected local RPC is missing without legacy reads or live fallback', async () => {
    const db = {
      rpc: vi
        .fn()
        .mockResolvedValue({
          data: null,
          error: { message: 'missing selected function' }
        })
    } as unknown as SupabaseClient
    await expect(
      loadGuildTokenStatuses(db, { guildCode: 'SYN001', season: '100' })
    ).rejects.toThrow()
    expect(guildRoster).not.toHaveBeenCalled()
    expect(live).not.toHaveBeenCalled()
  })
  it.each([
    null,
    {},
    [{ ...row, tokens_available: 9 }],
    [{ ...row, bombs_available: -1 }],
    [{ ...row, data_source: 'live' }]
  ])('refuses malformed cached RPC state %j', async (data) => {
    const db = {
      rpc: vi.fn().mockResolvedValue({ data, error: null })
    } as unknown as SupabaseClient
    await expect(
      loadGuildTokenStatuses(db, { guildCode: 'SYN001', season: '100' })
    ).rejects.toThrow()
    expect(guildRoster).not.toHaveBeenCalled()
    expect(live).not.toHaveBeenCalled()
  })
})
