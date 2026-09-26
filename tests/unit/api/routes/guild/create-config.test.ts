import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SERVICE_TIMEOUTS } from '@/app/lib/utils/async-timeout'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>
let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>
let mockEncryptApiKey: ReturnType<typeof vi.fn>
let mockResolveLokiBuildString: ReturnType<typeof vi.fn>
let mockFetch: ReturnType<typeof vi.fn>

describe('POST /api/guild/create-config', () => {
  let POST: (request: Request) => Promise<Response>
  let mockAuthedSupabase: {
    auth: {
      getUser: ReturnType<typeof vi.fn>
    }
  }
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
    functions: {
      invoke: ReturnType<typeof vi.fn>
    }
  }

  beforeEach(async () => {
    vi.resetModules()

    // The route returns 500 without LOKI scraper credentials.
    vi.stubEnv('LOKI_SCRAPER_USER_ID', 'test-loki-user')
    vi.stubEnv('LOKI_SCRAPER_CLIENT_SECRET', 'test-loki-secret')

    mockCreateServiceClient = vi.fn()
    mockCreateClient = vi.fn()
    mockApiSecurityMiddleware = vi.fn().mockResolvedValue(null)
    mockValidateApiKeyWithTacticus = vi.fn()
    mockEncryptApiKey = vi.fn().mockResolvedValue('encrypted-key')
    mockResolveLokiBuildString = vi.fn().mockResolvedValue('1.2.3')
    mockFetch = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))

    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus
    }))

    vi.doMock('@tacticus/app-core/encryption', () => ({
      encryptApiKey: mockEncryptApiKey
    }))

    vi.doMock('@/app/lib/loki/build-string', () => ({
      resolveLokiBuildString: mockResolveLokiBuildString
    }))

    vi.stubGlobal('fetch', mockFetch)

    mockAuthedSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.test' } },
          error: null
        })
      }
    }

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      functions: {
        invoke: vi.fn()
      }
    }

    mockCreateClient.mockResolvedValue(mockAuthedSupabase)
    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/guild/create-config/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function waitForFetchContaining(urlPart: string, minCount = 1) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const matchCount = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes(urlPart)
      ).length
      if (matchCount >= minCount) {
        return
      }
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    }
    throw new Error(`Timed out waiting for fetch containing ${urlPart}`)
  }

  async function waitForFunctionInvoke(functionName: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const wasCalled = mockSupabase.functions.invoke.mock.calls.some(
        ([name]) => name === functionName
      )
      if (wasCalled) {
        return
      }
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    }
    throw new Error(`Timed out waiting for function invoke ${functionName}`)
  }

  async function hasSettled<T>(promise: Promise<T>): Promise<boolean> {
    let settled = false
    promise.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (settled) {
        return true
      }
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    }
    return settled
  }

  describe('rate limiting', () => {
    it('returns rate limit response when blocked', async () => {
      const rateLimitResponse = new Response(
        JSON.stringify({ error: 'Rate limit exceeded' }),
        { status: 429 }
      )
      mockApiSecurityMiddleware.mockResolvedValue(rateLimitResponse)

      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'TEST',
          display_name: 'Test Guild',
          api_key: 'test-key'
        })
      })

      const response = await POST(request)

      expect(response.status).toBe(429)
    })
  })

  describe('validation', () => {
    it('returns error when guild_code is missing', async () => {
      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: 'Test Guild',
          api_key: 'test-key'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(body.error.code).toBe(2001)
    })

    it('returns error when display_name is missing', async () => {
      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'TEST',
          api_key: 'test-key'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(body.error.code).toBe(2001)
    })

    it('returns error when api_key is missing', async () => {
      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'TEST',
          display_name: 'Test Guild'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(body.error.code).toBe(2001)
    })

    it('rejects protected guild codes', async () => {
      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'TEST',
          display_name: 'Example Alliance',
          api_key: 'test-key'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(3010)
    })
  })

  describe('guild code validation', () => {
    it('normalizes guild code to uppercase', async () => {
      let upsertedCode: string | null = null

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            ilike: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert: vi
              .fn()
              .mockImplementation((data: { guild_code: string }) => {
                upsertedCode = data.guild_code
                return {
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { guild_code: data.guild_code },
                      error: null
                    })
                  })
                }
              })
          }
        }
        if (table === 'guild_sync_status') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        if (table === 'player_mapping') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        return {
          upsert: vi.fn().mockResolvedValue({ error: null })
        }
      })

      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildCode: 'NEWXYZ',
          guildId: 'test-id',
          guildName: 'Test Guild'
        }
      })

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('loki.snowprintstudios.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'test-session-id-12345' })
          })
        }
        if (url.includes('guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ guild: { guildId: 'test', name: 'Test' } })
          })
        }
        return Promise.resolve({ ok: false })
      })

      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, stats: { lokiMappings: 5 } },
        error: null
      })

      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'newxyz',
          display_name: 'My Test Guild',
          api_key: 'valid-key'
        })
      })

      await POST(request)

      expect(upsertedCode).toBe('NEWXYZ')
    })
  })

  describe('duplicate guild check', () => {
    it('returns error when guild already exists', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            guild_code: 'DUPGLD',
            display_name: 'Existing Guild',
            created_at: '2024-01-01'
          },
          error: null
        })
      })

      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'DUPGLD',
          display_name: 'My Guild',
          api_key: 'valid-key'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(body.error.code).toBe(3009)
    })
  })

  describe('cluster authorization', () => {
    // Filtered set lookups, so they cannot answer for unasked guilds.
    type ClusterFixture = {
      clusterCreatedBy?: string
      verifiedPlayers?: Array<Record<string, unknown>>
      resolverError?: boolean
      activeMappings?: Record<number, string>
      guildsInCluster?: string[]
      activeLookupFails?: boolean
      membershipLookupFails?: boolean
    }

    type QueryResult = { data: unknown; error: unknown }
    type Fulfil = ((value: QueryResult) => unknown) | null | undefined
    type Reject = ((reason: unknown) => unknown) | null | undefined

    function player(
      mappingId: number,
      guildCode: string,
      role: string,
      extra: Record<string, unknown> = {}
    ) {
      return {
        mapping_id: mappingId,
        player_id: `player-${mappingId}`,
        user_id: 'user-1',
        guild_code: guildCode,
        role,
        is_app_admin: false,
        ownership_attestation_id: `proof-${mappingId}`,
        ...extra
      }
    }

    let playerMappingFilters: string[]
    let guildConfigFilters: string[]
    let guildUpsert: ReturnType<typeof vi.fn>
    let upsertedConfig: Record<string, unknown> | null

    function installClusterFixture(fixture: ClusterFixture) {
      playerMappingFilters = []
      guildConfigFilters = []
      upsertedConfig = null

      guildUpsert = vi.fn((data: Record<string, unknown>) => {
        upsertedConfig = data
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                guild_code: data.guild_code,
                cluster_id: data.cluster_id,
                cluster_code: data.cluster_code,
                is_cluster: data.is_cluster
              },
              error: null
            })
          })
        }
      })

      const verifiedPlayers = fixture.verifiedPlayers ?? []
      const activeMappings = fixture.activeMappings ?? {}
      const guildsInCluster = fixture.guildsInCluster ?? []

      mockSupabase.rpc.mockImplementation((name: string) => {
        if (name === 'resolve_verified_players') {
          return Promise.resolve({
            data: verifiedPlayers,
            error: fixture.resolverError ? { message: 'unavailable' } : null
          })
        }
        return Promise.resolve({ data: [], error: null })
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'clusters') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'cluster-real-id',
                cluster_code: 'CLUSTER1',
                created_by: fixture.clusterCreatedBy ?? 'departed-creator'
              },
              error: null
            })
          }
        }

        if (table === 'player_mapping') {
          const filters: Record<string, unknown> = {}
          const builder: Record<string, unknown> = {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            // Also answers `.eq(...).maybeSingle()` so the fixture is not coupled to the `.in(...)` query.
            maybeSingle: vi.fn(() => {
              if (typeof filters.id !== 'number') {
                return Promise.resolve({ data: null, error: null })
              }
              if (fixture.activeLookupFails) {
                return Promise.resolve({
                  data: null,
                  error: { message: 'unavailable' }
                })
              }
              const mapped = activeMappings[filters.id as number]
              const matches =
                mapped !== undefined &&
                (typeof filters.guild_code !== 'string' ||
                  filters.guild_code === mapped)
              return Promise.resolve({
                data: matches ? { id: filters.id } : null,
                error: null
              })
            })
          }
          builder.select = vi.fn(() => builder)
          builder.update = vi.fn(() => builder)
          builder.eq = vi.fn((column: string, value: unknown) => {
            filters[column] = value
            playerMappingFilters.push(`eq:${column}=${String(value)}`)
            return builder
          })
          builder.in = vi.fn((column: string, values: unknown) => {
            filters[column] = values
            playerMappingFilters.push(`in:${column}=${JSON.stringify(values)}`)
            return builder
          })
          builder.then = (onFulfilled: Fulfil, onRejected: Reject) => {
            const ids = filters.id
            let result: QueryResult = { data: [], error: null }
            if (Array.isArray(ids)) {
              result = fixture.activeLookupFails
                ? { data: null, error: { message: 'unavailable' } }
                : {
                    data: (ids as number[])
                      .filter((id) =>
                        Object.prototype.hasOwnProperty.call(activeMappings, id)
                      )
                      .map((id) => ({ guild_code: activeMappings[id] })),
                    error: null
                  }
            }
            return Promise.resolve(result).then(onFulfilled, onRejected)
          }
          return builder
        }

        if (table === 'guild_config') {
          const filters: Record<string, unknown> = {}
          const builder: Record<string, unknown> = {
            upsert: guildUpsert,
            maybeSingle: vi.fn(() => {
              if (
                typeof filters.guild_code !== 'string' ||
                filters.cluster_id === undefined
              ) {
                return Promise.resolve({ data: null, error: null })
              }
              if (fixture.membershipLookupFails) {
                return Promise.resolve({
                  data: null,
                  error: { message: 'unavailable' }
                })
              }
              const inCluster =
                filters.cluster_id === 'cluster-real-id' ? guildsInCluster : []
              return Promise.resolve({
                data: inCluster.includes(filters.guild_code as string)
                  ? { guild_code: filters.guild_code }
                  : null,
                error: null
              })
            })
          }
          builder.select = vi.fn(() => builder)
          builder.ilike = vi.fn(() => builder)
          builder.eq = vi.fn((column: string, value: unknown) => {
            filters[column] = value
            guildConfigFilters.push(`eq:${column}=${String(value)}`)
            return builder
          })
          builder.in = vi.fn((column: string, values: unknown) => {
            filters[column] = values
            guildConfigFilters.push(`in:${column}=${JSON.stringify(values)}`)
            return builder
          })
          builder.limit = vi.fn(() => {
            if (fixture.membershipLookupFails) {
              return Promise.resolve({
                data: null,
                error: { message: 'unavailable' }
              })
            }
            const wanted = Array.isArray(filters.guild_code)
              ? (filters.guild_code as string[])
              : []
            const inCluster =
              filters.cluster_id === 'cluster-real-id' ? guildsInCluster : []
            return Promise.resolve({
              data: wanted
                .filter((code) => inCluster.includes(code))
                .map((code) => ({ guild_code: code })),
              error: null
            })
          })
          return builder
        }

        return { upsert: vi.fn().mockResolvedValue({ error: null }) }
      })
    }

    function clusterRequest() {
      return new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'newgld',
          display_name: 'New Guild',
          api_key: 'valid-key',
          cluster_code: 'cluster1',
          // Spoofed: the route must derive cluster_id from the verified clusters row.
          cluster_id: 'FORGED-CLUSTER-ID',
          token_offender_threshold: 7,
          token_abuser_threshold: 9,
          api_owner: 'Owner',
          enabled: false
        })
      })
    }

    function installHappyDownstream() {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildCode: 'NEWGLD',
          guildId: 'discovered-id',
          guildName: 'Discovered Name'
        }
      })

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('loki.snowprintstudios.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'test-session-id-12345' })
          })
        }
        if (url.includes('/guildRaid')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ season: 'season-1' })
          })
        }
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                guild: { guildId: 'discovered-id', name: 'Name', members: [] },
                user: { role: 'LEADER' }
              })
          })
        }
        return Promise.resolve({ ok: false })
      })

      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, stats: { lokiMappings: 1 } },
        error: null
      })
    }

    it('rejects direct cluster assignment by a non-owner', async () => {
      installClusterFixture({ clusterCreatedBy: 'other-user' })

      const response = await POST(clusterRequest())
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toBe(
        'Only the cluster creator, an app admin, or an active guild leader within the cluster can add guilds.'
      )
      expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
      expect(guildUpsert).not.toHaveBeenCalled()
    })

    it.each<[string, ClusterFixture, number]>([
      [
        'an officer of an in-cluster guild',
        {
          verifiedPlayers: [player(42, 'HOME', 'officer')],
          activeMappings: { 42: 'HOME' },
          guildsInCluster: ['HOME']
        },
        403
      ],
      [
        'a plain member of an in-cluster guild',
        {
          verifiedPlayers: [player(42, 'HOME', 'member')],
          activeMappings: { 42: 'HOME' },
          guildsInCluster: ['HOME']
        },
        403
      ],
      [
        'a leader whose mapping is no longer current/active',
        {
          verifiedPlayers: [player(42, 'HOME', 'leader')],
          activeMappings: {},
          guildsInCluster: ['HOME']
        },
        403
      ],
      [
        'a leader of a guild outside the cluster',
        {
          verifiedPlayers: [player(42, 'OUTSIDE', 'leader')],
          activeMappings: { 42: 'OUTSIDE' },
          guildsInCluster: ['HOME']
        },
        403
      ],
      [
        // Keeps the gate non-vacuous.
        'a caller with no verified mapping at all',
        { verifiedPlayers: [] },
        403
      ],
      [
        'a caller whose ownership resolution fails',
        {
          resolverError: true,
          verifiedPlayers: [player(42, 'HOME', 'leader')],
          activeMappings: { 42: 'HOME' },
          guildsInCluster: ['HOME']
        },
        403
      ],
      [
        'a leader when the active-mapping lookup fails',
        {
          verifiedPlayers: [player(42, 'HOME', 'leader')],
          activeLookupFails: true,
          guildsInCluster: ['HOME']
        },
        500
      ],
      [
        'a leader when the cluster membership lookup fails',
        {
          verifiedPlayers: [player(42, 'HOME', 'leader')],
          activeMappings: { 42: 'HOME' },
          membershipLookupFails: true
        },
        500
      ]
    ])(
      'denies %s before validating keys or writing',
      async (_name, fixture, status) => {
        installClusterFixture(fixture)

        const response = await POST(clusterRequest())

        expect(response.status).toBe(status)
        expect(guildUpsert).not.toHaveBeenCalled()
        expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
      }
    )

    it.each<[string, ClusterFixture]>([
      ['the cluster creator', { clusterCreatedBy: 'user-1' }],
      [
        'a lowercase leader of an in-cluster guild',
        {
          verifiedPlayers: [player(42, 'HOME', 'leader')],
          activeMappings: { 42: 'HOME' },
          guildsInCluster: ['HOME']
        }
      ],
      [
        'a capitalised Leader of an in-cluster guild',
        {
          verifiedPlayers: [player(42, 'HOME', 'Leader')],
          activeMappings: { 42: 'HOME' },
          guildsInCluster: ['HOME']
        }
      ],
      [
        // Checking only one leader mapping wrongly refuses this caller.
        'a leader whose SECOND leader mapping is the in-cluster one',
        {
          verifiedPlayers: [
            player(42, 'OUTSIDE', 'leader'),
            player(43, 'HOME', 'leader')
          ],
          activeMappings: { 42: 'OUTSIDE', 43: 'HOME' },
          guildsInCluster: ['HOME']
        }
      ],
      [
        // The admin bit comes from the resolver, never a role string or profile column.
        'a verified app admin with no leader mapping anywhere',
        {
          verifiedPlayers: [
            player(42, 'OUTSIDE', 'member', { is_app_admin: true })
          ],
          activeMappings: {},
          guildsInCluster: []
        }
      ]
    ])(
      'allows %s and stamps only the verified cluster id',
      async (_name, fixture) => {
        installClusterFixture(fixture)
        installHappyDownstream()

        const response = await POST(clusterRequest())
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)

        expect(upsertedConfig?.cluster_id).toBe('cluster-real-id')
        expect(upsertedConfig?.cluster_id).not.toBe('FORGED-CLUSTER-ID')
        expect(upsertedConfig?.cluster_code).toBe('CLUSTER1')
        expect(upsertedConfig?.is_cluster).toBe(true)

        expect(upsertedConfig?.token_offender_threshold).toBe(7)
        expect(upsertedConfig?.token_abuser_threshold).toBe(9)
        expect(upsertedConfig?.API_Owner).toBe('Owner')
        expect(upsertedConfig?.enabled).toBe(false)

        // Read back so the client can confirm linkage without a guarded write.
        expect(body.data.cluster_id).toBe('cluster-real-id')
        expect(body.data.is_cluster).toBe(true)
      }
    )

    it('asks about EVERY leader mapping in one .in(...) query, like claim does', async () => {
      installClusterFixture({
        verifiedPlayers: [
          player(42, 'OUTSIDE', 'leader'),
          player(43, 'HOME', 'leader'),
          player(44, 'THIRD', 'officer')
        ],
        activeMappings: { 42: 'OUTSIDE', 43: 'HOME' },
        guildsInCluster: ['HOME']
      })
      installHappyDownstream()

      const response = await POST(clusterRequest())

      expect(response.status).toBe(200)
      expect(playerMappingFilters).toContain('in:id=[42,43]')
      expect(playerMappingFilters).toContain('eq:user_id=user-1')
      expect(playerMappingFilters).toContain('eq:is_current=true')
      expect(playerMappingFilters).toContain('eq:is_active=true')
      expect(guildConfigFilters).toContain('in:guild_code=["OUTSIDE","HOME"]')
      expect(guildConfigFilters).toContain('eq:cluster_id=cluster-real-id')
    })

    it('never reuses the resolver guild code when the active row disagrees', async () => {
      // Membership uses the active row, not the resolver.
      installClusterFixture({
        verifiedPlayers: [player(42, 'HOME', 'leader')],
        activeMappings: { 42: 'RENAMED' },
        guildsInCluster: ['RENAMED']
      })
      installHappyDownstream()

      const response = await POST(clusterRequest())

      expect(response.status).toBe(200)
      expect(guildConfigFilters).toContain('in:guild_code=["RENAMED"]')
      expect(guildConfigFilters).not.toContain('in:guild_code=["HOME"]')
    })
  })

  // The form takes the TAG but guilds are stored under a UUID guild_code, so the collision always fires.
  describe('attaching an already-registered guild to a cluster (PS-569)', () => {
    function collisionFixture(existingClusterId: string | null) {
      const guildUpsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { guild_code: 'stored-uuid-code' },
            error: null
          })
        })
      })

      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildCode: 'EGA',
          guildId: 'guild-uuid-1',
          guildName: 'Example Guild One'
        }
      })

      mockSupabase.rpc.mockImplementation((fn: string) => {
        if (fn === 'get_guild_config_by_guild_id') {
          return Promise.resolve({
            data: [
              {
                guild_code: 'stored-uuid-code',
                guild_id: 'guild-uuid-1',
                guild_tag: 'EGA',
                display_name: 'Example Guild One',
                cluster_code: null,
                enabled: true,
                onboarding_completed: true,
                onboarding_source: 'standard',
                has_api_key: true,
                claimed_by_user: true
              }
            ],
            error: null
          })
        }
        return Promise.resolve({ data: [], error: null })
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'clusters') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'cluster-1',
                cluster_code: 'CZSK',
                // Founder, so only the collision branch is tested.
                created_by: 'user-1'
              },
              error: null
            })
          }
        }
        if (table === 'guild_config') {
          const builder: Record<string, unknown> = {}
          builder.select = vi.fn(() => builder)
          builder.ilike = vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          }))
          builder.eq = vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                guild_code: 'stored-uuid-code',
                cluster_id: existingClusterId
              },
              error: null
            })
          }))
          builder.upsert = guildUpsert
          return builder
        }
        return { upsert: vi.fn().mockResolvedValue({ error: null }) }
      })

      return {
        guildUpsert,
        request: new Request('http://localhost/api/guild/create-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guild_code: 'EGA',
            display_name: 'Example Guild One',
            api_key: 'valid-key',
            cluster_code: 'czsk'
          })
        })
      }
    }

    it('attaches a claimed guild that belongs to no cluster', async () => {
      const { request } = collisionFixture(null)

      const response = await POST(request)

      expect(response.status).not.toBe(409)
    })

    it('attaches a claimed guild already in the SAME cluster (idempotent retry)', async () => {
      const { request } = collisionFixture('cluster-1')

      const response = await POST(request)

      expect(response.status).not.toBe(409)
    })

    it('refuses to move a guild out of a DIFFERENT cluster', async () => {
      const { request, guildUpsert } = collisionFixture('cluster-other')

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.error.message).toBe(
        'This guild already belongs to another cluster'
      )
      expect(guildUpsert).not.toHaveBeenCalled()
    })

    it('still 409s a claimed guild when no cluster was requested', async () => {
      const { request, guildUpsert } = collisionFixture(null)
      const noClusterRequest = new Request(
        'http://localhost/api/guild/create-config',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guild_code: 'EGA',
            display_name: 'Example Guild One',
            api_key: 'valid-key'
          })
        }
      )
      void request

      const response = await POST(noClusterRequest)
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.error.message).toBe('This guild is already registered')
      expect(guildUpsert).not.toHaveBeenCalled()
    })
  })

  describe('API key validation', () => {
    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })
    })

    it('returns error when API key is invalid', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'Invalid API key',
        statusCode: 401,
        canAccessGuild: false,
        canAccessRaidData: false
      })

      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'NEW',
          display_name: 'My New Guild',
          api_key: 'invalid-key'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(body.error.code).toBe(1001)
    })

    it('returns 400 when API key guild identity is missing', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: { guildCode: 'OTHER', guildName: 'Other Guild' }
      })

      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'NEW',
          display_name: 'My New Guild',
          api_key: 'valid-key-wrong-guild'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Could not determine guild')
    })

    it('returns error when API key cannot access guild data', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        canAccessGuild: false,
        canAccessRaidData: true,
        error: 'Cannot access guild'
      })

      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'NEW',
          display_name: 'My New Guild',
          api_key: 'partial-key'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(body.error.code).toBe(1001)
      expect(body.error.metadata?.details).toContain('Guild permissions')
    })
  })

  describe('session refresh', () => {
    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: { guildCode: 'NEW', guildId: 'test', guildName: 'Test' }
      })
    })

    it('returns error when LOKI session refresh fails', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('loki.snowprintstudios.com')) {
          return Promise.resolve({
            ok: false,
            text: () => Promise.resolve('Session error')
          })
        }
        if (url.includes('guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ guild: { guildId: 'test', name: 'Test' } })
          })
        }
        return Promise.resolve({ ok: false })
      })

      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'NEW',
          display_name: 'My New Guild',
          api_key: 'valid-key'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(body.error.code).toBe(5001)
    })
  })

  describe('successful creation', () => {
    beforeEach(() => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildCode: 'NEWGLD',
          guildId: 'discovered-id',
          guildName: 'Discovered Name'
        }
      })

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('loki.snowprintstudios.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'test-session-id-12345' })
          })
        }
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                guild: {
                  guildId: 'api-guild-id',
                  name: 'API Guild Name',
                  memberCount: 25
                },
                user: { role: 'LEADER' }
              })
          })
        }
        if (url.includes('/guildRaid')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ season: 'season-42' })
          })
        }
        return Promise.resolve({ ok: false })
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            ilike: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { guild_code: 'NEWGLD' },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'guild_sync_status') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        if (table === 'player_mapping') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        return {
          upsert: vi.fn().mockResolvedValue({ error: null })
        }
      })

      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, stats: { lokiMappings: 10 } },
        error: null
      })
    })

    it('creates guild config successfully', async () => {
      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'NEWGLD',
          display_name: 'New Guild',
          api_key: 'valid-key'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(body.data.guild_code).toBe('NEWGLD')
      expect(body.data.autoDiscovered).toBeDefined()
    })

    it('continues when LOKI session refresh hangs', async () => {
      vi.useFakeTimers()
      let lokiAborted = false

      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('loki.snowprintstudios.com')) {
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                lokiAborted = true
                const abortError = new Error('Request timed out')
                abortError.name = 'AbortError'
                reject(abortError)
              },
              { once: true }
            )
          })
        }
        if (url.includes('/guildRaid')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ season: 'season-42' })
          } as Response)
        }
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                guild: {
                  guildId: 'api-guild-id',
                  name: 'API Guild Name',
                  memberCount: 25,
                  members: [{ userId: 'leader-1', role: 'LEADER' }]
                },
                user: { role: 'LEADER' }
              })
          } as Response)
        }
        return Promise.resolve({ ok: false } as Response)
      })

      const responsePromise = POST(
        new Request('http://localhost/api/guild/create-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guild_code: 'NEWGLD',
            display_name: 'New Guild',
            api_key: 'valid-key'
          })
        })
      )

      await waitForFetchContaining('loki.snowprintstudios.com')

      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)

      expect(lokiAborted).toBe(true)
      const response = await responsePromise
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.autoDiscovered.sessionIdCreated).toBe(false)
    })

    it('continues when LOKI session refresh body hangs', async () => {
      vi.useFakeTimers()
      let lokiAborted = false

      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('loki.snowprintstudios.com')) {
          init?.signal?.addEventListener(
            'abort',
            () => {
              lokiAborted = true
            },
            { once: true }
          )
          return Promise.resolve({
            ok: true,
            json: () => new Promise(() => {})
          } as Response)
        }
        if (url.includes('/guildRaid')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ season: 'season-42' })
          } as Response)
        }
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                guild: {
                  guildId: 'api-guild-id',
                  name: 'API Guild Name',
                  memberCount: 25,
                  members: [{ userId: 'leader-1', role: 'LEADER' }]
                },
                user: { role: 'LEADER' }
              })
          } as Response)
        }
        return Promise.resolve({ ok: false } as Response)
      })

      const responsePromise = POST(
        new Request('http://localhost/api/guild/create-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guild_code: 'NEWGLD',
            display_name: 'New Guild',
            api_key: 'valid-key'
          })
        })
      )

      await waitForFetchContaining('loki.snowprintstudios.com')
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)

      expect(await hasSettled(responsePromise)).toBe(true)
      expect(lokiAborted).toBe(true)
      const response = await responsePromise
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.autoDiscovered.sessionIdCreated).toBe(false)
    })

    it('continues when Tacticus guild auto-discovery hangs', async () => {
      vi.useFakeTimers()
      let discoveryAborted = false

      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/guildRaid')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ season: 'season-42' })
          } as Response)
        }
        if (url.includes('loki.snowprintstudios.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'test-session-id-12345' })
          } as Response)
        }
        if (url.includes('/guild')) {
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                discoveryAborted = true
                const abortError = new Error('Request timed out')
                abortError.name = 'AbortError'
                reject(abortError)
              },
              { once: true }
            )
          })
        }
        return Promise.resolve({ ok: false } as Response)
      })

      const responsePromise = POST(
        new Request('http://localhost/api/guild/create-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guild_code: 'NEWGLD',
            display_name: 'New Guild',
            api_key: 'valid-key'
          })
        })
      )

      await waitForFetchContaining('/guild')
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)

      expect(discoveryAborted).toBe(true)
      const response = await responsePromise
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.autoDiscovered.guildId).toBeUndefined()
      expect(body.data.autoDiscovered.season).toBe('season-42')
    })

    it('continues when Tacticus season detection hangs', async () => {
      vi.useFakeTimers()
      let seasonAborted = false

      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/guildRaid')) {
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                seasonAborted = true
                const abortError = new Error('Request timed out')
                abortError.name = 'AbortError'
                reject(abortError)
              },
              { once: true }
            )
          })
        }
        if (url.includes('loki.snowprintstudios.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'test-session-id-12345' })
          } as Response)
        }
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                guild: {
                  guildId: 'api-guild-id',
                  name: 'API Guild Name',
                  memberCount: 25,
                  members: [{ userId: 'leader-1', role: 'LEADER' }]
                },
                user: { role: 'LEADER' }
              })
          } as Response)
        }
        return Promise.resolve({ ok: false } as Response)
      })

      const responsePromise = POST(
        new Request('http://localhost/api/guild/create-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guild_code: 'NEWGLD',
            display_name: 'New Guild',
            api_key: 'valid-key'
          })
        })
      )

      await waitForFetchContaining('/guildRaid')
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)

      expect(seasonAborted).toBe(true)
      const response = await responsePromise
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.autoDiscovered.guildId).toBe('api-guild-id')
      expect(body.data.autoDiscovered.season).toBeNull()
    })

    it('continues when role reconciliation hangs', async () => {
      vi.useFakeTimers()
      let roleReconcileAborted = false
      let guildFetchCount = 0

      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/guildRaid')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ season: 'season-42' })
          } as Response)
        }
        if (url.includes('loki.snowprintstudios.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'test-session-id-12345' })
          } as Response)
        }
        if (url.includes('/guild')) {
          guildFetchCount += 1
          if (guildFetchCount === 1) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  guild: {
                    guildId: 'api-guild-id',
                    name: 'API Guild Name',
                    memberCount: 25
                  },
                  user: { role: 'LEADER' }
                })
            } as Response)
          }

          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                roleReconcileAborted = true
                const abortError = new Error('Request timed out')
                abortError.name = 'AbortError'
                reject(abortError)
              },
              { once: true }
            )
          })
        }
        return Promise.resolve({ ok: false } as Response)
      })

      const responsePromise = POST(
        new Request('http://localhost/api/guild/create-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guild_code: 'NEWGLD',
            display_name: 'New Guild',
            api_key: 'valid-key'
          })
        })
      )

      await waitForFetchContaining('/guild', 2)
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)

      expect(roleReconcileAborted).toBe(true)
      const response = await responsePromise
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.initialSyncTriggered).toBe(true)
      expect(body.data.playerMappingsCreated).toBe(false)
    })

    it('continues when initial sync invoke hangs', async () => {
      vi.useFakeTimers()

      mockSupabase.functions.invoke.mockImplementation(
        () => new Promise(() => {})
      )

      const responsePromise = POST(
        new Request('http://localhost/api/guild/create-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guild_code: 'NEWGLD',
            display_name: 'New Guild',
            api_key: 'valid-key'
          })
        })
      )

      await waitForFunctionInvoke('sync-modular-workflow')
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)
      await Promise.resolve()

      expect(await hasSettled(responsePromise)).toBe(true)
      const response = await responsePromise
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.initialSyncTriggered).toBe(false)
      expect(body.data.playerMappingsCreated).toBe(false)
    })

    it('triggers initial sync after creation', async () => {
      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'NEWGLD',
          display_name: 'New Guild',
          api_key: 'valid-key'
        })
      })

      await POST(request)

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'sync-modular-workflow',
        { body: { guild_code: 'NEWGLD' } }
      )
    })
  })

  describe('role reconciliation (WI-1499)', () => {
    it('reconciles leader/officer ranks from Tacticus /guild without clobbering names', async () => {
      const roleUpdates: Array<{
        role: string
        ids: string[]
        payloadKeys: string[]
      }> = []

      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildCode: 'EGB',
          guildId: 'guild-uuid',
          guildName: 'Example Guild Two'
        }
      })

      // '/guildRaid' contains '/guild', so it must be matched first.
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('loki.snowprintstudios.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'sess-123' })
          })
        }
        if (url.includes('/guildRaid')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ season: 'season-1' })
          })
        }
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                user: { role: 'LEADER' },
                guild: {
                  guildId: 'guild-uuid',
                  name: 'Example Guild Two',
                  members: [
                    { userId: 'p-leader', role: 'LEADER' },
                    { userId: 'p-co', role: 'CO_LEADER' },
                    { userId: 'p-off', role: 'OFFICER' },
                    { userId: 'p-mem', role: 'MEMBER' }
                  ]
                }
              })
          })
        }
        return Promise.resolve({ ok: false })
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            ilike: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { guild_code: 'EGB' },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'guild_sync_status') {
          return { upsert: vi.fn().mockResolvedValue({ error: null }) }
        }
        if (table === 'player_mapping') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn().mockImplementation((payload: { role: string }) => ({
              eq: vi.fn().mockReturnValue({
                in: vi
                  .fn()
                  .mockImplementation((_col: string, ids: string[]) => {
                    roleUpdates.push({
                      role: payload.role,
                      ids,
                      payloadKeys: Object.keys(payload)
                    })
                    return Promise.resolve({ error: null })
                  })
              })
            }))
          }
        }
        return { upsert: vi.fn().mockResolvedValue({ error: null }) }
      })

      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, stats: { lokiMappings: 10 } },
        error: null
      })

      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'egb',
          display_name: 'Example Guild Two',
          api_key: 'valid-key'
        })
      })

      const response = await POST(request)
      const body = await response.json()
      expect(body.success).toBe(true)

      const leaderUpdate = roleUpdates.find((u) => u.role === 'leader')
      const officerUpdate = roleUpdates.find((u) => u.role === 'officer')

      // Co-leaders resolve to 'leader' (matches the sync path).
      expect(leaderUpdate?.ids).toEqual(['p-leader', 'p-co'])
      expect(officerUpdate?.ids).toEqual(['p-off'])

      // 'member' is the column default and is never written.
      const allIds = roleUpdates.flatMap((u) => u.ids as string[])
      expect(allIds).not.toContain('p-mem')

      // Role-only, so good LOKI names survive.
      for (const update of roleUpdates) {
        expect(update.payloadKeys).not.toContain('display_name')
        expect(update.payloadKeys.sort()).toEqual(['role', 'updated_at'])
      }
    })

    it('reconciles ranks on rows that ALREADY sit on this guild when LOKI is empty', async () => {
      // Same-guild roster rows still get ranks reconciled, or mint_bootstrap_seat_invite refuses the leader.
      const roleUpdates: Array<{ role: string; ids: string[] }> = []
      const upsertedIds: string[] = []

      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildCode: 'EGB',
          guildId: 'guild-uuid',
          guildName: 'Example Guild Two'
        }
      })

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('loki.snowprintstudios.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'sess-123' })
          })
        }
        if (url.includes('/guildRaid')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ season: 'season-1' })
          })
        }
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                user: { role: 'LEADER' },
                guild: {
                  guildId: 'guild-uuid',
                  name: 'Example Guild Two',
                  members: [
                    { userId: 'p-leader', role: 'LEADER' },
                    { userId: 'p-off', role: 'OFFICER' },
                    { userId: 'p-new', role: 'MEMBER' },
                    { userId: 'p-elsewhere', role: 'OFFICER' }
                  ]
                }
              })
          })
        }
        return Promise.resolve({ ok: false })
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            ilike: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { guild_code: 'EGB' },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'guild_sync_status') {
          return { upsert: vi.fn().mockResolvedValue({ error: null }) }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    player_id: 'p-leader',
                    guild_code: 'EGB',
                    protected: false,
                    is_app_admin: false,
                    is_current: true
                  },
                  {
                    player_id: 'p-off',
                    guild_code: 'EGB',
                    protected: false,
                    is_app_admin: false,
                    is_current: true
                  },
                  {
                    player_id: 'p-elsewhere',
                    guild_code: 'OTHER',
                    protected: false,
                    is_app_admin: false,
                    is_current: true
                  }
                ],
                error: null
              })
            }),
            upsert: vi
              .fn()
              .mockImplementation((rows: Array<{ player_id: string }>) => {
                upsertedIds.push(...rows.map((row) => row.player_id))
                return Promise.resolve({ error: null })
              }),
            update: vi.fn().mockImplementation((payload: { role: string }) => ({
              eq: vi.fn().mockReturnValue({
                in: vi
                  .fn()
                  .mockImplementation((_col: string, ids: string[]) => {
                    roleUpdates.push({ role: payload.role, ids })
                    return Promise.resolve({ error: null })
                  })
              })
            }))
          }
        }
        return { upsert: vi.fn().mockResolvedValue({ error: null }) }
      })

      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, stats: { lokiMappings: 0 } },
        error: null
      })

      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'egb',
          display_name: 'Example Guild Two',
          api_key: 'valid-key'
        })
      })

      const response = await POST(request)
      expect((await response.json()).success).toBe(true)

      expect(upsertedIds).toEqual(['p-new'])
      expect(upsertedIds).not.toContain('p-elsewhere')

      expect(roleUpdates.find((u) => u.role === 'leader')?.ids).toEqual([
        'p-leader'
      ])
      expect(roleUpdates.find((u) => u.role === 'officer')?.ids).toEqual([
        'p-off'
      ])
      expect(roleUpdates.flatMap((u) => u.ids)).not.toContain('p-elsewhere')
    })

    it('never rewrites protected or app-admin rows in the fallback', async () => {
      // Protected rows are hand-curated; registration must not rewrite them.
      const roleUpdates: Array<{ role: string; ids: string[] }> = []
      const reactivated: string[] = []

      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildCode: 'EGB',
          guildId: 'guild-uuid',
          guildName: 'Example Guild Two'
        }
      })

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('loki.snowprintstudios.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'sess-123' })
          })
        }
        if (url.includes('/guildRaid')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ season: 'season-1' })
          })
        }
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                user: { role: 'LEADER' },
                guild: {
                  guildId: 'guild-uuid',
                  name: 'Example Guild Two',
                  members: [
                    { userId: 'p-protected', role: 'LEADER' },
                    { userId: 'p-admin', role: 'OFFICER' },
                    { userId: 'p-absent', role: 'LEADER' }
                  ]
                }
              })
          })
        }
        return Promise.resolve({ ok: false })
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            ilike: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { guild_code: 'EGB' },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'guild_sync_status') {
          return { upsert: vi.fn().mockResolvedValue({ error: null }) }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    player_id: 'p-protected',
                    guild_code: 'EGB',
                    protected: true,
                    is_app_admin: false,
                    is_current: true
                  },
                  {
                    player_id: 'p-admin',
                    guild_code: 'EGB',
                    protected: false,
                    is_app_admin: true,
                    is_current: true
                  },
                  {
                    player_id: 'p-absent',
                    guild_code: 'EGB',
                    protected: false,
                    is_app_admin: false,
                    is_current: false
                  }
                ],
                error: null
              })
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
            update: vi
              .fn()
              .mockImplementation(
                (payload: { role?: string; is_current?: boolean }) => ({
                  eq: vi.fn().mockReturnValue({
                    in: vi
                      .fn()
                      .mockImplementation((_col: string, ids: string[]) => {
                        if (payload.is_current === true) {
                          reactivated.push(...ids)
                        } else if (payload.role) {
                          roleUpdates.push({ role: payload.role, ids })
                        }
                        return Promise.resolve({ error: null })
                      })
                  })
                })
              )
          }
        }
        return { upsert: vi.fn().mockResolvedValue({ error: null }) }
      })

      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, stats: { lokiMappings: 0 } },
        error: null
      })

      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'egb',
          display_name: 'Example Guild Two',
          api_key: 'valid-key'
        })
      })

      await POST(request)

      const touched = roleUpdates.flatMap((u) => u.ids)
      expect(touched).not.toContain('p-protected')
      expect(touched).not.toContain('p-admin')
      expect(reactivated).not.toContain('p-protected')
      expect(reactivated).not.toContain('p-admin')

      // mint_bootstrap_seat_invite requires `is_current IS TRUE`, so the absent leader must be rescued.
      expect(touched).toContain('p-absent')
      expect(reactivated).toEqual(['p-absent'])
    })
  })

  describe('encryption error', () => {
    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: { guildCode: 'NEW', guildId: 'test', guildName: 'Test' }
      })

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('loki.snowprintstudios.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'test-session-id-12345' })
          })
        }
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ guild: { guildId: 'test', name: 'Test' } })
          })
        }
        return Promise.resolve({ ok: false })
      })
    })

    it('returns error when encryption fails', async () => {
      mockEncryptApiKey.mockRejectedValue(new Error('Encryption failed'))

      const request = new Request('http://localhost/api/guild/create-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'NEW',
          display_name: 'My New Guild',
          api_key: 'valid-key'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(body.error.code).toBe(5001)
    })
  })
})
