import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

function createGetRequest(cluster?: string): NextRequest {
  const url = cluster
    ? `http://localhost/api/cluster/discord-links?cluster=${cluster}`
    : 'http://localhost/api/cluster/discord-links'
  return new NextRequest(url, { method: 'GET' })
}

function createPostRequest(body: any): NextRequest {
  return new NextRequest('http://localhost/api/cluster/discord-links', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  })
}

function createDeleteRequest(body: any): NextRequest {
  return new NextRequest('http://localhost/api/cluster/discord-links', {
    method: 'DELETE',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  })
}

function createChainedMock(data: any = null, error: any = null) {
  const mockChain: any = {}
  mockChain.select = vi.fn().mockReturnValue(mockChain)
  mockChain.eq = vi.fn().mockReturnValue(mockChain)
  mockChain.in = vi.fn().mockReturnValue(mockChain)
  mockChain.order = vi.fn().mockReturnValue(mockChain)
  mockChain.insert = vi.fn().mockReturnValue(mockChain)
  mockChain.update = vi.fn().mockReturnValue(mockChain)
  mockChain.single = vi.fn().mockResolvedValue({ data, error })
  mockChain.maybeSingle = vi.fn().mockResolvedValue({ data, error })
  mockChain.then = (resolve: any) =>
    resolve({ data: Array.isArray(data) ? data : [], error })
  return mockChain
}

describe('GET /api/cluster/discord-links', () => {
  let GET: (req: NextRequest) => Promise<Response>
  let mockRequireRole: ReturnType<typeof vi.fn>
  let mockServiceSupabase: { from: ReturnType<typeof vi.fn> }
  let mockGuildConfigServiceGetBasic: ReturnType<typeof vi.fn>
  let mockGuildConfigServiceGetClusterGuilds: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    mockRequireRole = vi.fn()
    mockGuildConfigServiceGetBasic = vi.fn().mockResolvedValue(null)
    mockGuildConfigServiceGetClusterGuilds = vi.fn().mockResolvedValue([])
    mockServiceSupabase = { from: vi.fn() }

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      }
    }))
    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireRole: mockRequireRole,
        requireRoleForApi: mockRequireRole
      }
    })
    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: vi.fn(() => mockServiceSupabase)
    }))
    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        getBasic: (...args: any[]) => mockGuildConfigServiceGetBasic(...args),
        getClusterGuilds: (...args: any[]) =>
          mockGuildConfigServiceGetClusterGuilds(...args)
      }
    }))

    const routeModule = await import('@/app/api/cluster/discord-links/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 500 when requireRole throws', async () => {
    mockRequireRole.mockRejectedValue(new Error('Unauthorized'))

    const response = await GET(createGetRequest('CLUSTER1'))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error).toBeDefined()
    expect(json.error.message).toBe('Unexpected server error.')
  })

  it('maps AuthError to 401 with the success:false envelope', async () => {
    const { AuthError } = await import('@/app/lib/auth')
    mockRequireRole.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )

    const response = await GET(createGetRequest('CLUSTER1'))
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json.error.message).toBe('Authentication required')
    expect(json.error.metadata).toEqual({
      success: false,
      error: 'Authentication required',
      code: 'UNAUTHENTICATED'
    })
  })

  it('returns 400 when no cluster can be resolved', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: null, guild_code: null }
    })
    mockServiceSupabase.from.mockReturnValue(createChainedMock(null))

    const response = await GET(createGetRequest())
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(json.error.message).toBe('Cluster code is required.')
  })

  it('returns 403 when user cluster does not match requested cluster', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })

    const response = await GET(createGetRequest('CLUSTER2'))
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.error).toBeDefined()
    expect(json.error.message).toBe('Access denied for this cluster.')
  })

  it('allows a genuine app admin to access any cluster', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: {
        cluster_code: 'CLUSTER1',
        guild_code: null,
        is_app_admin: true
      }
    })
    mockGuildConfigServiceGetClusterGuilds.mockResolvedValue([])
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (
        table === 'discord_server_guilds' ||
        table === 'discord_invite_codes'
      ) {
        const chain = createChainedMock([])
        return chain
      }
      return createChainedMock([])
    })

    const response = await GET(createGetRequest('CLUSTER2'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it('refuses a foreign cluster when role is SPOOFED to admin via user_metadata', async () => {
    // app_role has no 'admin' member, so this role can only come from client-writable user_metadata.
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'admin' },
      profile: {
        cluster_code: 'CLUSTER1',
        guild_code: null,
        is_app_admin: false
      }
    })
    mockGuildConfigServiceGetClusterGuilds.mockResolvedValue([])

    const response = await GET(createGetRequest('CLUSTER2'))

    expect(response.status).toBe(403)
    expect(mockGuildConfigServiceGetClusterGuilds).not.toHaveBeenCalled()
  })

  it('returns 500 when guild query fails', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })
    mockGuildConfigServiceGetClusterGuilds.mockRejectedValue(
      new Error('DB error')
    )

    const response = await GET(createGetRequest('CLUSTER1'))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Unable to load guild directory.')
  })

  it('returns success with empty guilds', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })
    mockGuildConfigServiceGetClusterGuilds.mockResolvedValue([])
    mockServiceSupabase.from.mockImplementation(() => createChainedMock([]))

    const response = await GET(createGetRequest('CLUSTER1'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.guilds).toEqual([])
    expect(json.data.clusterCode).toBe('CLUSTER1')
  })

  it('resolves cluster from guild_code when cluster_code is null', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: null, guild_code: 'GUILD1' }
    })
    mockGuildConfigServiceGetBasic.mockResolvedValue({
      cluster_code: 'CLUSTER1'
    })
    mockGuildConfigServiceGetClusterGuilds.mockResolvedValue([])
    mockServiceSupabase.from.mockImplementation(() => createChainedMock([]))

    const response = await GET(createGetRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.clusterCode).toBe('CLUSTER1')
  })

  it('returns guilds with discord links and invites', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })

    const guilds = [
      {
        guild_code: 'GUILD1',
        display_name: 'Guild One',
        cluster_code: 'CLUSTER1'
      }
    ]
    const links = [
      {
        game_guild_code: 'GUILD1',
        discord_guild_id: '123',
        invited_with_code: 'ABC',
        linked_at: '2025-01-01',
        linked_by_user_id: 'user-1'
      }
    ]
    const invites = [
      {
        id: 1,
        guild_code: 'GUILD1',
        invite_code: 'XYZ',
        created_at: '2025-01-01',
        expires_at: '2025-02-01',
        is_active: true,
        max_uses: 5,
        current_uses: 1,
        invite_scope: 'guild'
      }
    ]

    mockGuildConfigServiceGetClusterGuilds.mockResolvedValue(guilds)
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'discord_server_guilds') {
        const chain = createChainedMock(links)
        chain.then = (resolve: any) => resolve({ data: links, error: null })
        return chain
      }
      if (table === 'discord_invite_codes') {
        const chain = createChainedMock(invites)
        chain.then = (resolve: any) => resolve({ data: invites, error: null })
        return chain
      }
      return createChainedMock([])
    })

    const response = await GET(createGetRequest('CLUSTER1'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.guilds[0].guildCode).toBe('GUILD1')
    expect(json.data.guilds[0].discordLink).toBeTruthy()
  })
})

