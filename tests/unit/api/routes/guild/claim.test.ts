import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// A valid key for a different guild than guild_code must be rejected with 400 and never write.

let mockDb: ReturnType<typeof vi.fn>
let mockServiceDb: ReturnType<typeof vi.fn>
let mockEncryptApiKey: ReturnType<typeof vi.fn>
let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>
let mockGenerateApiKeyUpdatePayload: ReturnType<typeof vi.fn>
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>
let mockResolveVerifiedPlayers: ReturnType<typeof vi.fn>

describe('POST /api/guild/claim', () => {
  let POST: (req: NextRequest) => Promise<Response>

  let mockAuthSupabase: { auth: { getUser: ReturnType<typeof vi.fn> } }
  let guildUpdateSpy: ReturnType<typeof vi.fn>

  const buildServiceClient = ({
    existingGuild = {
      guild_code: 'AAAA',
      display_name: 'Alpha',
      cluster_code: 'OLD',
      cluster_id: 'old-id',
      enabled: true,
      api_key_is_valid: true
    } as Record<string, unknown> | null,
    guildLookupError = null as unknown,
    claimTargetGuildId = 'guild-uuid-AAAA' as string | null,
    cluster = { id: 'cluster-uuid', created_by: 'user-123' } as Record<
      string,
      unknown
    > | null,
    clusterError = null as unknown,
    inClusterGuilds = [] as Array<Record<string, unknown>>,
    clusterMembershipError = null as unknown,
    updateError = null as unknown
  } = {}) => {
    guildUpdateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: updateError })
    })
    let guildConfigCall = 0
    return {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'guild_config') {
          guildConfigCall++
          if (guildConfigCall === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              ilike: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: existingGuild,
                error: guildLookupError
              })
            }
          }
          if (guildConfigCall === 2) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: claimTargetGuildId
                  ? { guild_id: claimTargetGuildId }
                  : null,
                error: null
              })
            }
          }
          // A non-owner leader does a cluster-membership lookup before the write.
          const membershipChain = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: inClusterGuilds,
              error: clusterMembershipError
            }),
            update: guildUpdateSpy
          }
          return membershipChain
        }
        if (table === 'clusters') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: cluster, error: clusterError })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })
    }
  }

  beforeEach(async () => {
    vi.resetModules()
    mockDb = vi.fn()
    mockServiceDb = vi.fn()
    mockEncryptApiKey = vi.fn().mockResolvedValue('encrypted-key')
    mockValidateApiKeyWithTacticus = vi.fn()
    mockGenerateApiKeyUpdatePayload = vi
      .fn()
      .mockReturnValue({ api_key_encrypted: 'encrypted-key' })
    mockApiSecurityMiddleware = vi.fn().mockResolvedValue(null)
    mockResolveVerifiedPlayers = vi.fn().mockResolvedValue([
      {
        mappingId: 42,
        playerId: 'player-42',
        userId: 'user-123',
        guildCode: 'AAAA',
        role: 'officer',
        isAppAdmin: false,
        ownershipAttestationId: '22222222-2222-4222-8222-222222222222'
      }
    ])

    vi.doMock('@/app/lib/db', () => ({
      db: mockDb,
      serviceDb: mockServiceDb
    }))
    vi.doMock('@tacticus/app-core/encryption', () => ({
      encryptApiKey: mockEncryptApiKey
    }))
    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus,
      generateApiKeyUpdatePayload: mockGenerateApiKeyUpdatePayload
    }))
    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))
    vi.doMock('@/app/lib/auth/verified-player-authority', () => ({
      resolveVerifiedPlayers: mockResolveVerifiedPlayers
    }))

    mockAuthSupabase = {
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'user-123' } } })
      }
    }
    mockDb.mockResolvedValue(mockAuthSupabase)
    mockServiceDb.mockReturnValue(buildServiceClient())

    const mod = await import('@/app/api/guild/claim/route')
    POST = mod.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const makeRequest = (body: unknown) =>
    new NextRequest('http://localhost/api/guild/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

  const validBody = {
    guild_code: 'AAAA',
    api_key: 'valid-key',
    cluster_code: 'NEW'
  }

  const verifiedPlayer = (
    overrides: Partial<{
      guildCode: string | null
      role: string | null
      isAppAdmin: boolean
    }> = {}
  ) => ({
    mappingId: 42,
    playerId: 'player-42',
    userId: 'user-123',
    guildCode: 'VAE1',
    role: 'member',
    isAppAdmin: false,
    ownershipAttestationId: '22222222-2222-4222-8222-222222222222',
    ...overrides
  })

  it('returns rate-limit/middleware response when middleware blocks', async () => {
    mockApiSecurityMiddleware.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })
    )
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(429)
  })

  it('returns 401 when unauthenticated (no user)', async () => {
    mockAuthSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(401)
    expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
  })

  it('returns 400 when guild_code is missing', async () => {
    const res = await POST(makeRequest({ api_key: 'k', cluster_code: 'NEW' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when api_key is missing', async () => {
    const res = await POST(
      makeRequest({ guild_code: 'AAAA', cluster_code: 'NEW' })
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when cluster_code is missing', async () => {
    const res = await POST(makeRequest({ guild_code: 'AAAA', api_key: 'k' }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the guild does not exist', async () => {
    mockServiceDb.mockReturnValue(buildServiceClient({ existingGuild: null }))
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(404)
  })

  it('CONSENT-MISMATCH: rejects when a valid key resolves to a DIFFERENT guild, and never writes', async () => {
    // Refused, or guild Z's members could hijack guild A.
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: true,
      guildInfo: {
        guildId: 'guild-uuid-ZZZZ',
        guildName: 'Zeta',
        guildCode: 'ZZ'
      }
    })
    mockServiceDb.mockReturnValue(
      buildServiceClient({ claimTargetGuildId: 'guild-uuid-AAAA' })
    )

    const res = await POST(makeRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.message).toContain('different guild')
    expect(guildUpdateSpy).not.toHaveBeenCalled()
    expect(mockEncryptApiKey).not.toHaveBeenCalled()
  })

  it('returns 400 when the key is invalid', async () => {
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: false,
      error: 'expired'
    })
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(400)
    expect(guildUpdateSpy).not.toHaveBeenCalled()
  })

  // Covered in both directions so deleting the gate cannot pass.
  describe('PS-593 validated-key cluster-admin consent', () => {
    const clusterAdminNotGuildOfficer = () =>
      mockResolveVerifiedPlayers.mockResolvedValue([
        verifiedPlayer({ guildCode: 'VAE1', role: 'member' })
      ])

    const keyResolvesTo = (guildId: string, guildName = 'Alpha') =>
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildId, guildName, guildCode: 'AA' }
      })

    it('ALLOWS a cluster admin with a key validated for the target guild, though they hold no seat in it', async () => {
      clusterAdminNotGuildOfficer()
      keyResolvesTo('guild-uuid-AAAA')
      // The guild belongs to no cluster yet: this adds, not moves.
      mockServiceDb.mockReturnValue(
        buildServiceClient({
          existingGuild: {
            guild_code: 'AAAA',
            display_name: 'Alpha',
            cluster_code: null,
            cluster_id: null,
            enabled: true,
            api_key_is_valid: true
          },
          claimTargetGuildId: 'guild-uuid-AAAA'
        })
      )

      const res = await POST(makeRequest(validBody))

      expect(res.status).toBe(200)
      // A 200 with no write would claim nothing.
      expect(guildUpdateSpy).toHaveBeenCalled()
      expect(mockValidateApiKeyWithTacticus).toHaveBeenCalled()
    })

    it('REFUSES when the key is valid but belongs to a DIFFERENT guild', async () => {
      clusterAdminNotGuildOfficer()
      keyResolvesTo('guild-uuid-SOMEONE-ELSE', 'Beta')
      mockServiceDb.mockReturnValue(
        buildServiceClient({
          existingGuild: {
            guild_code: 'AAAA',
            display_name: 'Alpha',
            cluster_code: null,
            cluster_id: null,
            enabled: true,
            api_key_is_valid: true
          },
          claimTargetGuildId: 'guild-uuid-AAAA'
        })
      )

      const res = await POST(makeRequest(validBody))

      expect(res.status).toBe(400)
      expect(guildUpdateSpy).not.toHaveBeenCalled()
    })

    it('REFUSES when the key does not validate at all', async () => {
      clusterAdminNotGuildOfficer()
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'The API key is invalid or expired'
      })
      mockServiceDb.mockReturnValue(
        buildServiceClient({
          existingGuild: {
            guild_code: 'AAAA',
            display_name: 'Alpha',
            cluster_code: null,
            cluster_id: null,
            enabled: true,
            api_key_is_valid: true
          },
          claimTargetGuildId: 'guild-uuid-AAAA'
        })
      )

      const res = await POST(makeRequest(validBody))

      expect(res.status).toBe(400)
      expect(guildUpdateSpy).not.toHaveBeenCalled()
    })

    it('REFUSES with 409 when the target guild already belongs to ANOTHER cluster, rather than moving it', async () => {
      clusterAdminNotGuildOfficer()
      keyResolvesTo('guild-uuid-AAAA')
      // A validated key must not pull a guild out of someone else's cluster.
      mockServiceDb.mockReturnValue(
        buildServiceClient({ claimTargetGuildId: 'guild-uuid-AAAA' })
      )

      const res = await POST(makeRequest(validBody))
      const body = await res.json()

      expect(res.status).toBe(409)
      expect(body.error.message).toContain('already belongs to cluster')
      expect(guildUpdateSpy).not.toHaveBeenCalled()
    })

    it('REFUSES a caller who has neither guild authority nor cluster authority, naming both paths', async () => {
      clusterAdminNotGuildOfficer()
      keyResolvesTo('guild-uuid-AAAA')
      mockServiceDb.mockReturnValue(
        buildServiceClient({
          existingGuild: {
            guild_code: 'AAAA',
            display_name: 'Alpha',
            cluster_code: null,
            cluster_id: null,
            enabled: true,
            api_key_is_valid: true
          },
          claimTargetGuildId: 'guild-uuid-AAAA',
          cluster: { id: 'cluster-uuid', created_by: 'a-different-owner' }
        })
      )

      const res = await POST(makeRequest(validBody))
      const body = await res.json()

      expect(res.status).toBe(403)
      expect(body.error.message).toContain('officer or leader')
      expect(guildUpdateSpy).not.toHaveBeenCalled()
    })
  })

  it('returns 403 when the caller does not own the target cluster', async () => {
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: true,
      guildInfo: {
        guildId: 'guild-uuid-AAAA',
        guildName: 'Alpha',
        guildCode: 'AA'
      }
    })
    mockServiceDb.mockReturnValue(
      buildServiceClient({
        claimTargetGuildId: 'guild-uuid-AAAA',
        cluster: { id: 'cluster-uuid', created_by: 'a-different-owner' }
      })
    )
    const res = await POST(makeRequest(validBody))
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.error.message).toContain('permission')
    expect(guildUpdateSpy).not.toHaveBeenCalled()
    expect(mockResolveVerifiedPlayers).toHaveBeenCalledWith(expect.anything(), [
      'user-123'
    ])
  })

  it('fails closed when raw current mapping authority has no immutable proof', async () => {
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: true,
      guildInfo: {
        guildId: 'guild-uuid-AAAA',
        guildName: 'Alpha',
        guildCode: 'AA'
      }
    })
    mockServiceDb.mockReturnValue(
      buildServiceClient({
        claimTargetGuildId: 'guild-uuid-AAAA',
        cluster: { id: 'cluster-uuid', created_by: 'a-different-owner' }
      })
    )
    mockResolveVerifiedPlayers.mockResolvedValue([])

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(403)
    expect(guildUpdateSpy).not.toHaveBeenCalled()
  })

  it('succeeds for a current guild leader in the target cluster', async () => {
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: true,
      guildInfo: {
        guildId: 'guild-uuid-AAAA',
        guildName: 'Alpha',
        guildCode: 'AA'
      }
    })
    mockServiceDb.mockReturnValue(
      buildServiceClient({
        claimTargetGuildId: 'guild-uuid-AAAA',
        cluster: { id: 'cluster-uuid', created_by: 'a-different-owner' },
        inClusterGuilds: [{ guild_code: 'VAE1' }]
      })
    )
    mockResolveVerifiedPlayers.mockResolvedValue([
      verifiedPlayer({ guildCode: 'AAAA', role: 'officer' }),
      verifiedPlayer({ guildCode: 'VAE1', role: 'leader' })
    ])

    const res = await POST(makeRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(guildUpdateSpy).toHaveBeenCalledTimes(1)
  })

  it('accepts the legacy Leader enum value for cluster authority', async () => {
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: true,
      guildInfo: {
        guildId: 'guild-uuid-AAAA',
        guildName: 'Alpha',
        guildCode: 'AA'
      }
    })
    mockServiceDb.mockReturnValue(
      buildServiceClient({
        claimTargetGuildId: 'guild-uuid-AAAA',
        cluster: { id: 'cluster-uuid', created_by: 'a-different-owner' },
        inClusterGuilds: [{ guild_code: 'VAE1' }]
      })
    )
    mockResolveVerifiedPlayers.mockResolvedValue([
      verifiedPlayer({ guildCode: 'AAAA', role: 'officer' }),
      verifiedPlayer({ guildCode: 'VAE1', role: 'Leader' })
    ])

    const res = await POST(makeRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(guildUpdateSpy).toHaveBeenCalledTimes(1)
  })

  it('returns 403 for a leader whose guild is outside the target cluster', async () => {
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: true,
      guildInfo: {
        guildId: 'guild-uuid-AAAA',
        guildName: 'Alpha',
        guildCode: 'AA'
      }
    })
    mockServiceDb.mockReturnValue(
      buildServiceClient({
        claimTargetGuildId: 'guild-uuid-AAAA',
        cluster: { id: 'cluster-uuid', created_by: 'a-different-owner' },
        inClusterGuilds: []
      })
    )
    mockResolveVerifiedPlayers.mockResolvedValue([
      verifiedPlayer({ guildCode: 'AAAA', role: 'officer' }),
      verifiedPlayer({ guildCode: 'OUTSIDE', role: 'leader' })
    ])

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(403)
    expect(guildUpdateSpy).not.toHaveBeenCalled()
  })

  it('succeeds for a current app admin', async () => {
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: true,
      guildInfo: {
        guildId: 'guild-uuid-AAAA',
        guildName: 'Alpha',
        guildCode: 'AA'
      }
    })
    mockServiceDb.mockReturnValue(
      buildServiceClient({
        claimTargetGuildId: 'guild-uuid-AAAA',
        cluster: { id: 'cluster-uuid', created_by: 'a-different-owner' }
      })
    )
    mockResolveVerifiedPlayers.mockResolvedValue([
      verifiedPlayer({ guildCode: null, isAppAdmin: true })
    ])

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(200)
    expect(guildUpdateSpy).toHaveBeenCalledTimes(1)
  })

  it('succeeds when the key matches the guild and the caller owns the cluster', async () => {
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: true,
      guildInfo: {
        guildId: 'guild-uuid-AAAA',
        guildName: 'Alpha',
        guildCode: 'AA'
      }
    })
    mockServiceDb.mockReturnValue(
      buildServiceClient({
        claimTargetGuildId: 'guild-uuid-AAAA',
        cluster: { id: 'cluster-uuid', created_by: 'user-123' }
      })
    )
    const res = await POST(makeRequest(validBody))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.new_cluster).toBe('NEW')
    expect(guildUpdateSpy).toHaveBeenCalledTimes(1)
  })
})
