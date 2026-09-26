import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockGenerateInviteCode: ReturnType<typeof vi.fn>
let mockEncryptApiKey: ReturnType<typeof vi.fn>
let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>
let mockGenerateApiKeyUpdatePayload: ReturnType<typeof vi.fn>

type MockRow = Record<string, unknown>
type MockError = { message: string } | null
type MockResult = {
  data?: MockRow | MockRow[] | null
  error: MockError
  status?: number
}
type ThenResolve = (v: MockResult) => void
type MockArgs = readonly unknown[]
type MockResultSource = MockResult | (() => MockResult)

let supabaseChains: Record<string, ReturnType<typeof createChain>>
let sessionAuthorityWrites: Array<{ table: string; operation: string }>
let serviceAuthorityWrites: Array<{
  table: string
  operation: string
  payload: MockRow
}>
let serviceAuthorityFilters: Array<[string, MockArgs[number]]>
let serviceAuthorityDeletes: string[]
let serviceAuthorityDeleteFilters: Array<[string, MockArgs[number]]>
let serviceAuthorityReads: string[]
let serviceAuthorityReadFilters: Array<[string, MockArgs[number]]>
let lastInsertedGuild: MockRow | null

interface ServiceResultOverrides {
  clusterInsert?: MockResult
  guildConfigUpdate?: MockResultSource
  guildConfigInsert?: MockResult
  guildConfigReadback?: MockResultSource
  playerMappingUpdate?: MockResultSource
  playerMappingReadback?: MockResultSource
  guildConfigDelete?: MockResultSource
}

function resolveResult(
  source: MockResultSource | undefined,
  fallback: MockResult
): MockResult {
  return typeof source === 'function' ? source() : (source ?? fallback)
}

function createChain(
  defaults: { data?: MockRow | null; error?: MockError } = {}
) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'is',
    'in',
    'order',
    'limit',
    'single',
    'maybeSingle'
  ]
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain)
  }
  chain.single = vi.fn().mockResolvedValue({
    data: defaults.data ?? null,
    error: defaults.error ?? null
  })
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: defaults.data ?? null,
    error: defaults.error ?? null
  })
  const originalInsert = chain.insert
  chain.insert = vi.fn().mockImplementation(() => {
    return chain
  })
  return chain
}

function buildServiceClient(overrides: ServiceResultOverrides = {}) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      const chain = createChain()

      if (table === 'player_mapping' || table === 'guild_config') {
        chain.select = vi.fn().mockImplementation(() => {
          serviceAuthorityReads.push(table)
          const readChain = createChain()
          readChain.eq = vi
            .fn()
            .mockImplementation((column: string, value: MockArgs[number]) => {
              serviceAuthorityReadFilters.push([column, value])
              return readChain
            })
          readChain.maybeSingle = vi.fn().mockImplementation(() => {
            if (table === 'guild_config') {
              return resolveResult(overrides.guildConfigReadback, {
                data: null,
                error: null
              })
            }
            return resolveResult(overrides.playerMappingReadback, {
              data: {
                id: 7,
                user_id: 'user-123',
                guild_code: 'MYGUILD',
                cluster_id: null,
                cluster_code: null,
                role: 'leader',
                is_current: true
              },
              error: null
            })
          })
          readChain.in = vi.fn().mockResolvedValue({ data: [], error: null })
          return readChain
        })
      }

      chain.insert = vi.fn().mockImplementation((payload: MockRow) => {
        serviceAuthorityWrites.push({ table, operation: 'insert', payload })

        const defaultResult: MockResult =
          table === 'clusters'
            ? {
                data: {
                  id: 'cluster-uuid-1',
                  cluster_code: 'TESTCL',
                  display_name: 'Test Cluster',
                  created_by: 'user-123'
                },
                error: null
              }
            : {
                data: {
                  id: 101,
                  guild_code: payload.guild_code,
                  guild_id: payload.guild_id ?? null,
                  cluster_id: payload.cluster_id,
                  cluster_code: payload.cluster_code,
                  is_cluster: payload.is_cluster
                },
                error: null
              }
        const result =
          table === 'clusters'
            ? (overrides.clusterInsert ?? defaultResult)
            : (overrides.guildConfigInsert ?? defaultResult)
        if (table === 'guild_config') lastInsertedGuild = payload
        return createChain({
          data: result.data && !Array.isArray(result.data) ? result.data : null,
          error: result.error
        })
      })

      chain.update = vi.fn().mockImplementation((payload: MockRow) => {
        serviceAuthorityWrites.push({ table, operation: 'update', payload })
        const resultSource =
          table === 'player_mapping'
            ? overrides.playerMappingUpdate
            : overrides.guildConfigUpdate
        const result = resolveResult(resultSource, { error: null })
        const updateFilters: Record<string, MockArgs[number]> = {}
        const updateChain = createChain()
        updateChain.eq = vi
          .fn()
          .mockImplementation((column: string, value: MockArgs[number]) => {
            serviceAuthorityFilters.push([column, value])
            updateFilters[column] = value
            return updateChain
          })
        updateChain.is = vi
          .fn()
          .mockImplementation((column: string, value: MockArgs[number]) => {
            serviceAuthorityFilters.push([column, value])
            updateFilters[column] = value
            return updateChain
          })
        updateChain.select = vi.fn().mockReturnValue(updateChain)
        updateChain.maybeSingle = vi.fn().mockImplementation(() => ({
          data:
            'data' in result
              ? result.data
              : result.error
                ? null
                : table === 'player_mapping'
                  ? {
                      id: updateFilters.id ?? 7,
                      user_id: updateFilters.user_id ?? 'user-123',
                      guild_code: payload.guild_code,
                      cluster_id: payload.cluster_id,
                      cluster_code: payload.cluster_code,
                      role: 'leader',
                      is_current: true
                    }
                  : {
                      id: updateFilters.id ?? 101,
                      guild_code: updateFilters.guild_code ?? 'MYGUILD',
                      guild_id: updateFilters.guild_id ?? 'guild-id-1',
                      cluster_id: payload.cluster_id,
                      cluster_code: payload.cluster_code,
                      is_cluster: payload.is_cluster
                    },
          error: result.error
        }))
        return updateChain
      })

      chain.delete = vi.fn().mockImplementation(() => {
        serviceAuthorityDeletes.push(table)
        const result = resolveResult(overrides.guildConfigDelete, {
          error: null
        })
        const deleteChain = createChain()
        deleteChain.eq = vi
          .fn()
          .mockImplementation((column: string, value: MockArgs[number]) => {
            serviceAuthorityDeleteFilters.push([column, value])
            return deleteChain
          })
        deleteChain.is = vi
          .fn()
          .mockImplementation((column: string, value: MockArgs[number]) => {
            serviceAuthorityDeleteFilters.push([column, value])
            return deleteChain
          })
        deleteChain.select = vi.fn().mockReturnValue(deleteChain)
        deleteChain.maybeSingle = vi.fn().mockImplementation(() => ({
          data:
            'data' in result
              ? result.data
              : result.error
                ? null
                : {
                    id: 101,
                    guild_code: lastInsertedGuild?.guild_code,
                    guild_id: lastInsertedGuild?.guild_id ?? null,
                    cluster_id: lastInsertedGuild?.cluster_id,
                    cluster_code: lastInsertedGuild?.cluster_code,
                    is_cluster: lastInsertedGuild?.is_cluster
                  },
          error: result.error
        }))
        return deleteChain
      })

      // EOT target discovery is a service-authority read, not a mutation.
      chain.in = vi.fn().mockResolvedValue({ data: [], error: null })
      return chain
    })
  }
}

