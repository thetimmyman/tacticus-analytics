import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireRoleForApi: vi.fn(),
  db: vi.fn(),
  serviceDb: vi.fn()
}))

vi.mock('@/app/lib/auth', () => ({
  requireRoleForApi: mocks.requireRoleForApi
}))

vi.mock('@/app/lib/db', () => ({
  db: mocks.db,
  serviceDb: mocks.serviceDb
}))

function playerQuery(data: Record<string, unknown>[]) {
  const result = { data, error: null }
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject)
  }
  return query
}

describe('GET /api/discord/verified-members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRoleForApi.mockResolvedValue({
      profile: { guild_code: 'TEST' }
    })
  })

  it('rejects a guild outside the caller cluster before using the service client', async () => {
    const callerRpc = vi.fn().mockResolvedValue({
      data: ['TEST', 'PEER'],
      error: null
    })
    mocks.db.mockResolvedValue({ rpc: callerRpc })
    const { GET } = await import('@/app/api/discord/verified-members/route')

    const response = await GET(
      new NextRequest(
        'http://localhost/api/discord/verified-members?guild_code=OTHER'
      )
    )

    expect(response.status).toBe(403)
    expect(callerRpc).toHaveBeenCalledWith('_pm_caller_cluster_guild_codes')
    expect(mocks.serviceDb).not.toHaveBeenCalled()
  })

  it('serves a requested guild admitted by the caller cluster predicate', async () => {
    const callerRpc = vi.fn().mockResolvedValue({
      data: ['TEST', 'OTHER'],
      error: null
    })
    mocks.db.mockResolvedValue({ rpc: callerRpc })
    const query = playerQuery([])
    const service = {
      from: vi.fn().mockReturnValue(query),
      rpc: vi.fn()
    }
    mocks.serviceDb.mockReturnValue(service)
    const { GET } = await import('@/app/api/discord/verified-members/route')

    const response = await GET(
      new NextRequest(
        'http://localhost/api/discord/verified-members?guild_code=other'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ members: [] })
    expect(callerRpc).toHaveBeenCalledWith('_pm_caller_cluster_guild_codes')
    expect(query.eq).toHaveBeenCalledWith('guild_code', 'OTHER')
  })

  it('fails closed when caller cluster authorization cannot be verified', async () => {
    mocks.db.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'scope unavailable' }
      })
    })
    const { GET } = await import('@/app/api/discord/verified-members/route')

    const response = await GET(
      new NextRequest(
        'http://localhost/api/discord/verified-members?guild_code=OTHER'
      )
    )

    expect(response.status).toBe(500)
    expect(mocks.serviceDb).not.toHaveBeenCalled()
  })

  it('returns only the exact mapping proven by the canonical resolver', async () => {
    const discordUserId = '700000000000000007'
    const query = playerQuery([
      {
        id: 1,
        user_id: 'user-1',
        player_id: 'player-1',
        guild_code: 'TEST',
        display_name: 'Verified',
        discord_username: 'verified',
        discord_user_id: discordUserId
      },
      {
        id: 2,
        user_id: 'user-2',
        player_id: 'player-2',
        guild_code: 'TEST',
        display_name: 'Unverified duplicate',
        discord_username: 'candidate-only',
        discord_user_id: discordUserId
      }
    ])
    const service = {
      from: vi.fn().mockReturnValue(query),
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            mapping_id: 1,
            player_id: 'player-1',
            user_id: 'user-1',
            guild_code: 'TEST',
            role: 'member',
            is_app_admin: false,
            ownership_attestation_id: 'attestation-1',
            discord_user_id: discordUserId
          }
        ],
        error: null
      })
    }
    mocks.serviceDb.mockReturnValue(service)
    const { GET } = await import('@/app/api/discord/verified-members/route')

    const response = await GET(
      new NextRequest(
        'http://localhost/api/discord/verified-members?guild_code=test'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      members: [
        {
          display_name: 'Verified',
          discord_username: 'verified',
          discord_user_id: discordUserId
        }
      ]
    })
    expect(service.rpc).toHaveBeenCalledWith(
      'resolve_verified_discord_identities',
      { p_discord_user_ids: [discordUserId] }
    )
    expect(mocks.db).not.toHaveBeenCalled()
    expect(query.eq).toHaveBeenCalledWith('guild_code', 'TEST')
    expect(query.eq).toHaveBeenCalledWith('is_current', true)
  })

  it('preserves canonical lowercase UUID guild identifiers', async () => {
    const guildCode = 'b4b99293-1241-4f28-a870-70624037e03f'
    mocks.requireRoleForApi.mockResolvedValue({
      profile: { guild_code: guildCode }
    })
    const query = playerQuery([])
    const service = {
      from: vi.fn().mockReturnValue(query),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null })
    }
    mocks.serviceDb.mockReturnValue(service)
    const { GET } = await import('@/app/api/discord/verified-members/route')

    const response = await GET(
      new NextRequest(
        `http://localhost/api/discord/verified-members?guild_code=${guildCode.toUpperCase()}`
      )
    )

    expect(response.status).toBe(200)
    expect(query.eq).toHaveBeenCalledWith('guild_code', guildCode)
  })
})