describe('POST /api/cluster/discord-links', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let mockRequireRole: ReturnType<typeof vi.fn>
  let mockServiceSupabase: { from: ReturnType<typeof vi.fn> }
  let mockGuildConfigServiceGetBasic: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    mockRequireRole = vi.fn()
    mockGuildConfigServiceGetBasic = vi.fn().mockResolvedValue(null)
    mockServiceSupabase = { from: vi.fn() }

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      }
    }))
    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireRole: mockRequireRole,
        requireRoleForApi: mockRequireRole
      }
    })
    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: vi.fn(() => mockServiceSupabase)
    }))
    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        getBasic: (...args: any[]) => mockGuildConfigServiceGetBasic(...args),
        getClusterGuilds: vi.fn().mockResolvedValue([])
      }
    }))

    const routeModule = await import('@/app/api/cluster/discord-links/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 500 when requireRole throws', async () => {
    mockRequireRole.mockRejectedValue(new Error('Unauthorized'))

    const response = await POST(createPostRequest({ guildCode: 'GUILD1' }))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error).toBeDefined()
    expect(json.error.message).toBe('Unexpected server error.')
  })

  it('maps AuthError to 403 with the success:false envelope', async () => {
    const { AuthError } = await import('@/app/lib/auth')
    mockRequireRole.mockRejectedValue(
      new AuthError('Officer role required', 'INSUFFICIENT_ROLE')
    )

    const response = await POST(createPostRequest({ guildCode: 'GUILD1' }))
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.error.metadata).toEqual({
      success: false,
      error: 'Officer role required',
      code: 'INSUFFICIENT_ROLE'
    })
  })

  it('returns 400 when guild scope and no guildCode', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })

    const response = await POST(createPostRequest({ scope: 'guild' }))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toBe('Guild code is required.')
  })

  it('returns 404 when guild not found', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })
    mockGuildConfigServiceGetBasic.mockResolvedValue(null)

    const response = await POST(
      createPostRequest({ guildCode: 'UNKNOWN', scope: 'guild' })
    )
    const json = await response.json()

    expect(response.status).toBe(404)
    expect(json.error.message).toBe('Guild UNKNOWN was not found.')
  })

  it('returns 403 when guild cluster does not match user cluster', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })
    mockGuildConfigServiceGetBasic.mockResolvedValue({
      guild_code: 'GUILD1',
      cluster_code: 'CLUSTER2'
    })

    const response = await POST(
      createPostRequest({ guildCode: 'GUILD1', scope: 'guild' })
    )
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.error.message).toBe(
      'You can only manage guilds within your cluster.'
    )
  })

  it('creates invite with default values', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })

    const newInvite = {
      id: 1,
      guild_code: 'GUILD1',
      invite_code: 'ABC123',
      created_at: '2025-01-01',
      expires_at: '2025-02-01',
      max_uses: 1,
      current_uses: 0,
      is_active: true
    }

    mockGuildConfigServiceGetBasic.mockResolvedValue({
      guild_code: 'GUILD1',
      cluster_code: 'CLUSTER1'
    })
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'discord_invite_codes') {
        return createChainedMock(newInvite)
      }
      return createChainedMock(null)
    })

    const response = await POST(
      createPostRequest({ guildCode: 'GUILD1', scope: 'guild' })
    )
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(newInvite)
  })

  it('rejects cluster-scoped invites', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })

    const response = await POST(createPostRequest({ scope: 'cluster' }))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toBe('Cluster invites are not supported.')
  })

  it('caps maxUses at 50', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })

    let insertPayload: any = null
    mockGuildConfigServiceGetBasic.mockResolvedValue({
      guild_code: 'GUILD1',
      cluster_code: 'CLUSTER1'
    })
    mockServiceSupabase.from.mockImplementation((table: string) => {
      const chain = createChainedMock({ id: 1 })
      if (table === 'discord_invite_codes') {
        chain.insert = vi.fn((data) => {
          insertPayload = data
          return chain
        })
      }
      return chain
    })

    await POST(
      createPostRequest({ scope: 'guild', guildCode: 'GUILD1', maxUses: 100 })
    )

    expect(insertPayload.max_uses).toBe(50)
  })

  it('returns 500 when insert fails', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })
    mockGuildConfigServiceGetBasic.mockResolvedValue({
      guild_code: 'GUILD1',
      cluster_code: 'CLUSTER1'
    })
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'discord_invite_codes') {
        return createChainedMock(null, { message: 'Insert failed' })
      }
      return createChainedMock(null)
    })

    const response = await POST(
      createPostRequest({ scope: 'guild', guildCode: 'GUILD1' })
    )
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Unable to create invite code.')
  })
})