let POST: (req: NextRequest) => Promise<Response>

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/clusters/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

const validClusterData = {
  clusterCode: 'TESTCL',
  displayName: 'Test Cluster'
}

describe('POST /api/clusters/create', () => {
  beforeEach(async () => {
    vi.resetModules()

    mockApiSecurityMiddleware = vi.fn().mockResolvedValue(null) // passes
    mockGenerateInviteCode = vi.fn().mockResolvedValue('INVITE-ABC123')
    mockEncryptApiKey = vi.fn().mockResolvedValue('encrypted-key')
    mockValidateApiKeyWithTacticus = vi
      .fn()
      .mockResolvedValue({ isValid: true })
    mockGenerateApiKeyUpdatePayload = vi
      .fn()
      .mockReturnValue({ api_key_encrypted: 'encrypted-key' })
    sessionAuthorityWrites = []
    serviceAuthorityWrites = []
    serviceAuthorityFilters = []
    serviceAuthorityDeletes = []
    serviceAuthorityDeleteFilters = []
    serviceAuthorityReads = []
    serviceAuthorityReadFilters = []
    lastInsertedGuild = null

    const clusterNewRow = {
      id: 'cluster-uuid-1',
      cluster_code: 'TESTCL',
      display_name: 'Test Cluster'
    }

    const clustersSelectChain = createChain({ data: null }) // no existing cluster
    const clustersInsertChain = createChain({ data: clusterNewRow })
    const playerMappingChain = createChain({ data: null }) // no profile (new user)
    const themeChain = createChain()
    const webhookChain = createChain()
    const settingsChain = createChain()
    const adminsChain = createChain()
    const guildConfigChain = createChain()
    const clustersUpdateChain = createChain()

    supabaseChains = {
      clusters_select: clustersSelectChain,
      clusters_insert: clustersInsertChain,
      clusters_update: clustersUpdateChain,
      player_mapping: playerMappingChain,
      cluster_themes: themeChain,
      webhook_config: webhookChain,
      cluster_settings: settingsChain,
      cluster_admins: adminsChain,
      guild_config: guildConfigChain
    }

    let clustersInsertMode = false
    let clustersUpdateMode = false
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-123', email: 'test@example.com' } },
          error: null
        })
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'clusters') {
          return {
            ...clustersSelectChain,
            select: vi.fn().mockImplementation(() => {
              if (clustersInsertMode) {
                clustersInsertMode = false
                return clustersInsertChain
              }
              return clustersSelectChain
            }),
            insert: vi.fn().mockImplementation(() => {
              sessionAuthorityWrites.push({
                table: 'clusters',
                operation: 'insert'
              })
              clustersInsertMode = true
              return {
                ...clustersInsertChain,
                select: vi.fn().mockReturnValue(clustersInsertChain)
              }
            }),
            update: vi.fn().mockImplementation(() => {
              sessionAuthorityWrites.push({
                table: 'clusters',
                operation: 'update'
              })
              clustersUpdateMode = true
              return clustersUpdateChain
            }),
            eq: clustersSelectChain.eq,
            maybeSingle: clustersSelectChain.maybeSingle
          }
        }
        if (table === 'player_mapping') return playerMappingChain
        if (table === 'cluster_themes') return themeChain
        if (table === 'webhook_config') return webhookChain
        if (table === 'cluster_settings') return settingsChain
        if (table === 'cluster_admins') return adminsChain
        if (table === 'guild_config') {
          guildConfigChain.insert = vi.fn().mockImplementation(() => {
            sessionAuthorityWrites.push({
              table: 'guild_config',
              operation: 'insert'
            })
            return guildConfigChain
          })
          guildConfigChain.update = vi.fn().mockImplementation(() => {
            sessionAuthorityWrites.push({
              table: 'guild_config',
              operation: 'update'
            })
            return guildConfigChain
          })
          return guildConfigChain
        }
        return createChain()
      })
    }

    mockCreateClient = vi.fn().mockResolvedValue(mockSupabase)
    mockCreateServiceClient = vi.fn().mockReturnValue(buildServiceClient())

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    // pgTAP covers the relation.
    vi.doMock('@/app/lib/player-mapping-relations', () => ({
      CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
    }))

    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))

    vi.doMock('@/app/lib/utils/invite-codes', () => ({
      generateInviteCode: mockGenerateInviteCode
    }))

    vi.doMock('@tacticus/app-core/encryption', () => ({
      encryptApiKey: mockEncryptApiKey
    }))

    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus,
      generateApiKeyUpdatePayload: mockGenerateApiKeyUpdatePayload
    }))

    const { withErrorHandlerMock } =
      await import('../../../../helpers/mock-error-handler')
    vi.doMock('@/app/lib/middleware/errorHandler', () => withErrorHandlerMock)

    vi.doMock('@/app/lib/errors/AppError', async () => {
      return await vi.importActual<typeof import('@/app/lib/errors/AppError')>(
        '@/app/lib/errors/AppError'
      )
    })

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      }
    }))

    const routeModule = await import('@/app/api/clusters/create/route')
    POST = routeModule.POST
  })

  describe('security middleware', () => {
    it('returns early when security middleware blocks', async () => {
      const blockedResponse = new Response(
        JSON.stringify({ error: 'Rate limited' }),
        { status: 429 }
      )
      mockApiSecurityMiddleware.mockResolvedValue(blockedResponse)

      const response = await POST(makeRequest(validClusterData))
      expect(response.status).toBe(429)
    })
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: 'No session' }
          })
        },
        from: vi.fn().mockReturnValue(createChain())
      })

      const response = await POST(makeRequest(validClusterData))
      expect(response.status).toBe(401)
    })

    it('does not let a matching API key elevate a fresh non-leader mapping', async () => {
      const memberResult = {
        data: { role: 'member', guild_code: 'GUILD1' },
        error: null
      }
      const memberChainHandler: ProxyHandler<Record<string, unknown>> = {
        get(_t, prop) {
          if (prop === 'then')
            return (resolve: ThenResolve) => resolve(memberResult)
          return vi.fn().mockReturnValue(new Proxy({}, memberChainHandler))
        }
      }
      const memberChain = new Proxy({}, memberChainHandler)

      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null
          })
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'player_mapping') return memberChain
          return new Proxy(
            {},
            {
              get() {
                return vi.fn().mockReturnValue(
                  new Proxy(
                    {},
                    {
                      get(_, p) {
                        if (p === 'then')
                          return (r: ThenResolve) =>
                            r({ data: null, error: null })
                        return vi.fn()
                      }
                    }
                  )
                )
              }
            }
          )
        })
      })

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'GUILD1',
              displayName: 'Guild One',
              leaderEmail: '',
              apiKey: 'matching-key'
            }
          ]
        })
      )
      expect(response.status).toBe(403)
      expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
      expect(serviceAuthorityWrites).toEqual([])
    })

    it('fails closed when the current profile lookup errors', async () => {
      const profileChain = createChain({
        data: null,
        error: { message: 'profile lookup unavailable' }
      })
      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null
          })
        },
        from: vi
          .fn()
          .mockImplementation((table: string) =>
            table === 'player_mapping' ? profileChain : createChain()
          )
      })

      const response = await POST(makeRequest(validClusterData))

      expect(response.status).toBe(500)
      expect(serviceAuthorityWrites).not.toContainEqual(
        expect.objectContaining({ table: 'clusters' })
      )
    })

    it('does not grant cluster authority to a current null-role profile', async () => {
      const profileChain = createChain({
        data: { id: 'pm-1', role: null, guild_code: 'MYGUILD' },
        error: null
      })
      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null
          })
        },
        from: vi
          .fn()
          .mockImplementation((table: string) =>
            table === 'player_mapping' ? profileChain : createChain()
          )
      })

      const response = await POST(makeRequest(validClusterData))

      expect(response.status).toBe(403)
      expect(serviceAuthorityWrites).not.toContainEqual(
        expect.objectContaining({ table: 'clusters' })
      )
    })
  })

  describe('validation', () => {
    it('returns 400 when clusterCode is missing', async () => {
      const response = await POST(makeRequest({ displayName: 'Test' }))
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('required')
    })

    it('returns 400 when displayName is missing', async () => {
      const response = await POST(makeRequest({ clusterCode: 'TEST' }))
      expect(response.status).toBe(400)
    })

    it('returns 400 for invalid cluster code format', async () => {
      const response = await POST(
        makeRequest({ clusterCode: 'a', displayName: 'Test' })
      )
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('2-10')
    })

    it('returns 400 for cluster code with special characters', async () => {
      const response = await POST(
        makeRequest({ clusterCode: 'AB-CD', displayName: 'Test' })
      )
      expect(response.status).toBe(400)
    })

    it('returns 400 when foundingGuilds exceeds the WI-4371 cap', async () => {
      const response = await POST(
        makeRequest({
          clusterCode: 'TEST',
          displayName: 'Test',
          foundingGuilds: Array.from({ length: 11 }, (_, i) => ({
            guildCode: `GUILD${i}`,
            displayName: `Guild ${i}`
          }))
        })
      )
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('at most 10 founding guilds')
    })

    it('returns 400 (not 500) for a non-string webhook URL', async () => {
      const response = await POST(
        makeRequest({
          clusterCode: 'TEST',
          displayName: 'Test',
          discordWebhookUrl: 123
        })
      )
      expect(response.status).toBe(400)
      expect(serviceAuthorityWrites).toEqual([])
    })

    it('returns 400 for a Discord channel link before creating anything', async () => {
      const response = await POST(
        makeRequest({
          clusterCode: 'TEST',
          displayName: 'Test',
          discordWebhookUrl: 'https://discord.com/channels/111/222'
        })
      )
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toContain('CHANNEL URL')
      expect(serviceAuthorityWrites).toEqual([])
    })

    it('accepts valid 2-10 char alphanumeric code', async () => {
      const response = await POST(
        makeRequest({ clusterCode: 'AB12', displayName: 'Test' })
      )
      expect(response.status).not.toBe(400)
    })
  })

  describe('conflict detection', () => {
    it('returns 409 when cluster code already exists', async () => {
      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null
          })
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'clusters') {
            const chain = createChain()
            chain.maybeSingle = vi.fn().mockResolvedValue({
              data: { id: 'existing-id' },
              error: null
            })
            return chain
          }
          if (table === 'player_mapping') {
            const chain = createChain()
            chain.single = vi
              .fn()
              .mockResolvedValue({ data: null, error: null })
            return chain
          }
          return createChain()
        })
      })

      const response = await POST(makeRequest(validClusterData))
      expect(response.status).toBe(409)
      const body = await response.json()
      expect(body.error).toContain('already exists')
    })

    it('fails closed when cluster-code availability cannot be read', async () => {
      const profileChain = createChain({ data: null, error: null })
      const clusterChain = createChain({
        data: null,
        error: { message: 'cluster lookup unavailable' }
      })
      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null
          })
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'player_mapping') return profileChain
          if (table === 'clusters') return clusterChain
          return createChain()
        })
      })

      const response = await POST(makeRequest(validClusterData))

      expect(response.status).toBe(500)
      expect(serviceAuthorityWrites).not.toContainEqual(
        expect.objectContaining({ table: 'clusters' })
      )
    })
  })

  describe('invite code generation', () => {
    it('generates invite code when setupMethod is invite_code', async () => {
      const response = await POST(
        makeRequest({ ...validClusterData, setupMethod: 'invite_code' })
      )
      expect(response.status).toBe(200)
      expect(mockGenerateInviteCode).toHaveBeenCalled()
    })

    it('generates invite code when generateInviteCode is true', async () => {
      const response = await POST(
        makeRequest({ ...validClusterData, generateInviteCode: true })
      )
      expect(response.status).toBe(200)
      expect(mockGenerateInviteCode).toHaveBeenCalled()
    })

    it('does not generate invite code by default', async () => {
      await POST(makeRequest(validClusterData))
      expect(mockGenerateInviteCode).not.toHaveBeenCalled()
    })

    it('returns 500 when invite code generation fails', async () => {
      mockGenerateInviteCode.mockRejectedValue(new Error('RNG failed'))

      const response = await POST(
        makeRequest({ ...validClusterData, setupMethod: 'invite_code' })
      )
      expect(response.status).toBe(500)
    })
  })

  describe('successful creation', () => {
    it('fails closed when the privileged cluster insert errors', async () => {
      mockCreateServiceClient.mockReturnValue(
        buildServiceClient({
          clusterInsert: {
            data: null,
            error: { message: 'raw postgres cluster insert detail' }
          }
        })
      )

      const response = await POST(makeRequest(validClusterData))
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBe('The cluster could not be created.')
      expect(JSON.stringify(body)).not.toContain('raw postgres')
    })

    it('fails closed when the privileged cluster insert returns no row', async () => {
      mockCreateServiceClient.mockReturnValue(
        buildServiceClient({
          clusterInsert: { data: null, error: null }
        })
      )

      const response = await POST(makeRequest(validClusterData))

      expect(response.status).toBe(500)
    })

    it('returns success with cluster data', async () => {
      const response = await POST(makeRequest(validClusterData))
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.cluster).toBeDefined()
      expect(body.message).toContain('TESTCL')
      expect(sessionAuthorityWrites).toEqual([])
      expect(serviceAuthorityWrites).toContainEqual({
        table: 'clusters',
        operation: 'insert',
        payload: expect.objectContaining({
          cluster_code: 'TESTCL',
          created_by: 'user-123'
        })
      })
    })

    it('includes invite code in response when generated', async () => {
      const response = await POST(
        makeRequest({ ...validClusterData, setupMethod: 'invite_code' })
      )
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.inviteCode).toBe('INVITE-ABC123')
      expect(body.setupMethod).toBe('invite_code')
    })
  })

  describe('warning accumulation', () => {
    it('returns warnings for non-critical failures without blocking', async () => {
      function thenableChain(result: MockResult) {
        const h: ProxyHandler<Record<string, unknown>> = {
          get(_t, prop) {
            if (prop === 'then')
              return (resolve: ThenResolve) => resolve(result)
            return vi.fn().mockReturnValue(new Proxy({}, h))
          }
        }
        return new Proxy({}, h)
      }

      const clustersHandler: ProxyHandler<Record<string, unknown>> = {
        get(_t, prop) {
          if (prop === 'insert') {
            return vi.fn().mockReturnValue(
              thenableChain({
                data: {
                  id: 'c1',
                  cluster_code: 'TESTCL',
                  display_name: 'Test Cluster'
                },
                error: null
              })
            )
          }
          if (prop === 'then') {
            return (resolve: ThenResolve) =>
              resolve({ data: null, error: null })
          }
          return vi.fn().mockReturnValue(new Proxy({}, clustersHandler))
        }
      }

      mockCreateClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123', email: 'test@example.com' } },
            error: null
          })
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'player_mapping') {
            return thenableChain({ data: null, error: null })
          }
          if (table === 'clusters') {
            return new Proxy({}, clustersHandler)
          }
          if (table === 'webhook_config') {
            return {
              insert: vi.fn().mockResolvedValue({
                error: { message: 'webhook table error' }
              })
            }
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        })
      })

      const response = await POST(
        makeRequest({
          ...validClusterData,
          discordWebhookUrl:
            'https://discord.com/api/webhooks/123/PLACEHOLDER-token'
        })
      )
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.warnings).toBeDefined()
      expect(body.warnings.length).toBeGreaterThan(0)
      expect(
        body.warnings.some((w: string) => w.includes('Webhook config'))
      ).toBe(true)
    })
  })

  describe('founding guilds', () => {
    function thenableChain(result: MockResult) {
      const h: ProxyHandler<Record<string, unknown>> = {
        get(_t, prop) {
          if (prop === 'then') return (resolve: ThenResolve) => resolve(result)
          return vi.fn().mockReturnValue(new Proxy({}, h))
        }
      }
      return new Proxy({}, h)
    }

    function buildFoundingGuildsMockClient(
      overrides: {
        guildConfigLookup?: (guildCode: string) => MockResult
        legacyCanonicalGuildCode?: string | null
        playerMappingGuildCode?: string | null
        playerMappingClusterId?: string | null
        playerMappingClusterCode?: string | null
        guildConfigUpdate?: MockResultSource
        guildConfigInsert?: MockResult
        guildConfigReadback?: MockResultSource
        playerMappingUpdate?: MockResultSource
        playerMappingReadback?: MockResultSource
        guildConfigDelete?: MockResultSource
      } = {}
    ) {
      mockCreateServiceClient.mockReturnValue(
        buildServiceClient({
          guildConfigUpdate: overrides.guildConfigUpdate,
          guildConfigInsert: overrides.guildConfigInsert,
          guildConfigReadback: overrides.guildConfigReadback,
          playerMappingUpdate: overrides.playerMappingUpdate,
          playerMappingReadback: overrides.playerMappingReadback,
          guildConfigDelete: overrides.guildConfigDelete
        })
      )

      const clusterNewRow = {
        id: 'cluster-uuid-1',
        cluster_code: 'TESTCL',
        display_name: 'Test Cluster'
      }

      const clustersHandler: ProxyHandler<Record<string, unknown>> = {
        get(_t, prop) {
          if (prop === 'insert') {
            return vi
              .fn()
              .mockReturnValue(
                thenableChain({ data: clusterNewRow, error: null })
              )
          }
          if (prop === 'then') {
            return (resolve: ThenResolve) =>
              resolve({ data: null, error: null })
          }
          return vi.fn().mockReturnValue(new Proxy({}, clustersHandler))
        }
      }

      let guildConfigCallCount = 0
      let currentGuildCode: string | null = null

      return {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123', email: 'test@example.com' } },
            error: null
          })
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'player_mapping') {
            return thenableChain({
              data:
                overrides.playerMappingGuildCode !== undefined
                  ? {
                      id: 7,
                      user_id: 'user-123',
                      guild_code: overrides.playerMappingGuildCode,
                      cluster_id: overrides.playerMappingClusterId ?? null,
                      cluster_code: overrides.playerMappingClusterCode ?? null,
                      role: 'leader',
                      is_current: true
                    }
                  : null,
              error: null
            })
          }
          if (table === 'guild_code_legacy_map') {
            return thenableChain({
              data: overrides.legacyCanonicalGuildCode
                ? {
                    canonical_guild_code: overrides.legacyCanonicalGuildCode
                  }
                : null,
              error: null
            })
          }
          if (table === 'clusters') return new Proxy({}, clustersHandler)
          if (table === 'guild_config') {
            const guildChain: Record<string, ReturnType<typeof vi.fn>> = {}
            const methods = ['select', 'eq', 'in', 'order', 'limit']
            for (const method of methods) {
              guildChain[method] = vi
                .fn()
                .mockImplementation((...args: MockArgs) => {
                  if (method === 'eq' && args[0] === 'guild_code') {
                    currentGuildCode = args[1] as string
                  }
                  return guildChain
                })
            }
            guildChain.maybeSingle = vi.fn().mockImplementation(() => {
              if (overrides.guildConfigLookup && currentGuildCode) {
                return Promise.resolve(
                  overrides.guildConfigLookup(currentGuildCode)
                )
              }
              return Promise.resolve({ data: null, error: null })
            })
            guildChain.update = vi.fn().mockImplementation(() => {
              const updateChain: Record<string, ReturnType<typeof vi.fn>> = {}
              const uMethods = ['eq']
              for (const m of uMethods) {
                updateChain[m] = vi.fn().mockReturnValue(updateChain)
              }
              updateChain.then = ((resolve: ThenResolve) =>
                resolve(
                  overrides.guildConfigUpdate ?? { error: null }
                )) as unknown as ReturnType<typeof vi.fn>
              return updateChain
            })
            guildChain.insert = vi.fn().mockImplementation(() => {
              return Promise.resolve(
                overrides.guildConfigInsert ?? { error: null }
              )
            })
            return guildChain
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        })
      }
    }

    it("claims creator's own existing guild successfully", async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildCode: 'MYGUILD', guildId: 'guild-id-1' }
      })
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: (code) =>
            code === 'MYGUILD'
              ? {
                  data: {
                    id: 101,
                    guild_code: 'MYGUILD',
                    guild_id: 'guild-id-1',
                    cluster_code: null,
                    cluster_id: null,
                    is_cluster: false
                  },
                  error: null
                }
              : { data: null, error: null },
          playerMappingGuildCode: 'MYGUILD'
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'MYGUILD',
              displayName: 'My Guild',
              leaderEmail: '',
              apiKey: 'matching-key'
            }
          ]
        })
      )
      const body = await response.json()
      expect(body.success).toBe(true)
      const warnings = body.warnings ?? []
      expect(
        warnings.every((w: string) => !w.includes('cannot be claimed'))
      ).toBe(true)
      expect(serviceAuthorityWrites).toContainEqual({
        table: 'guild_config',
        operation: 'update',
        payload: expect.objectContaining({
          cluster_id: 'cluster-uuid-1',
          cluster_code: 'TESTCL'
        })
      })
      expect(serviceAuthorityWrites).toContainEqual({
        table: 'player_mapping',
        operation: 'update',
        payload: expect.objectContaining({
          guild_code: 'MYGUILD',
          cluster_id: 'cluster-uuid-1',
          cluster_code: 'TESTCL'
        })
      })
      expect(serviceAuthorityFilters).toEqual([
        ['id', 101],
        ['guild_code', 'MYGUILD'],
        ['guild_id', 'guild-id-1'],
        ['cluster_id', null],
        ['cluster_code', null],
        ['is_cluster', false],
        ['id', 7],
        ['user_id', 'user-123'],
        ['is_current', true],
        ['role', 'leader'],
        ['guild_code', 'MYGUILD'],
        ['cluster_id', null],
        ['cluster_code', null]
      ])
    })

    it('continues when a response-lost existing founding-guild update reads back at target', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildCode: 'MYGUILD', guildId: 'guild-id-1' }
      })
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: (code) =>
            code === 'MYGUILD'
              ? {
                  data: {
                    id: 101,
                    guild_code: 'MYGUILD',
                    guild_id: 'guild-id-1',
                    cluster_id: null,
                    cluster_code: null,
                    is_cluster: false
                  },
                  error: null
                }
              : { data: null, error: null },
          playerMappingGuildCode: 'MYGUILD',
          guildConfigUpdate: {
            data: null,
            error: { message: 'raw response-lost guild detail' },
            status: 0
          },
          guildConfigReadback: {
            data: {
              id: 101,
              guild_code: 'MYGUILD',
              guild_id: 'guild-id-1',
              cluster_id: 'cluster-uuid-1',
              cluster_code: 'TESTCL',
              is_cluster: true
            },
            error: null
          }
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'MYGUILD',
              displayName: 'My Guild',
              leaderEmail: '',
              apiKey: 'matching-key'
            }
          ]
        })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(JSON.stringify(body)).not.toContain('raw response-lost')
      expect(body.warnings ?? []).not.toContainEqual(
        expect.stringContaining('CLUSTER_CREATE_GUILD_STATE_UNKNOWN')
      )
      expect(serviceAuthorityReads).toContain('guild_config')
      expect(serviceAuthorityWrites).toContainEqual(
        expect.objectContaining({
          table: 'player_mapping',
          operation: 'update'
        })
      )
    })

    it('does not mutate mapping when existing founding-guild readback is mixed', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildCode: 'MYGUILD', guildId: 'guild-id-1' }
      })
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: () => ({
            data: {
              id: 101,
              guild_code: 'MYGUILD',
              guild_id: 'guild-id-1',
              cluster_id: null,
              cluster_code: null,
              is_cluster: false
            },
            error: null
          }),
          playerMappingGuildCode: 'MYGUILD',
          guildConfigUpdate: {
            data: null,
            error: { message: 'raw ambiguous guild detail' },
            status: 0
          },
          guildConfigReadback: {
            data: {
              id: 101,
              guild_code: 'MYGUILD',
              guild_id: 'guild-id-1',
              cluster_id: 'different-cluster',
              cluster_code: 'OTHER',
              is_cluster: true
            },
            error: null
          }
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'MYGUILD',
              displayName: 'My Guild',
              leaderEmail: '',
              apiKey: 'matching-key'
            }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(
        body.warnings.some((warning: string) =>
          warning.includes('CLUSTER_CREATE_GUILD_STATE_UNKNOWN')
        )
      ).toBe(true)
      expect(JSON.stringify(body)).not.toContain('raw ambiguous')
      expect(serviceAuthorityWrites).not.toContainEqual(
        expect.objectContaining({
          table: 'player_mapping',
          operation: 'update'
        })
      )
    })

    it('rejects a mapping-owned existing guild when its immutable ID is missing', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildCode: 'MYGUILD', guildId: 'guild-id-1' }
      })
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: (code) =>
            code === 'MYGUILD'
              ? {
                  data: {
                    id: 101,
                    guild_code: 'MYGUILD',
                    guild_id: null,
                    cluster_code: null,
                    cluster_id: null
                  },
                  error: null
                }
              : { data: null, error: null },
          playerMappingGuildCode: 'MYGUILD'
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'MYGUILD',
              displayName: 'My Guild',
              leaderEmail: '',
              apiKey: 'matching-key'
            }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(
        body.warnings.some((warning: string) =>
          warning.includes('stored and live guild IDs could not be verified')
        )
      ).toBe(true)
      expect(serviceAuthorityWrites).not.toContainEqual({
        table: 'guild_config',
        operation: 'update',
        payload: expect.anything()
      })
    })

    it('restores an existing founding guild when the mapping CAS stays prior', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildCode: 'MYGUILD', guildId: 'guild-id-1' }
      })
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: (code) =>
            code === 'MYGUILD'
              ? {
                  data: {
                    id: 101,
                    guild_code: 'MYGUILD',
                    guild_id: 'guild-id-1',
                    cluster_id: null,
                    cluster_code: null,
                    is_cluster: false
                  },
                  error: null
                }
              : { data: null, error: null },
          playerMappingGuildCode: 'MYGUILD',
          playerMappingUpdate: { data: null, error: null },
          playerMappingReadback: {
            data: {
              id: 7,
              user_id: 'user-123',
              guild_code: 'MYGUILD',
              cluster_id: null,
              cluster_code: null,
              role: 'leader',
              is_current: true
            },
            error: null
          }
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'MYGUILD',
              displayName: 'My Guild',
              leaderEmail: '',
              apiKey: 'matching-key'
            }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(
        body.warnings.some((warning: string) =>
          warning.includes('CLUSTER_CREATE_MAPPING_RETRY')
        )
      ).toBe(true)
      expect(serviceAuthorityReads).toEqual(['player_mapping'])
      expect(serviceAuthorityReadFilters).toEqual([
        ['id', 7],
        ['user_id', 'user-123']
      ])
      expect(
        serviceAuthorityWrites.filter((write) => write.table === 'guild_config')
      ).toEqual([
        expect.objectContaining({
          operation: 'update',
          payload: expect.objectContaining({
            cluster_id: 'cluster-uuid-1',
            cluster_code: 'TESTCL',
            is_cluster: true
          })
        }),
        expect.objectContaining({
          operation: 'update',
          payload: expect.objectContaining({
            cluster_id: null,
            cluster_code: null,
            is_cluster: false
          })
        })
      ])
    })

    it("rejects claiming another user's guild", async () => {
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: (code) =>
            code === 'OTHERGUILD'
              ? {
                  data: {
                    guild_code: 'OTHERGUILD',
                    cluster_code: 'X',
                    cluster_id: 'x'
                  },
                  error: null
                }
              : { data: null, error: null },
          playerMappingGuildCode: 'MYGUILD' // user's guild is different
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'OTHERGUILD',
              displayName: 'Other Guild',
              leaderEmail: ''
            }
          ]
        })
      )
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.warnings).toBeDefined()
      expect(
        body.warnings.some((w: string) => w.includes('cannot be claimed'))
      ).toBe(true)
    })

    it('does not let a matching API key claim a foreign existing guild', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildCode: 'OTHERGUILD', guildId: 'other-guild-id' }
      })
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: (code) =>
            code === 'OTHERGUILD'
              ? {
                  data: {
                    id: 102,
                    guild_code: 'OTHERGUILD',
                    guild_id: 'other-guild-id',
                    cluster_code: null,
                    cluster_id: null
                  },
                  error: null
                }
              : { data: null, error: null },
          playerMappingGuildCode: 'MYGUILD'
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'OTHERGUILD',
              displayName: 'Other Guild',
              leaderEmail: '',
              apiKey: 'matching-key'
            }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(
        body.warnings.some((warning: string) =>
          warning.includes('cannot be claimed')
        )
      ).toBe(true)
      expect(serviceAuthorityWrites).not.toContainEqual({
        table: 'guild_config',
        operation: 'update',
        payload: expect.anything()
      })
    })

    it('rejects a matching tag when immutable guild IDs differ', async () => {
      const existingGuildId = '11111111-1111-1111-1111-111111111111'
      const keyGuildId = '22222222-2222-2222-2222-222222222222'
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildCode: 'SHAREDTAG', guildId: keyGuildId }
      })
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: (code) =>
            code === 'SHAREDTAG'
              ? {
                  data: {
                    id: 105,
                    guild_code: existingGuildId,
                    guild_tag: 'SHAREDTAG',
                    guild_id: existingGuildId,
                    cluster_code: null,
                    cluster_id: null
                  },
                  error: null
                }
              : { data: null, error: null },
          playerMappingGuildCode: existingGuildId
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'SHAREDTAG',
              displayName: 'Existing Guild',
              leaderEmail: '',
              apiKey: 'wrong-id-key'
            }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(
        body.warnings.some((warning: string) =>
          warning.includes('stored and live guild IDs could not be verified')
        )
      ).toBe(true)
      expect(serviceAuthorityWrites).not.toContainEqual({
        table: 'guild_config',
        operation: 'update',
        payload: expect.anything()
      })
    })

    it('re-resolves a validated guild ID before creating a duplicate row', async () => {
      const canonicalGuildId = '11111111-1111-1111-1111-111111111111'
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildCode: 'NEWTAG', guildId: canonicalGuildId }
      })
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: (code) =>
            code === canonicalGuildId
              ? {
                  data: {
                    id: 103,
                    guild_code: canonicalGuildId,
                    guild_tag: null,
                    guild_id: canonicalGuildId,
                    cluster_code: null,
                    cluster_id: null,
                    is_cluster: false
                  },
                  error: null
                }
              : { data: null, error: null },
          playerMappingGuildCode: canonicalGuildId,
          guildConfigUpdate: {
            data: {
              id: 103,
              guild_code: canonicalGuildId,
              guild_id: canonicalGuildId,
              cluster_id: 'cluster-uuid-1',
              cluster_code: 'TESTCL',
              is_cluster: true
            },
            error: null
          }
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'NEWTAG',
              displayName: 'Existing Guild',
              leaderEmail: '',
              apiKey: 'matching-key'
            }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(serviceAuthorityWrites).toContainEqual({
        table: 'guild_config',
        operation: 'update',
        payload: expect.objectContaining({ cluster_code: 'TESTCL' })
      })
      expect(serviceAuthorityWrites).not.toContainEqual({
        table: 'guild_config',
        operation: 'insert',
        payload: expect.anything()
      })
    })

    it('resolves legacy guild codes before the authority update', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildCode: 'CANONICAL', guildId: 'guild-id-1' }
      })
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: (code) =>
            code === 'CANONICAL'
              ? {
                  data: {
                    id: 104,
                    guild_code: 'CANONICAL',
                    guild_id: 'guild-id-1',
                    cluster_code: null,
                    cluster_id: null,
                    is_cluster: false
                  },
                  error: null
                }
              : { data: null, error: null },
          legacyCanonicalGuildCode: 'CANONICAL',
          playerMappingGuildCode: 'CANONICAL',
          guildConfigUpdate: {
            data: {
              id: 104,
              guild_code: 'CANONICAL',
              guild_id: 'guild-id-1',
              cluster_id: 'cluster-uuid-1',
              cluster_code: 'TESTCL',
              is_cluster: true
            },
            error: null
          }
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'oldcode',
              displayName: 'My Guild',
              leaderEmail: '',
              apiKey: 'matching-key'
            }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(serviceAuthorityFilters).toEqual([
        ['id', 104],
        ['guild_code', 'CANONICAL'],
        ['guild_id', 'guild-id-1'],
        ['cluster_id', null],
        ['cluster_code', null],
        ['is_cluster', false],
        ['id', 7],
        ['user_id', 'user-123'],
        ['is_current', true],
        ['role', 'leader'],
        ['guild_code', 'CANONICAL'],
        ['cluster_id', null],
        ['cluster_code', null]
      ])
    })

    it('fails closed when canonical guild lookup errors', async () => {
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: () => ({
            data: null,
            error: { message: 'raw postgrest lookup detail' }
          })
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            { guildCode: 'NEWGUILD', displayName: 'New Guild', leaderEmail: '' }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(JSON.stringify(body)).not.toContain('raw postgrest')
      expect(
        body.warnings.some((warning: string) =>
          warning.includes('CLUSTER_CREATE_GUILD_LOOKUP_FAILED')
        )
      ).toBe(true)
      expect(serviceAuthorityWrites).not.toContainEqual({
        table: 'guild_config',
        operation: 'insert',
        payload: expect.anything()
      })
    })

    it('fails closed when a legacy map points to a missing guild', async () => {
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: () => ({ data: null, error: null }),
          legacyCanonicalGuildCode: 'MISSING-GUILD',
          playerMappingGuildCode: 'MISSING-GUILD'
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'oldcode',
              displayName: 'Missing Guild',
              leaderEmail: ''
            }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(
        body.warnings.some((warning: string) =>
          warning.includes('CLUSTER_CREATE_GUILD_LOOKUP_FAILED')
        )
      ).toBe(true)
      expect(serviceAuthorityWrites).not.toContainEqual({
        table: 'guild_config',
        operation: 'insert',
        payload: expect.anything()
      })
    })

    it('creates a mapping-owned new guild and enriches it with a valid API key', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildCode: 'NEWGUILD', guildName: 'New Guild' }
      })
      mockEncryptApiKey.mockResolvedValue('cipher')
      mockGenerateApiKeyUpdatePayload.mockReturnValue({
        api_key_encrypted: 'cipher',
        api_key_validated_at: '2026-04-08'
      })

      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: () => ({ data: null, error: null }),
          playerMappingGuildCode: 'NEWGUILD'
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'NEWGUILD',
              displayName: 'New Guild',
              leaderEmail: '',
              apiKey: 'valid-key'
            }
          ]
        })
      )
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(mockValidateApiKeyWithTacticus).toHaveBeenCalledWith(
        'valid-key',
        false
      )
      expect(mockEncryptApiKey).toHaveBeenCalledWith('valid-key')
      expect(serviceAuthorityWrites).toContainEqual({
        table: 'guild_config',
        operation: 'insert',
        payload: expect.objectContaining({
          guild_code: 'NEWGUILD',
          guild_tag: 'NEWGUILD'
        })
      })
      expect(serviceAuthorityWrites).toContainEqual({
        table: 'player_mapping',
        operation: 'update',
        payload: expect.objectContaining({
          guild_code: 'NEWGUILD',
          cluster_id: 'cluster-uuid-1',
          cluster_code: 'TESTCL'
        })
      })
      expect(serviceAuthorityFilters).toEqual([
        ['id', 7],
        ['user_id', 'user-123'],
        ['is_current', true],
        ['role', 'leader'],
        ['guild_code', 'NEWGUILD'],
        ['cluster_id', null],
        ['cluster_code', null]
      ])
    })

    it('canonicalizes lowercase mapping-owned guild codes before insertion', async () => {
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: () => ({ data: null, error: null }),
          playerMappingGuildCode: 'NEWGUILD'
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            { guildCode: 'newguild', displayName: 'New Guild', leaderEmail: '' }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(serviceAuthorityWrites).toContainEqual({
        table: 'guild_config',
        operation: 'insert',
        payload: expect.objectContaining({ guild_code: 'NEWGUILD' })
      })
    })

    it('continues when a response-lost new founding-guild insert reads back at target', async () => {
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: () => ({ data: null, error: null }),
          playerMappingGuildCode: 'NEWGUILD',
          guildConfigInsert: {
            data: null,
            error: { message: 'raw response-lost insert detail' },
            status: 0
          },
          guildConfigReadback: {
            data: {
              id: 101,
              guild_code: 'NEWGUILD',
              guild_id: null,
              cluster_id: 'cluster-uuid-1',
              cluster_code: 'TESTCL',
              is_cluster: true,
              display_name: 'New Guild'
            },
            error: null
          }
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            { guildCode: 'NEWGUILD', displayName: 'New Guild', leaderEmail: '' }
          ]
        })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(JSON.stringify(body)).not.toContain('raw response-lost')
      expect(body.warnings ?? []).not.toContainEqual(
        expect.stringContaining('CLUSTER_CREATE_GUILD_STATE_UNKNOWN')
      )
      expect(serviceAuthorityReads).toContain('guild_config')
      expect(serviceAuthorityWrites).toContainEqual(
        expect.objectContaining({
          table: 'player_mapping',
          operation: 'update'
        })
      )
    })

    it('deletes a new founding guild when the mapping CAS stays prior', async () => {
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: () => ({ data: null, error: null }),
          playerMappingGuildCode: 'NEWGUILD',
          playerMappingUpdate: { data: null, error: null },
          playerMappingReadback: {
            data: {
              id: 7,
              user_id: 'user-123',
              guild_code: 'NEWGUILD',
              cluster_id: null,
              cluster_code: null,
              role: 'leader',
              is_current: true
            },
            error: null
          }
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            { guildCode: 'NEWGUILD', displayName: 'New Guild', leaderEmail: '' }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(
        body.warnings.some((warning: string) =>
          warning.includes('CLUSTER_CREATE_MAPPING_RETRY')
        )
      ).toBe(true)
      expect(serviceAuthorityDeletes).toEqual(['guild_config'])
      expect(serviceAuthorityDeleteFilters).toEqual([
        ['id', 101],
        ['guild_code', 'NEWGUILD'],
        ['cluster_id', 'cluster-uuid-1'],
        ['cluster_code', 'TESTCL'],
        ['is_cluster', true],
        ['guild_id', null]
      ])
    })

    it('rejects a new founding-guild witness with mismatched target state', async () => {
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: () => ({ data: null, error: null }),
          playerMappingGuildCode: 'NEWGUILD',
          guildConfigInsert: {
            data: {
              id: 101,
              guild_code: 'NEWGUILD',
              guild_id: null,
              cluster_id: 'cluster-uuid-1',
              cluster_code: 'WRONG',
              is_cluster: true
            },
            error: null
          }
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            { guildCode: 'NEWGUILD', displayName: 'New Guild', leaderEmail: '' }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(
        body.warnings.some((warning: string) =>
          warning.includes('CLUSTER_CREATE_GUILD_INSERT_FAILED')
        )
      ).toBe(true)
      expect(serviceAuthorityWrites).not.toContainEqual(
        expect.objectContaining({ table: 'player_mapping' })
      )
    })

    it('collects error for invalid API key without blocking creation', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'raw upstream key validation detail'
      })

      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: () => ({ data: null, error: null })
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'NEWGUILD',
              displayName: 'New Guild',
              leaderEmail: '',
              apiKey: 'bad-key'
            }
          ]
        })
      )
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(JSON.stringify(body)).not.toContain('raw upstream')
      expect(
        body.warnings.some((w: string) =>
          w.includes('CLUSTER_CREATE_API_KEY_INVALID')
        )
      ).toBe(true)
      expect(serviceAuthorityWrites).not.toContainEqual({
        table: 'guild_config',
        operation: 'insert',
        payload: expect.anything()
      })
    })

    it('does not elevate an unverified new guild to service authority', async () => {
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: () => ({ data: null, error: null })
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            { guildCode: 'NEWGUILD', displayName: 'New Guild', leaderEmail: '' }
          ]
        })
      )
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
      expect(mockEncryptApiKey).not.toHaveBeenCalled()
      expect(
        body.warnings.some((warning: string) =>
          warning.includes("not the creator's current mapped guild")
        )
      ).toBe(true)
      expect(serviceAuthorityWrites).not.toContainEqual({
        table: 'guild_config',
        operation: 'insert',
        payload: expect.anything()
      })
    })

    it('handles guild insert error as warning', async () => {
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: () => ({ data: null, error: null }),
          playerMappingGuildCode: 'FAILGUILD',
          guildConfigInsert: { error: { message: 'duplicate key value' } }
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'FAILGUILD',
              displayName: 'Fail Guild',
              leaderEmail: ''
            }
          ]
        })
      )
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.warnings.some((w: string) => w.includes('Fail Guild'))).toBe(
        true
      )
    })

    it('handles guild update error when claiming own guild', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildCode: 'MYGUILD', guildId: 'guild-id-1' }
      })
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: (code) =>
            code === 'MYGUILD'
              ? {
                  data: {
                    id: 101,
                    guild_code: 'MYGUILD',
                    guild_id: 'guild-id-1',
                    cluster_code: null,
                    cluster_id: null,
                    is_cluster: false
                  },
                  error: null
                }
              : { data: null, error: null },
          playerMappingGuildCode: 'MYGUILD',
          guildConfigUpdate: {
            data: null,
            error: { message: 'update constraint violation' }
          },
          guildConfigReadback: {
            data: {
              id: 101,
              guild_code: 'MYGUILD',
              guild_id: 'guild-id-1',
              cluster_id: null,
              cluster_code: null,
              is_cluster: false
            },
            error: null
          }
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'MYGUILD',
              displayName: 'My Guild',
              leaderEmail: '',
              apiKey: 'matching-key'
            }
          ]
        })
      )
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(
        body.warnings.some((w: string) =>
          w.includes('CLUSTER_CREATE_GUILD_UPDATE_FAILED')
        )
      ).toBe(true)
    })

    it('treats a zero-row guild claim as a failed authority write', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildCode: 'MYGUILD', guildId: 'guild-id-1' }
      })
      mockCreateClient.mockResolvedValue(
        buildFoundingGuildsMockClient({
          guildConfigLookup: (code) =>
            code === 'MYGUILD'
              ? {
                  data: {
                    id: 101,
                    guild_code: 'MYGUILD',
                    guild_id: 'guild-id-1',
                    cluster_code: null,
                    cluster_id: null,
                    is_cluster: false
                  },
                  error: null
                }
              : { data: null, error: null },
          playerMappingGuildCode: 'MYGUILD',
          guildConfigUpdate: { data: null, error: null },
          guildConfigReadback: {
            data: {
              id: 101,
              guild_code: 'MYGUILD',
              guild_id: 'guild-id-1',
              cluster_id: null,
              cluster_code: null,
              is_cluster: false
            },
            error: null
          }
        })
      )

      const response = await POST(
        makeRequest({
          ...validClusterData,
          foundingGuilds: [
            {
              guildCode: 'MYGUILD',
              displayName: 'My Guild',
              leaderEmail: '',
              apiKey: 'matching-key'
            }
          ]
        })
      )
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(
        body.warnings.some((warning: string) =>
          warning.includes('CLUSTER_CREATE_GUILD_UPDATE_FAILED')
        )
      ).toBe(true)
    })
  })
})
