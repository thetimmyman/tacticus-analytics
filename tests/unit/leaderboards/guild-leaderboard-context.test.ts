import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@tacticus/app-core/types'

type FakeSupabaseOptions = {
  guildError?: unknown
  guildData?: {
    guild_code: string | null
    display_name: string | null
    guild_tag: string | null
    cluster_code: string | null
  } | null
}

/** The season leg goes through /api/season/latest; no raw EOT_GR_data season fallback survives. */
function fakeSupabase(options: FakeSupabaseOptions = {}) {
  const guildSingle = vi.fn(async () => ({
    data: options.guildData ?? null,
    error: options.guildError ?? null
  }))
  const guildEq = vi.fn(() => ({ single: guildSingle }))
  const guildSelect = vi.fn(() => ({ eq: guildEq }))

  const from = vi.fn((table: string) => {
    if (table === 'guild_config') {
      return { select: guildSelect }
    }
    throw new Error(`unexpected supabase table query: ${table}`)
  })

  const supabase = { from }

  return {
    supabase: supabase as unknown as SupabaseClient<Database>,
    spies: { from, guildSelect, guildEq, guildSingle }
  }
}

const getLatestSeasonClientMock = vi.fn<() => Promise<string | null>>()

async function loadWithMockedSeasonClient(season: string | null) {
  vi.resetModules()
  getLatestSeasonClientMock.mockReset()
  getLatestSeasonClientMock.mockResolvedValue(season)
  vi.doMock('@/app/lib/data/get-latest-season-client', () => ({
    getLatestSeasonClient: getLatestSeasonClientMock
  }))
  return import('@/app/(dashboard)/leaderboards/hooks/useGuildLeaderboardContext')
}

async function loadWithRealSeasonClient() {
  vi.resetModules()
  vi.doUnmock('@/app/lib/data/get-latest-season-client')
  return import('@/app/(dashboard)/leaderboards/hooks/useGuildLeaderboardContext')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('@/app/lib/data/get-latest-season-client')
})