describe('DELETE /api/cluster/discord-links', () => {
  let DELETE: (req: NextRequest) => Promise<Response>
  let mockRequireRole: ReturnType<typeof vi.fn>
  let mockServiceSupabase: { from: ReturnType<typeof vi.fn> }
  let mockGuildConfigServiceGetBasic: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    mockRequireRole = vi.fn()
    mockGuildConfigServiceGetBasic = vi.fn().mockResolvedValue(null)
    mockServiceSupabase = { from: vi.fn() }

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      }
    }))
    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireRole: mockRequireRole,
        requireRoleForApi: mockRequireRole
      }
    })
    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: vi.fn(() => mockServiceSupabase)
    }))
    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        getBasic: (...args: any[]) => mockGuildConfigServiceGetBasic(...args),
        getClusterGuilds: vi.fn().mockResolvedValue([])
      }
    }))

    const routeModule = await import('@/app/api/cluster/discord-links/route')
    DELETE = routeModule.DELETE
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 500 when requireRole throws', async () => {
    mockRequireRole.mockRejectedValue(new Error('Unauthorized'))

    const response = await DELETE(createDeleteRequest({ inviteId: 1 }))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error).toBeDefined()
    expect(json.error.message).toBe('Unexpected server error.')
  })

  it('maps AuthError to 401 with the success:false envelope', async () => {
    const { AuthError } = await import('@/app/lib/auth')
    mockRequireRole.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )

    const response = await DELETE(createDeleteRequest({ inviteId: 1 }))
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json.error.metadata).toEqual({
      success: false,
      error: 'Authentication required',
      code: 'UNAUTHENTICATED'
    })
  })

  it('returns 400 when inviteId is missing', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })

    const response = await DELETE(createDeleteRequest({}))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error.message).toBe('Invite ID is required.')
  })

  it('returns 404 when invite not found', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })
    mockServiceSupabase.from.mockReturnValue(createChainedMock(null))

    const response = await DELETE(createDeleteRequest({ inviteId: 999 }))
    const json = await response.json()

    expect(response.status).toBe(404)
    expect(json.error.message).toBe('Invite not found.')
  })

  it('returns 403 when user cannot access invite cluster', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })

    let callCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      callCount++
      if (table === 'discord_invite_codes' && callCount === 1) {
        return createChainedMock({
          id: 1,
          guild_code: 'GUILD1',
          invite_scope: 'cluster',
          is_active: true
        })
      }
      return createChainedMock(null)
    })
    mockGuildConfigServiceGetBasic.mockResolvedValue({
      cluster_code: 'CLUSTER2'
    })

    const response = await DELETE(createDeleteRequest({ inviteId: 1 }))
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.error.message).toBe('Access denied for this invite.')
  })

  it('successfully deactivates invite', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })

    let callCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      callCount++
      if (table === 'discord_invite_codes' && callCount === 1) {
        return createChainedMock({
          id: 1,
          guild_code: 'GUILD1',
          invite_scope: 'cluster',
          is_active: true
        })
      }
      if (table === 'discord_invite_codes' && callCount === 2) {
        const chain = createChainedMock()
        chain.update = vi.fn().mockReturnValue(chain)
        chain.eq = vi.fn().mockResolvedValue({ error: null })
        return chain
      }
      return createChainedMock(null)
    })
    mockGuildConfigServiceGetBasic.mockResolvedValue({
      cluster_code: 'CLUSTER1'
    })

    const response = await DELETE(createDeleteRequest({ inviteId: 1 }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it('resolves cluster from guild_code when cluster_code is null on invite', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })

    let callCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      callCount++
      if (table === 'discord_invite_codes' && callCount === 1) {
        return createChainedMock({
          id: 1,
          guild_code: 'GUILD1',
          cluster_code: null,
          invite_scope: 'guild',
          is_active: true
        })
      }
      if (table === 'discord_invite_codes') {
        const chain = createChainedMock()
        chain.update = vi.fn().mockReturnValue(chain)
        chain.eq = vi.fn().mockResolvedValue({ error: null })
        return chain
      }
      return createChainedMock(null)
    })
    mockGuildConfigServiceGetBasic.mockResolvedValue({
      cluster_code: 'CLUSTER1'
    })

    const response = await DELETE(createDeleteRequest({ inviteId: 1 }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it('returns 500 when update fails', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: { cluster_code: 'CLUSTER1', guild_code: null }
    })

    let callCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      callCount++
      if (table === 'discord_invite_codes' && callCount === 1) {
        return createChainedMock({
          id: 1,
          guild_code: 'GUILD1',
          invite_scope: 'cluster',
          is_active: true
        })
      }
      if (table === 'discord_invite_codes') {
        const chain = createChainedMock()
        chain.update = vi.fn().mockReturnValue(chain)
        chain.eq = vi
          .fn()
          .mockResolvedValue({ error: { message: 'Update failed' } })
        return chain
      }
      return createChainedMock(null)
    })
    mockGuildConfigServiceGetBasic.mockResolvedValue({
      cluster_code: 'CLUSTER1'
    })

    const response = await DELETE(createDeleteRequest({ inviteId: 1 }))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Unable to deactivate invite.')
  })

  it('allows a genuine app admin to delete any invite', async () => {
    mockRequireRole.mockResolvedValue({
      user: { id: 'user-1', role: 'officer' },
      profile: {
        cluster_code: 'CLUSTER1',
        guild_code: null,
        is_app_admin: true
      }
    })

    let callCount = 0
    mockServiceSupabase.from.mockImplementation((table: string) => {
      callCount++
      if (table === 'discord_invite_codes' && callCount === 1) {
        return createChainedMock({
          id: 1,
          guild_code: 'GUILD1',
          invite_scope: 'cluster',
          is_active: true
        })
      }
      if (table === 'discord_invite_codes') {
        const chain = createChainedMock()
        chain.update = vi.fn().mockReturnValue(chain)
        chain.eq = vi.fn().mockResolvedValue({ error: null })
        return chain
      }
      return createChainedMock(null)
    })
    mockGuildConfigServiceGetBasic.mockResolvedValue({
      cluster_code: 'CLUSTER2'
    })

    const response = await DELETE(createDeleteRequest({ inviteId: 1 }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
  })
})
