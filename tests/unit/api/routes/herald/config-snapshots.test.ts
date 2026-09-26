import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockDb: ReturnType<typeof vi.fn>
let mockRequireGuildMember: ReturnType<typeof vi.fn>
let mockRequireGuildOfficerOrClusterLeader: ReturnType<typeof vi.fn>

const user = { id: 'user-1' }

const snapshot = {
  guild_config: null,
  herald_meta_role_mapping: [
    {
      meta_team_slug: 'Admech',
      rarity_set: null,
      discord_role_id: '123456789012345678',
      display_label: 'Admech',
      enabled: true,
      active_boss_ids: ['Magnus_E0'],
      auto_update: false,
      prime_scope: 'all',
      track_only: false,
      custom_message_only: false
    }
  ],
  herald_boss_config: [
    {
      boss_id: 'Magnus_E0',
      rarity_set: null,
      enabled: true,
      webhook_config_ids: ['00000000-0000-0000-0000-000000000001'],
      discord_role_ids: ['123456789012345678'],
      discord_role_labels: { '123456789012345678': 'Admech' },
      extra_links: [],
      extra_videos: [],
      custom_message_url: null,
      notes: null,
      side1_notes: null,
      side2_notes: null,
      side1_behaviour: 'kill',
      side2_behaviour: 'kill',
      side1_threshold_hp_pct: null,
      side2_threshold_hp_pct: null,
      ping_mode: 'per_side',
      ping_mode_explicit: false
    }
  ]
}

const versionRow = {
  id: 42,
  guild_code: 'GUILD1',
  season: 98,
  is_default: false,
  created_at: '2026-05-29T12:00:00.000Z',
  config_snapshot: snapshot
}

const makeClient = (row = versionRow) => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.limit = vi.fn(() => query)
  query.order = vi.fn(() => query)
  query.maybeSingle = vi.fn(async () => ({ data: row, error: null }))

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } }))
    },
    from: vi.fn(() => query),
    rpc: vi.fn(async () => ({ data: '99', error: null })),
    __query: query
  }
}