describe('fetchGuildLeaderboardContext', () => {
  it('resolves season, formatted guild label, and cluster flag once', async () => {
    const { fetchGuildLeaderboardContext, GUILD_LEADERBOARD_CONTEXT_SELECT } =
      await loadWithMockedSeasonClient('104')
    const { supabase, spies } = fakeSupabase({
      guildData: {
        guild_code: 'abc',
        display_name: 'CLU Alpha',
        guild_tag: 'CLU',
        cluster_code: 'CLU'
      }
    })

    await expect(
      fetchGuildLeaderboardContext('abc', supabase)
    ).resolves.toEqual({
      season: '104',
      guildDisplayName: 'CLU Alpha',
      hasCluster: true
    })
    expect(spies.guildSelect).toHaveBeenCalledWith(
      GUILD_LEADERBOARD_CONTEXT_SELECT
    )
    expect(spies.guildEq).toHaveBeenCalledWith('guild_code', 'abc')
    expect(spies.guildSingle).toHaveBeenCalledTimes(1)
    expect(getLatestSeasonClientMock).toHaveBeenCalledTimes(1)
    expect(getLatestSeasonClientMock).toHaveBeenCalledWith()
    expect(spies.from.mock.calls.map(([table]) => table)).toEqual([
      'guild_config'
    ])
  })

  it('throws instead of substituting a season when /api/season/latest fails, and never queries a raw season table', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({})
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { fetchGuildLeaderboardContext } = await loadWithRealSeasonClient()
    const { supabase, spies } = fakeSupabase({
      guildData: {
        guild_code: 'abc',
        display_name: null,
        guild_tag: 'TAG',
        cluster_code: null
      }
    })

    await expect(fetchGuildLeaderboardContext('abc', supabase)).rejects.toThrow(
      'Season data unavailable'
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/season/latest')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(spies.from.mock.calls.map(([table]) => table)).toEqual([
      'guild_config'
    ])
  })

  it('does not fall back to a hard-coded stale season when the season lookup resolves nothing', async () => {
    const { fetchGuildLeaderboardContext } =
      await loadWithMockedSeasonClient(null)
    const { supabase } = fakeSupabase({
      guildData: {
        guild_code: 'abc',
        display_name: 'CLU Alpha',
        guild_tag: 'CLU',
        cluster_code: 'CLU'
      }
    })

    await expect(fetchGuildLeaderboardContext('abc', supabase)).rejects.toThrow(
      'Season data unavailable'
    )
  })

  it('falls back to the guild tag when display_name is missing', async () => {
    const { fetchGuildLeaderboardContext } =
      await loadWithMockedSeasonClient('105')
    const { supabase } = fakeSupabase({
      guildData: {
        guild_code: 'abc',
        display_name: null,
        guild_tag: 'TAG',
        cluster_code: null
      }
    })

    await expect(
      fetchGuildLeaderboardContext('abc', supabase)
    ).resolves.toEqual({
      season: '105',
      guildDisplayName: 'TAG',
      hasCluster: false
    })
  })

  it('falls back to the guild code when guild_config has no matching row', async () => {
    const { fetchGuildLeaderboardContext } =
      await loadWithMockedSeasonClient('104')
    const { supabase } = fakeSupabase({
      guildError: { code: 'PGRST116', message: 'No rows found' }
    })

    await expect(
      fetchGuildLeaderboardContext('abc', supabase)
    ).resolves.toEqual({
      season: '104',
      guildDisplayName: 'ABC',
      hasCluster: false
    })
  })

  it('surfaces non-not-found guild_config errors instead of masking missing cluster metadata', async () => {
    const { fetchGuildLeaderboardContext } =
      await loadWithMockedSeasonClient('104')
    const { supabase } = fakeSupabase({
      guildError: { code: 'PGRST301', message: 'permission denied' }
    })

    await expect(fetchGuildLeaderboardContext('abc', supabase)).rejects.toThrow(
      'Failed to load guild leaderboard context: permission denied'
    )
  })
})

describe('fetchGuildLeaderboardContext season leg over the real client helper', () => {
  const okGuild = {
    guild_code: 'abc',
    display_name: 'CLU Alpha',
    guild_tag: 'CLU',
    cluster_code: 'CLU'
  }

  function stubSeasonResponse(body: unknown) {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body
    }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('flows the /api/season/latest response body through as the season', async () => {
    const fetchMock = stubSeasonResponse({ season: '104' })
    const { fetchGuildLeaderboardContext } = await loadWithRealSeasonClient()
    const { supabase, spies } = fakeSupabase({ guildData: okGuild })

    await expect(
      fetchGuildLeaderboardContext('abc', supabase)
    ).resolves.toEqual({
      season: '104',
      guildDisplayName: 'CLU Alpha',
      hasCluster: true
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/season/latest')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(spies.from.mock.calls.map(([table]) => table)).toEqual([
      'guild_config'
    ])
  })

  it.each([
    ['a null season', { season: null }],
    ['an empty-string season', { season: '' }],
    ['a non-string season', { season: 123 }],
    ['a body with no season key', {}]
  ])(
    'rejects rather than passing %s off as a resolved season',
    async (_label, body) => {
      const fetchMock = stubSeasonResponse(body)
      const { fetchGuildLeaderboardContext } = await loadWithRealSeasonClient()
      const { supabase } = fakeSupabase({ guildData: okGuild })

      await expect(
        fetchGuildLeaderboardContext('abc', supabase)
      ).rejects.toThrow('Season data unavailable')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('rejects when the season fetch throws (offline / network error)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchGuildLeaderboardContext } = await loadWithRealSeasonClient()
    const { supabase } = fakeSupabase({ guildData: okGuild })

    await expect(fetchGuildLeaderboardContext('abc', supabase)).rejects.toThrow(
      'Season data unavailable'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
