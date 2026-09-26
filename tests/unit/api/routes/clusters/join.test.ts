import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockRequireAuthForApi: ReturnType<typeof vi.fn>
let mockDb: ReturnType<typeof vi.fn>
let mockServiceDb: ReturnType<typeof vi.fn>
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>
let mockValidateInviteCode: ReturnType<typeof vi.fn>
let mockGuildConfigServiceFindByCodeOrTag: ReturnType<typeof vi.fn>
let mockEncryptApiKey: ReturnType<typeof vi.fn>
let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>
let mockGenerateApiKeyUpdatePayload: ReturnType<typeof vi.fn>

const testCluster = {
  id: 'cluster-uuid-1',
  cluster_code: 'CLU',
  display_name: 'Test Cluster',
  max_guilds: 5
}

type TestValue = string | number | boolean | null | undefined
type TestUpdate = Record<string, TestValue>

describe('/api/clusters/join', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let GET: (request: NextRequest) => Promise<Response>

  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  let sessionUpdates: Array<{ table: string; payload: TestUpdate }>
  let sessionInserts: Array<{ table: string; payload: TestUpdate }>
  let serviceUpdates: Array<{ table: string; payload: TestUpdate }>
  let serviceInserts: Array<{ table: string; payload: TestUpdate }>
  let serviceDeletes: string[]
  let serviceReads: string[]
  let serviceUpdateFilters: Array<[string, TestValue]>
  let serviceDeleteFilters: Array<[string, TestValue]>
  let serviceReadFilters: Array<[string, TestValue]>
  let lastInsertedGuild: TestUpdate | null

  let fromResults: Record<string, any>

  function setupFromResults(overrides: Record<string, any> = {}) {
    fromResults = {
      'guild_config.update': { error: null },
      'guild_config.insert': { error: null },
      'player_mapping.update': { error: null },
      'player_mapping.select': {
        data: {
          id: 7,
          user_id: 'user-1',
          guild_code: 'MYGUILD',
          cluster_id: null,
          cluster_code: null,
          role: 'leader',
          is_current: true
        },
        error: null
      },
      ...overrides
    }
  }

  beforeEach(async () => {
    vi.resetModules()

    mockRequireAuthForApi = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
      profile: { id: 7, role: 'leader', guild_code: 'MYGUILD' }
    })
    mockApiSecurityMiddleware = vi.fn().mockResolvedValue(null) // pass-through
    mockValidateInviteCode = vi.fn().mockResolvedValue({
      valid: true,
      cluster: testCluster,
      error: null
    })
    mockGuildConfigServiceFindByCodeOrTag = vi.fn().mockResolvedValue(null) // no existing guild
    mockEncryptApiKey = vi.fn().mockResolvedValue('encrypted-key-xxx')
    mockValidateApiKeyWithTacticus = vi.fn().mockResolvedValue({
      isValid: true,
      guildInfo: { guildCode: 'MYGUILD', guildId: 'guild-id-1' }
    })
    mockGenerateApiKeyUpdatePayload = vi.fn().mockReturnValue({
      encrypted_api_key: 'encrypted-key-xxx',
      api_key_validated_at: '2026-04-07T00:00:00Z'
    })

    setupFromResults()
    sessionUpdates = []
    sessionInserts = []
    serviceUpdates = []
    serviceInserts = []
    serviceDeletes = []
    serviceReads = []
    serviceUpdateFilters = []
    serviceDeleteFilters = []
    serviceReadFilters = []
    lastInsertedGuild = null

    mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        const chain: any = {}
        chain.select = vi.fn().mockImplementation(() => {
          chain._operation = 'select'
          return chain
        })
        chain.eq = vi.fn().mockReturnValue(chain)
        chain.single = vi
          .fn()
          .mockImplementation(
            () => fromResults[`${table}.select`] ?? { data: null, error: null }
          )
        chain.maybeSingle = vi
          .fn()
          .mockImplementation(
            () => fromResults[`${table}.select`] ?? { data: null, error: null }
          )
        chain.update = vi.fn().mockImplementation((payload: TestUpdate) => {
          sessionUpdates.push({ table, payload })
          chain._operation = 'update'
          const result = fromResults[`${table}.update`] ?? { error: null }
          const updateChain: any = { ...result }
          updateChain.eq = vi.fn().mockReturnValue(updateChain)
          return updateChain
        })
        chain.insert = vi.fn().mockImplementation((payload: TestUpdate) => {
          sessionInserts.push({ table, payload })
          const insertChain: any = {}
          insertChain.select = vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockReturnValue(
                fromResults[`${table}.insert`] ?? { data: null, error: null }
              )
          })
          return insertChain
        })
        return chain
      })
    }

    mockServiceSupabase = {
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockImplementation(() => {
          serviceReads.push(table)
          const readChain: Record<string, ReturnType<typeof vi.fn>> = {}
          readChain.eq = vi
            .fn()
            .mockImplementation((column: string, value: TestValue) => {
              serviceReadFilters.push([column, value])
              return readChain
            })
          readChain.maybeSingle = vi.fn().mockImplementation(() => {
            const configured = fromResults[`${table}.readback`]
            if (typeof configured === 'function') return configured()
            return (
              configured ??
              fromResults[`${table}.select`] ?? { data: null, error: null }
            )
          })
          return readChain
        }),
        update: vi.fn().mockImplementation((payload: TestUpdate) => {
          serviceUpdates.push({ table, payload })
          const configured = fromResults[`${table}.update`]
          const result =
            typeof configured === 'function'
              ? configured()
              : (configured ?? { error: null })
          const updateChain: any = { ...result }
          const updateFilterValues: Record<string, TestValue> = {}
          updateChain.eq = vi
            .fn()
            .mockImplementation((column: string, value: TestValue) => {
              serviceUpdateFilters.push([column, value])
              updateFilterValues[column] = value
              return updateChain
            })
          updateChain.is = vi
            .fn()
            .mockImplementation((column: string, value: TestValue) => {
              serviceUpdateFilters.push([column, value])
              updateFilterValues[column] = value
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
                        id: updateFilterValues.id ?? 7,
                        user_id: updateFilterValues.user_id ?? 'user-1',
                        guild_code: payload.guild_code,
                        cluster_id: payload.cluster_id,
                        cluster_code: payload.cluster_code,
                        // Postgres echoes the row the CAS filter pinned; `role` is never rewritten.
                        role: updateFilterValues.role ?? 'leader',
                        is_current: true
                      }
                    : {
                        id: updateFilterValues.id ?? 'g-1',
                        guild_code: updateFilterValues.guild_code ?? 'MYGUILD',
                        guild_id: updateFilterValues.guild_id ?? 'guild-id-1',
                        cluster_id: payload.cluster_id,
                        cluster_code: payload.cluster_code,
                        is_cluster: payload.is_cluster
                      },
            error: result.error
          }))
          return updateChain
        }),
        insert: vi.fn().mockImplementation((payload: TestUpdate) => {
          serviceInserts.push({ table, payload })
          if (table === 'guild_config') lastInsertedGuild = payload
          const result = fromResults[`${table}.insert`] ?? {
            error: null
          }
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockReturnValue({
                data:
                  'data' in result
                    ? result.data
                    : {
                        id: 'g-1',
                        guild_code: payload.guild_code,
                        guild_id: payload.guild_id ?? null,
                        cluster_id: payload.cluster_id,
                        cluster_code: payload.cluster_code,
                        is_cluster: payload.is_cluster,
                        display_name: payload.display_name
                      },
                error: result.error
              })
            })
          }
        }),
        delete: vi.fn().mockImplementation(() => {
          serviceDeletes.push(table)
          const configured = fromResults[`${table}.delete`]
          const result =
            typeof configured === 'function'
              ? configured()
              : (configured ?? { error: null })
          const deleteChain: Record<string, ReturnType<typeof vi.fn>> = {}
          deleteChain.eq = vi
            .fn()
            .mockImplementation((column: string, value: TestValue) => {
              serviceDeleteFilters.push([column, value])
              return deleteChain
            })
          deleteChain.is = vi
            .fn()
            .mockImplementation((column: string, value: TestValue) => {
              serviceDeleteFilters.push([column, value])
              return deleteChain
            })
          deleteChain.select = vi.fn().mockReturnValue(deleteChain)
          deleteChain.maybeSingle = vi.fn().mockReturnValue({
            data:
              'data' in result
                ? result.data
                : result.error
                  ? null
                  : {
                      id: 'g-1',
                      guild_code: lastInsertedGuild?.guild_code,
                      guild_id: lastInsertedGuild?.guild_id ?? null,
                      cluster_id: lastInsertedGuild?.cluster_id,
                      cluster_code: lastInsertedGuild?.cluster_code,
                      is_cluster: lastInsertedGuild?.is_cluster
                    },
            error: result.error
          })
          return deleteChain
        })
      }))
    }

    mockDb = vi.fn().mockResolvedValue(mockSupabase)
    mockServiceDb = vi.fn().mockReturnValue(mockServiceSupabase)

    vi.doMock('@/app/lib/db', () => ({
      db: mockDb,
      serviceDb: mockServiceDb
    }))

    vi.doMock('@/app/lib/auth', () => ({
      requireAuthForApi: mockRequireAuthForApi,
      AuthError: class AuthError extends Error {
        code: string
        constructor(message: string, code: string) {
          super(message)
          this.code = code
        }
      }
    }))

    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))

    vi.doMock('@/app/lib/utils/invite-codes', () => ({
      validateInviteCode: mockValidateInviteCode
    }))

    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        findByCodeOrTag: mockGuildConfigServiceFindByCodeOrTag
      }
    }))

    vi.doMock('@tacticus/app-core/encryption', () => ({
      encryptApiKey: mockEncryptApiKey
    }))

    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus,
      generateApiKeyUpdatePayload: mockGenerateApiKeyUpdatePayload
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
      }
    }))

    const { withErrorHandlerMock } =
      await import('@/tests/helpers/mock-error-handler')
    vi.doMock('@/app/lib/middleware/errorHandler', () => withErrorHandlerMock)

    vi.doMock('@/app/lib/errors/AppError', () => ({
      Errors: {
        fromResponse: (status: number, body: Record<string, unknown>) => {
          const err = new Error(JSON.stringify(body)) as any
          err.status = status
          err.body = body
          return err
        },
        fromStatus: (
          status: number,
          message: string,
          extra?: Record<string, unknown>
        ) => {
          const err = new Error(message) as any
          err.status = status
          err.body = { error: message, ...(extra ?? {}) }
          return err
        }
      },
      rethrowIfAppError: (error: unknown) => {
        if ((error as { status?: number })?.status) throw error
      }
    }))

    const mod = await import('@/app/api/clusters/join/route')
    POST = mod.POST
    GET = mod.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  function makePostRequest(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/clusters/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  function makeGetRequest(params?: Record<string, string>) {
    const url = new URL('http://localhost/api/clusters/join')
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    }
    return new NextRequest(url.toString(), { method: 'GET' })
  }

  const validBody = {
    inviteCode: 'VALID-CODE',
    guildData: {
      guildCode: 'MYGUILD',
      displayName: 'My Guild'
    }
  }

  describe('POST /api/clusters/join', () => {
    describe('security middleware', () => {
      it('returns security response when middleware blocks', async () => {
        mockApiSecurityMiddleware.mockResolvedValue(
          new Response(JSON.stringify({ error: 'Rate limited' }), {
            status: 429
          })
        )
        const res = await POST(makePostRequest(validBody))
        expect(res.status).toBe(429)
      })
    })

    describe('authentication', () => {
      it('returns 403 when user role is not leader', async () => {
        mockRequireAuthForApi.mockResolvedValue({
          user: { id: 'user-1' },
          profile: { role: 'member', guild_code: 'MYGUILD' }
        })
        const res = await POST(makePostRequest(validBody))
        expect(res.status).toBe(403)
      })

      it('rejects a fresh non-leader mapping even when cached auth and key look valid', async () => {
        setupFromResults({
          'player_mapping.select': {
            data: {
              id: 7,
              user_id: 'user-1',
              guild_code: 'MYGUILD',
              role: 'officer',
              is_current: true
            },
            error: null
          }
        })

        const res = await POST(
          makePostRequest({
            ...validBody,
            guildData: { ...validBody.guildData, apiKey: 'matching-key' }
          })
        )

        expect(res.status).toBe(403)
        expect(serviceUpdates).toEqual([])
        expect(serviceInserts).toEqual([])
      })
    })

    describe('validation', () => {
      it('returns 400 when inviteCode is missing', async () => {
        const res = await POST(
          makePostRequest({
            guildData: { guildCode: 'G1', displayName: 'Test' }
          })
        )
        expect(res.status).toBe(400)
      })

      it('returns 400 when guildCode is missing', async () => {
        const res = await POST(
          makePostRequest({
            inviteCode: 'CODE',
            guildData: { displayName: 'Test' }
          })
        )
        expect(res.status).toBe(400)
      })

      it('returns 400 when displayName is missing', async () => {
        const res = await POST(
          makePostRequest({
            inviteCode: 'CODE',
            guildData: { guildCode: 'G1' }
          })
        )
        expect(res.status).toBe(400)
      })

      it('returns 400 when invite code is invalid', async () => {
        mockValidateInviteCode.mockResolvedValue({
          valid: false,
          cluster: null,
          error: 'Invite code expired'
        })
        const res = await POST(makePostRequest(validBody))
        expect(res.status).toBe(400)
      })
    })

    describe('guild conversion (existing guild belongs to user)', () => {
      const existingGuild = {
        id: 42,
        guild_code: 'MYGUILD',
        guild_tag: 'MYGUILD',
        guild_id: 'guild-id-1',
        display_name: 'My Guild',
        cluster_id: null,
        cluster_code: null,
        is_cluster: false
      }
      const existingGuildBody = {
        ...validBody,
        guildData: { ...validBody.guildData, apiKey: 'matching-key' }
      }

      it('updates existing guild to join cluster and returns guild_joined', async () => {
        setupFromResults({
          'guild_config.select': { data: existingGuild, error: null }
        })

        const res = await POST(makePostRequest(existingGuildBody))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.action).toBe('guild_joined')
        expect(body.cluster.cluster_code).toBe('CLU')
        expect(sessionUpdates).not.toContainEqual(
          expect.objectContaining({ table: 'guild_config' })
        )
        expect(serviceUpdates).toContainEqual({
          table: 'guild_config',
          payload: expect.objectContaining({
            cluster_id: 'cluster-uuid-1',
            cluster_code: 'CLU'
          })
        })
        expect(serviceUpdates).toContainEqual({
          table: 'player_mapping',
          payload: expect.objectContaining({
            guild_code: 'MYGUILD',
            cluster_id: 'cluster-uuid-1',
            cluster_code: 'CLU'
          })
        })
        expect(serviceUpdateFilters).toEqual([
          ['id', 42],
          ['guild_code', 'MYGUILD'],
          ['guild_id', 'guild-id-1'],
          ['cluster_id', null],
          ['cluster_code', null],
          ['is_cluster', false],
          ['id', 7],
          ['user_id', 'user-1'],
          ['is_current', true],
          ['role', 'leader'],
          ['guild_code', 'MYGUILD'],
          ['cluster_id', null],
          ['cluster_code', null]
        ])
      })

      // SQL compares `lower(pm.role)`.
      it('admits a leader stored as `Leader` and pins the CAS to that value', async () => {
        mockRequireAuthForApi.mockResolvedValue({
          user: { id: 'user-1' },
          profile: { id: 7, role: 'Leader', guild_code: 'MYGUILD' }
        })
        setupFromResults({
          'guild_config.select': { data: existingGuild, error: null },
          'player_mapping.select': {
            data: {
              id: 7,
              user_id: 'user-1',
              guild_code: 'MYGUILD',
              cluster_id: null,
              cluster_code: null,
              role: 'Leader',
              is_current: true
            },
            error: null
          }
        })

        const res = await POST(makePostRequest(existingGuildBody))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.action).toBe('guild_joined')
        expect(serviceUpdateFilters).toContainEqual(['role', 'Leader'])
        expect(serviceUpdateFilters).not.toContainEqual(['role', 'leader'])
      })

      it('bypasses stale cached identity and authorizes from fresh rows', async () => {
        mockGuildConfigServiceFindByCodeOrTag.mockResolvedValue({
          id: 999,
          guild_code: 'STALE_GUILD',
          guild_id: 'stale-id'
        })
        setupFromResults({
          'guild_config.select': { data: existingGuild, error: null }
        })

        const res = await POST(makePostRequest(existingGuildBody))

        expect(res.status).toBe(200)
        expect(mockGuildConfigServiceFindByCodeOrTag).not.toHaveBeenCalled()
        expect(serviceUpdateFilters).toEqual([
          ['id', 42],
          ['guild_code', 'MYGUILD'],
          ['guild_id', 'guild-id-1'],
          ['cluster_id', null],
          ['cluster_code', null],
          ['is_cluster', false],
          ['id', 7],
          ['user_id', 'user-1'],
          ['is_current', true],
          ['role', 'leader'],
          ['guild_code', 'MYGUILD'],
          ['cluster_id', null],
          ['cluster_code', null]
        ])
      })

      it('returns 400 when API key validation fails', async () => {
        setupFromResults({
          'guild_config.select': { data: existingGuild, error: null }
        })
        mockValidateApiKeyWithTacticus.mockResolvedValue({
          isValid: false,
          error: 'raw upstream permission detail'
        })

        const bodyWithKey = {
          ...validBody,
          guildData: { ...validBody.guildData, apiKey: 'bad-key' }
        }
        const res = await POST(makePostRequest(bodyWithKey))
        const body = await res.json()
        expect(res.status).toBe(400)
        expect(body.code).toBe('CLUSTER_JOIN_API_KEY_INVALID')
        expect(JSON.stringify(body)).not.toContain('raw upstream')
      })

      it('does not attach a valid API key from a different guild', async () => {
        setupFromResults({
          'guild_config.select': { data: existingGuild, error: null }
        })
        mockValidateApiKeyWithTacticus.mockResolvedValue({
          isValid: true,
          guildInfo: { guildCode: 'OTHERGUILD', guildId: 'other-guild-id' }
        })

        const res = await POST(
          makePostRequest({
            ...validBody,
            guildData: { ...validBody.guildData, apiKey: 'other-key' }
          })
        )

        expect(res.status).toBe(400)
        expect(serviceUpdates).not.toContainEqual(
          expect.objectContaining({ table: 'guild_config' })
        )
      })

      it('rejects an existing row when immutable guild IDs are missing', async () => {
        mockValidateApiKeyWithTacticus.mockResolvedValue({
          isValid: true,
          guildInfo: { guildCode: 'CURRENTTAG' }
        })
        setupFromResults({
          'player_mapping.select': {
            data: {
              id: 7,
              user_id: 'user-1',
              guild_code: 'LEGACYCODE',
              role: 'leader',
              is_current: true
            },
            error: null
          },
          'guild_config.select': {
            data: {
              id: 43,
              guild_code: 'LEGACYCODE',
              guild_tag: 'CURRENTTAG',
              guild_id: null
            },
            error: null
          }
        })

        const res = await POST(
          makePostRequest({
            ...validBody,
            guildData: {
              ...validBody.guildData,
              guildCode: 'CURRENTTAG',
              apiKey: 'matching-key'
            }
          })
        )

        expect(res.status).toBe(400)
        expect(serviceUpdates).not.toContainEqual(
          expect.objectContaining({ table: 'guild_config' })
        )
      })

      it('rejects a claimed foreign guild even when the API key matches', async () => {
        const existingGuildId = '11111111-1111-1111-1111-111111111111'
        setupFromResults({
          'player_mapping.select': {
            data: {
              id: 7,
              user_id: 'user-1',
              guild_code: 'OTHERGUILD',
              role: 'leader',
              is_current: true
            },
            error: null
          },
          'guild_config.select': {
            data: {
              id: 44,
              guild_code: existingGuildId,
              guild_tag: 'SHAREDTAG',
              guild_id: existingGuildId
            },
            error: null
          }
        })
        mockValidateApiKeyWithTacticus.mockResolvedValue({
          isValid: true,
          guildInfo: { guildCode: 'SHAREDTAG', guildId: existingGuildId }
        })

        const res = await POST(
          makePostRequest({
            ...validBody,
            guildData: {
              ...validBody.guildData,
              guildCode: 'SHAREDTAG',
              apiKey: 'matching-key'
            }
          })
        )

        expect(res.status).toBe(409)
        expect(serviceUpdates).not.toContainEqual(
          expect.objectContaining({ table: 'guild_config' })
        )
      })

      it('does not attach a same-tag key when its immutable ID differs', async () => {
        const existingGuildId = '11111111-1111-1111-1111-111111111111'
        const keyGuildId = '22222222-2222-2222-2222-222222222222'
        setupFromResults({
          'player_mapping.select': {
            data: {
              id: 7,
              user_id: 'user-1',
              guild_code: existingGuildId,
              role: 'leader',
              is_current: true
            },
            error: null
          },
          'guild_config.select': {
            data: {
              id: 45,
              guild_code: existingGuildId,
              guild_tag: 'SHAREDTAG',
              guild_id: existingGuildId
            },
            error: null
          }
        })
        mockValidateApiKeyWithTacticus.mockResolvedValue({
          isValid: true,
          guildInfo: { guildCode: 'SHAREDTAG', guildId: keyGuildId }
        })

        const res = await POST(
          makePostRequest({
            ...validBody,
            guildData: {
              ...validBody.guildData,
              guildCode: 'SHAREDTAG',
              apiKey: 'wrong-id-key'
            }
          })
        )

        expect(res.status).toBe(400)
        expect(serviceUpdates).not.toContainEqual(
          expect.objectContaining({ table: 'guild_config' })
        )
      })

      it('returns 500 when guild_config update fails', async () => {
        setupFromResults({
          'guild_config.select': { data: existingGuild, error: null },
          'guild_config.update': { error: { message: 'DB error' } }
        })

        const res = await POST(makePostRequest(existingGuildBody))
        expect(res.status).toBe(500)
      })

      it('continues when a response-lost existing-guild update reads back at target', async () => {
        setupFromResults({
          'guild_config.select': { data: existingGuild, error: null },
          'guild_config.update': {
            data: null,
            error: { message: 'raw response-lost detail' },
            status: 0
          },
          'guild_config.readback': {
            data: {
              id: 42,
              guild_code: 'MYGUILD',
              guild_id: 'guild-id-1',
              cluster_id: 'cluster-uuid-1',
              cluster_code: 'CLU',
              is_cluster: true
            },
            error: null
          }
        })

        const res = await POST(makePostRequest(existingGuildBody))
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.action).toBe('guild_joined')
        expect(JSON.stringify(body)).not.toContain('raw response-lost')
        expect(serviceReads).toContain('guild_config')
        expect(serviceUpdates).toContainEqual(
          expect.objectContaining({ table: 'player_mapping' })
        )
      })

      it('does not mutate mapping when existing-guild readback is mixed', async () => {
        setupFromResults({
          'guild_config.select': { data: existingGuild, error: null },
          'guild_config.update': {
            data: null,
            error: { message: 'raw ambiguous guild detail' },
            status: 0
          },
          'guild_config.readback': {
            data: {
              id: 42,
              guild_code: 'MYGUILD',
              guild_id: 'guild-id-1',
              cluster_id: 'different-cluster',
              cluster_code: 'OTHER',
              is_cluster: true
            },
            error: null
          }
        })

        const res = await POST(makePostRequest(existingGuildBody))
        const body = await res.json()

        expect(res.status).toBe(500)
        expect(body.code).toBe('CLUSTER_JOIN_GUILD_STATE_UNKNOWN')
        expect(JSON.stringify(body)).not.toContain('raw ambiguous')
        expect(serviceUpdates).not.toContainEqual(
          expect.objectContaining({ table: 'player_mapping' })
        )
      })

      it('fails closed when the guild authority update matches no row', async () => {
        setupFromResults({
          'guild_config.select': { data: existingGuild, error: null },
          'guild_config.update': { data: null, error: null }
        })

        const res = await POST(makePostRequest(existingGuildBody))

        expect(res.status).toBe(500)
      })

      it('restores existing guild authority when the mapping CAS fails', async () => {
        setupFromResults({
          'guild_config.select': { data: existingGuild, error: null },
          'player_mapping.update': { error: { message: 'mapping race' } }
        })

        const res = await POST(makePostRequest(existingGuildBody))
        const body = await res.json()

        expect(res.status).toBe(500)
        expect(body.code).toBe('CLUSTER_JOIN_RETRY_REQUIRED')
        expect(body.retryable).toBe(true)
        expect(
          serviceUpdates.filter((write) => write.table === 'guild_config')
        ).toEqual([
          expect.objectContaining({
            payload: expect.objectContaining({
              cluster_id: 'cluster-uuid-1',
              cluster_code: 'CLU',
              is_cluster: true
            })
          }),
          expect.objectContaining({
            payload: expect.objectContaining({
              cluster_id: null,
              cluster_code: null,
              is_cluster: false
            })
          })
        ])
        expect(serviceUpdateFilters.slice(-6)).toEqual([
          ['id', 42],
          ['guild_code', 'MYGUILD'],
          ['guild_id', 'guild-id-1'],
          ['cluster_id', 'cluster-uuid-1'],
          ['cluster_code', 'CLU'],
          ['is_cluster', true]
        ])
      })

      it('surfaces a failed existing-guild rollback as non-retryable', async () => {
        let guildUpdateAttempts = 0
        setupFromResults({
          'guild_config.select': { data: existingGuild, error: null },
          'guild_config.update': () => {
            guildUpdateAttempts += 1
            return guildUpdateAttempts === 1
              ? { error: null }
              : { error: { message: 'rollback failed' } }
          },
          'player_mapping.update': { error: { message: 'mapping race' } }
        })

        const res = await POST(makePostRequest(existingGuildBody))
        const body = await res.json()

        expect(res.status).toBe(500)
        expect(body.code).toBe('CLUSTER_JOIN_EXISTING_COMPENSATION_FAILED')
      })
    })

    describe('guild code conflict', () => {
      it('returns 409 when guild code belongs to a different guild', async () => {
        setupFromResults({
          'guild_config.select': {
            data: {
              id: 99,
              guild_code: 'OTHER_GUILD',
              guild_tag: 'OTHER_GUILD',
              guild_id: 'other-guild-id'
            },
            error: null
          }
        })

        const bodyWithOther = {
          ...validBody,
          guildData: { ...validBody.guildData, guildCode: 'OTHER_GUILD' }
        }
        const res = await POST(makePostRequest(bodyWithOther))
        expect(res.status).toBe(409)
      })
    })

    describe('new guild creation', () => {
      it('fails closed when the canonical identity lookup errors', async () => {
        mockGuildConfigServiceFindByCodeOrTag.mockResolvedValue(null)
        setupFromResults({
          'guild_config.select': {
            data: null,
            error: { message: 'lookup unavailable' }
          }
        })

        const res = await POST(makePostRequest(validBody))

        expect(res.status).toBe(500)
        expect(serviceInserts).not.toContainEqual(
          expect.objectContaining({ table: 'guild_config' })
        )
      })

      it('fails closed when a legacy map points to a missing guild', async () => {
        mockGuildConfigServiceFindByCodeOrTag.mockResolvedValue(null)
        setupFromResults({
          'guild_code_legacy_map.select': {
            data: { canonical_guild_code: 'CANONICAL-GUILD' },
            error: null
          }
        })

        const res = await POST(makePostRequest(validBody))

        expect(res.status).toBe(500)
        expect(serviceInserts).not.toContainEqual(
          expect.objectContaining({ table: 'guild_config' })
        )
      })

      it('creates guild_config row and returns guild_created', async () => {
        mockGuildConfigServiceFindByCodeOrTag.mockResolvedValue(null)

        const res = await POST(makePostRequest(validBody))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.action).toBe('guild_created')
        expect(body.guild).toBeDefined()
        expect(body.cluster.cluster_code).toBe('CLU')
        expect(sessionInserts).not.toContainEqual(
          expect.objectContaining({ table: 'guild_config' })
        )
        expect(serviceInserts).toContainEqual({
          table: 'guild_config',
          payload: expect.objectContaining({ guild_code: 'MYGUILD' })
        })
        expect(sessionUpdates).not.toContainEqual(
          expect.objectContaining({ table: 'player_mapping' })
        )
        expect(serviceUpdates).toContainEqual({
          table: 'player_mapping',
          payload: expect.objectContaining({
            guild_code: 'MYGUILD',
            cluster_id: 'cluster-uuid-1',
            cluster_code: 'CLU'
          })
        })
        expect(serviceUpdateFilters).toEqual([
          ['id', 7],
          ['user_id', 'user-1'],
          ['is_current', true],
          ['role', 'leader'],
          ['guild_code', 'MYGUILD'],
          ['cluster_id', null],
          ['cluster_code', null]
        ])
      })

      it('returns 500 when guild_config insert fails', async () => {
        mockGuildConfigServiceFindByCodeOrTag.mockResolvedValue(null)
        setupFromResults({
          'guild_config.insert': { data: null, error: { message: 'DB error' } }
        })

        const res = await POST(makePostRequest(validBody))
        expect(res.status).toBe(500)
      })

      it('continues when a response-lost new-guild insert reads back at target', async () => {
        setupFromResults({
          'guild_config.insert': {
            data: null,
            error: { message: 'raw response-lost insert detail' },
            status: 0
          },
          'guild_config.readback': {
            data: {
              id: 'g-1',
              guild_code: 'MYGUILD',
              guild_id: null,
              display_name: 'My Guild',
              cluster_id: 'cluster-uuid-1',
              cluster_code: 'CLU',
              is_cluster: true
            },
            error: null
          }
        })

        const res = await POST(makePostRequest(validBody))
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.action).toBe('guild_created')
        expect(JSON.stringify(body)).not.toContain('raw response-lost')
        expect(serviceReads).toContain('guild_config')
        expect(serviceUpdates).toContainEqual(
          expect.objectContaining({ table: 'player_mapping' })
        )
      })

      it('fails closed when the guild authority insert returns no row', async () => {
        mockGuildConfigServiceFindByCodeOrTag.mockResolvedValue(null)
        setupFromResults({
          'guild_config.insert': { data: null, error: null }
        })

        const res = await POST(makePostRequest(validBody))

        expect(res.status).toBe(500)
      })

      it('rejects a guild insert witness with mismatched target state', async () => {
        setupFromResults({
          'guild_config.insert': {
            data: {
              id: 'g-1',
              guild_code: 'MYGUILD',
              guild_id: null,
              display_name: 'My Guild',
              cluster_id: 'cluster-uuid-1',
              cluster_code: 'CLU',
              is_cluster: false
            },
            error: null
          }
        })

        const res = await POST(makePostRequest(validBody))
        const body = await res.json()

        expect(res.status).toBe(500)
        expect(body.code).toBe('CLUSTER_JOIN_GUILD_CREATE_FAILED')
        expect(serviceUpdates).not.toContainEqual(
          expect.objectContaining({ table: 'player_mapping' })
        )
      })

      it('does not elevate an unverified guild code to service authority', async () => {
        mockGuildConfigServiceFindByCodeOrTag.mockResolvedValue(null)

        const res = await POST(
          makePostRequest({
            ...validBody,
            guildData: { ...validBody.guildData, guildCode: 'OTHERGUILD' }
          })
        )

        expect(res.status).toBe(403)
        expect(serviceInserts).not.toContainEqual(
          expect.objectContaining({ table: 'guild_config' })
        )
      })

      it('does not treat two missing guild identities as ownership', async () => {
        setupFromResults({
          'player_mapping.select': {
            data: {
              id: 7,
              user_id: 'user-1',
              guild_code: null,
              role: 'leader',
              is_current: true
            },
            error: null
          }
        })

        const res = await POST(makePostRequest(validBody))

        expect(res.status).toBe(403)
        expect(serviceInserts).not.toContainEqual(
          expect.objectContaining({ table: 'guild_config' })
        )
      })

      it('canonicalizes lowercase guild codes before service insertion', async () => {
        mockGuildConfigServiceFindByCodeOrTag.mockResolvedValue(null)

        const res = await POST(
          makePostRequest({
            ...validBody,
            guildData: { ...validBody.guildData, guildCode: 'myguild' }
          })
        )

        expect(res.status).toBe(200)
        expect(serviceInserts).toContainEqual({
          table: 'guild_config',
          payload: expect.objectContaining({ guild_code: 'MYGUILD' })
        })
      })

      it('does not let an API key replace current-mapping authority', async () => {
        mockValidateApiKeyWithTacticus.mockResolvedValue({
          isValid: true,
          guildInfo: { guildCode: 'OTHERGUILD' }
        })

        const res = await POST(
          makePostRequest({
            ...validBody,
            guildData: {
              ...validBody.guildData,
              guildCode: 'OTHERGUILD',
              apiKey: 'matching-key'
            }
          })
        )

        expect(res.status).toBe(403)
        expect(serviceInserts).not.toContainEqual(
          expect.objectContaining({ table: 'guild_config' })
        )
      })

      it('fails closed when the privileged membership update fails', async () => {
        mockGuildConfigServiceFindByCodeOrTag.mockResolvedValue(null)
        setupFromResults({
          'player_mapping.update': {
            error: { message: 'raw postgres secret', status: 0 }
          }
        })

        const res = await POST(makePostRequest(validBody))
        const body = await res.json()
        expect(res.status).toBe(500)
        expect(JSON.stringify(body)).not.toContain('raw postgres secret')
        expect(body.code).toBe('CLUSTER_JOIN_RETRY_REQUIRED')
        expect(serviceReads).toEqual(['player_mapping'])
        expect(serviceReadFilters).toEqual([
          ['id', 7],
          ['user_id', 'user-1']
        ])
        expect(serviceDeletes).toEqual(['guild_config'])
        expect(serviceDeleteFilters).toEqual([
          ['id', 'g-1'],
          ['guild_code', 'MYGUILD'],
          ['cluster_id', 'cluster-uuid-1'],
          ['cluster_code', 'CLU'],
          ['is_cluster', true],
          ['guild_id', null]
        ])
      })

      it('fails closed when the privileged update matches no profile row', async () => {
        mockGuildConfigServiceFindByCodeOrTag.mockResolvedValue(null)
        setupFromResults({
          'player_mapping.update': { data: null, error: null }
        })

        const res = await POST(makePostRequest(validBody))
        expect(res.status).toBe(500)
        expect(serviceDeletes).toEqual(['guild_config'])
      })

      it('treats a response-lost mapping write as committed when readback is target', async () => {
        setupFromResults({
          'player_mapping.update': () => {
            throw new Error('raw upstream response-lost detail')
          },
          'player_mapping.readback': {
            data: {
              id: 7,
              user_id: 'user-1',
              guild_code: 'MYGUILD',
              cluster_id: 'cluster-uuid-1',
              cluster_code: 'CLU',
              role: 'leader',
              is_current: true
            },
            error: null
          }
        })

        const res = await POST(makePostRequest(validBody))
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.action).toBe('guild_created')
        expect(JSON.stringify(body)).not.toContain('raw upstream')
        expect(serviceReads).toEqual(['player_mapping'])
        expect(serviceReadFilters).toEqual([
          ['id', 7],
          ['user_id', 'user-1']
        ])
        expect(serviceDeletes).toEqual([])
      })

      it('leaves guild state untouched when mapping readback is mixed', async () => {
        setupFromResults({
          'player_mapping.update': {
            error: { message: 'raw ambiguous database detail', status: 0 }
          },
          'player_mapping.readback': {
            data: {
              id: 7,
              user_id: 'user-1',
              guild_code: 'MYGUILD',
              cluster_id: 'different-cluster-id',
              cluster_code: 'CLU',
              role: 'leader',
              is_current: true
            },
            error: null
          }
        })

        const res = await POST(makePostRequest(validBody))
        const body = await res.json()

        expect(res.status).toBe(500)
        expect(body.code).toBe('CLUSTER_JOIN_MAPPING_STATE_UNKNOWN')
        expect(JSON.stringify(body)).not.toContain('raw ambiguous')
        expect(serviceReads).toEqual(['player_mapping'])
        expect(serviceDeletes).toEqual([])
      })

      it('compensates when the membership write returns stale cluster state', async () => {
        setupFromResults({
          'player_mapping.update': {
            data: {
              id: 7,
              user_id: 'user-1',
              guild_code: 'MYGUILD',
              cluster_id: 'stale-cluster-id',
              cluster_code: 'STALE'
            },
            error: null
          }
        })

        const res = await POST(makePostRequest(validBody))
        const body = await res.json()

        expect(res.status).toBe(500)
        expect(body.code).toBe('CLUSTER_JOIN_RETRY_REQUIRED')
        expect(serviceDeletes).toEqual(['guild_config'])
      })

      it('surfaces an uncompensated partial write as non-retryable', async () => {
        setupFromResults({
          'player_mapping.update': { error: { message: 'mapping error' } },
          'guild_config.delete': { error: { message: 'cleanup error' } }
        })

        const res = await POST(makePostRequest(validBody))
        const body = await res.json()

        expect(res.status).toBe(500)
        expect(body.code).toBe('CLUSTER_JOIN_COMPENSATION_FAILED')
        expect(serviceDeletes).toEqual(['guild_config'])
      })

      it('cleans the inserted guild and allows a safe retry', async () => {
        let mappingAttempts = 0
        setupFromResults({
          'player_mapping.update': () => {
            mappingAttempts += 1
            return mappingAttempts === 1
              ? { error: { message: 'mapping race' } }
              : {
                  data: {
                    id: 7,
                    user_id: 'user-1',
                    guild_code: 'MYGUILD',
                    cluster_id: 'cluster-uuid-1',
                    cluster_code: 'CLU',
                    role: 'leader',
                    is_current: true
                  },
                  error: null
                }
          }
        })

        const first = await POST(makePostRequest(validBody))
        const firstBody = await first.json()
        const second = await POST(makePostRequest(validBody))

        expect(first.status).toBe(500)
        expect(firstBody.code).toBe('CLUSTER_JOIN_RETRY_REQUIRED')
        expect(second.status).toBe(200)
        expect(serviceDeletes).toEqual(['guild_config'])
        expect(
          serviceInserts.filter((write) => write.table === 'guild_config')
        ).toHaveLength(2)
      })
    })
  })

  describe('GET /api/clusters/join', () => {
    // Without auth this handler is an oracle for live cluster invite codes.
    describe('authorization', () => {
      it('refuses an unauthenticated caller before any code lookup happens', async () => {
        const { NextResponse } = await import('next/server')
        mockApiSecurityMiddleware.mockResolvedValue(
          NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        )

        const res = await GET(makeGetRequest({ invite_code: 'VALID' }))

        expect(res.status).toBe(401)
        expect(mockValidateInviteCode).not.toHaveBeenCalled()
      })

      it('demands a session', async () => {
        await GET(makeGetRequest({ invite_code: 'VALID' }))

        expect(mockApiSecurityMiddleware).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ requireAuth: true })
        )
      })
    })

    describe('validation', () => {
      it('returns 400 when invite_code is missing', async () => {
        const res = await GET(makeGetRequest())
        expect(res.status).toBe(400)
      })
    })

    describe('invalid code', () => {
      it('returns 200 with valid:false for invalid invite code', async () => {
        mockValidateInviteCode.mockResolvedValue({
          valid: false,
          cluster: null,
          error: 'Code not found'
        })
        const res = await GET(makeGetRequest({ invite_code: 'BAD' }))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.valid).toBe(false)
      })
    })

    describe('valid code', () => {
      it('returns 200 with cluster info for valid invite code', async () => {
        const res = await GET(makeGetRequest({ invite_code: 'VALID' }))
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.valid).toBe(true)
        expect(body.cluster.cluster_code).toBe('CLU')
        expect(body.cluster.display_name).toBe('Test Cluster')
        expect(body.cluster.max_guilds).toBe(5)
      })
    })
  })
})