describe('Herald config snapshot readers (WI-735)', () => {
  beforeEach(() => {
    vi.resetModules()
    mockRequireGuildMember = vi.fn(async () => ({
      role: 'officer',
      guild_code: 'GUILD1'
    }))
    mockRequireGuildOfficerOrClusterLeader = vi.fn(async () => ({
      role: 'officer',
      guild_code: 'GUILD1'
    }))
    vi.doMock('@/app/lib/auth/guild-permissions', () => ({
      requireGuildMember: mockRequireGuildMember,
      requireGuildOfficerOrClusterLeader: mockRequireGuildOfficerOrClusterLeader
    }))
    vi.doMock('@tacticus/app-core/app-cache', () => ({
      appCache: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn()
      }
    }))
  })

  it('returns role mappings from a season snapshot', async () => {
    const client = makeClient()
    mockDb = vi.fn(async () => client)
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))

    const mod = await import('@/app/api/herald/role-mappings/route')
    const response = await mod.GET(
      new Request(
        'http://localhost/api/herald/role-mappings?guild_code=GUILD1&season=98'
      )
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.mappings).toHaveLength(1)
    expect(body.mappings[0]).toMatchObject({
      id: -1,
      guild_code: 'GUILD1',
      meta_team_slug: 'Admech',
      discord_role_id: '123456789012345678'
    })
    expect(body.snapshot).toMatchObject({ id: 42, season: 98 })
    expect(client.__query.eq).toHaveBeenCalledWith('season', 98)
  })

  it('returns a boss config from the default snapshot', async () => {
    const defaultRow = { ...versionRow, season: null, is_default: true }
    const client = makeClient(defaultRow)
    mockDb = vi.fn(async () => client)
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))

    const mod = await import('@/app/api/herald/boss-config/route')
    const response = await mod.GET(
      new Request(
        'http://localhost/api/herald/boss-config?guild_code=GUILD1&boss_id=Magnus_E0&rarity_set=&default=1'
      )
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.config).toMatchObject({
      id: -1,
      guild_code: 'GUILD1',
      boss_id: 'Magnus_E0'
    })
    expect(body.snapshot).toMatchObject({ id: 42, is_default: true })
    expect(client.__query.eq).toHaveBeenCalledWith('is_default', true)
  })

  it('keeps retired replay fields out of the API while disabling them in the legacy RPC', async () => {
    const rpcSingle = vi.fn(async () => ({
      data: { id: 'row-1' },
      error: null
    }))
    const client = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user } }))
      },
      from: vi.fn(),
      rpc: vi.fn(() => ({ single: rpcSingle }))
    }
    mockDb = vi.fn(async () => client)
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))

    const mod = await import('@/app/api/herald/boss-config/route')
    const response = await mod.POST(
      new Request('http://localhost/api/herald/boss-config', {
        method: 'POST',
        body: JSON.stringify({
          guild_code: 'GUILD1',
          boss_id: 'Magnus_E0',
          rarity_set: null,
          enabled: true,
          webhook_config_ids: [],
          discord_role_ids: [],
          extra_links: [],
          extra_videos: [],
          side1_behaviour: 'kill',
          side2_behaviour: 'kill',
          ping_mode: 'per_side'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(mockRequireGuildOfficerOrClusterLeader).toHaveBeenCalledWith(
      client,
      user.id,
      'GUILD1',
      '/api/herald/boss-config'
    )
    expect(client.rpc).toHaveBeenCalledWith(
      'upsert_herald_boss_config',
      expect.objectContaining({
        p_guild_code: 'GUILD1',
        p_boss_id: 'Magnus_E0',
        p_discord_role_ids: [],
        p_discord_role_labels: null,
        p_pinned_replay_ids: [],
        p_replay_auto_count: 0,
        p_replay_link_mode: 'off'
      })
    )
    const body = await response.json()
    expect(body.config).not.toHaveProperty('replay_link_mode')
  })

  it('persists structured labeled role entries through the boss-config upsert RPC', async () => {
    const rpcSingle = vi.fn(async () => ({
      data: {
        id: 'row-1',
        discord_role_ids: ['123456789012345678'],
        discord_role_labels: { '123456789012345678': 'Main Team' }
      },
      error: null
    }))
    const client = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user } }))
      },
      from: vi.fn(),
      rpc: vi.fn(() => ({ single: rpcSingle }))
    }
    mockDb = vi.fn(async () => client)
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))

    const mod = await import('@/app/api/herald/boss-config/route')
    const response = await mod.POST(
      new Request('http://localhost/api/herald/boss-config', {
        method: 'POST',
        body: JSON.stringify({
          guild_code: 'GUILD1',
          boss_id: 'Magnus_E0',
          rarity_set: null,
          enabled: true,
          webhook_config_ids: [],
          discord_role_ids: [{ id: '123456789012345678', label: 'Main Team' }],
          extra_links: [],
          extra_videos: [],
          side1_behaviour: 'kill',
          side2_behaviour: 'kill',
          ping_mode: 'per_side'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(client.rpc).toHaveBeenCalledWith(
      'upsert_herald_boss_config',
      expect.objectContaining({
        p_discord_role_ids: ['123456789012345678'],
        p_discord_role_labels: { '123456789012345678': 'Main Team' }
      })
    )
  })

  it('clears stored labels when structured role entries have blank labels', async () => {
    const rpcSingle = vi.fn(async () => ({
      data: {
        id: 'row-1',
        discord_role_ids: ['123456789012345678']
      },
      error: null
    }))
    const client = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user } }))
      },
      from: vi.fn(),
      rpc: vi.fn(() => ({ single: rpcSingle }))
    }
    mockDb = vi.fn(async () => client)
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))

    const mod = await import('@/app/api/herald/boss-config/route')
    const response = await mod.POST(
      new Request('http://localhost/api/herald/boss-config', {
        method: 'POST',
        body: JSON.stringify({
          guild_code: 'GUILD1',
          boss_id: 'Magnus_E0',
          rarity_set: null,
          enabled: true,
          webhook_config_ids: [],
          discord_role_ids: [{ id: '123456789012345678', label: '' }],
          extra_links: [],
          extra_videos: [],
          side1_behaviour: 'kill',
          side2_behaviour: 'kill',
          ping_mode: 'per_side'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(client.rpc).toHaveBeenCalledWith(
      'upsert_herald_boss_config',
      expect.objectContaining({
        p_discord_role_ids: ['123456789012345678'],
        p_discord_role_labels: {}
      })
    )
  })

  it('rejects malformed structured role entries instead of clearing roles', async () => {
    const client = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user } }))
      },
      from: vi.fn(),
      rpc: vi.fn()
    }
    mockDb = vi.fn(async () => client)
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))

    const mod = await import('@/app/api/herald/boss-config/route')
    const response = await mod.POST(
      new Request('http://localhost/api/herald/boss-config', {
        method: 'POST',
        body: JSON.stringify({
          guild_code: 'GUILD1',
          boss_id: 'Magnus_E0',
          discord_role_ids: [{ label: 'Main Team' }]
        })
      })
    )

    expect(response.status).toBe(400)
    expect(client.rpc).not.toHaveBeenCalled()
  })
})
