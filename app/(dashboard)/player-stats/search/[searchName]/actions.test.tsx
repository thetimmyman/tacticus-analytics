// `is_app_admin` bypasses cluster scoping; others are blocked cross-cluster, allowed same-cluster.
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))

const { rpcMock, serviceRpcMock, serviceFromMock, serviceDbMock } = vi.hoisted(
  () => {
    const serviceRpc = vi.fn()
    const serviceFrom = vi.fn()
    return {
      rpcMock: vi.fn(),
      serviceRpcMock: serviceRpc,
      serviceFromMock: serviceFrom,
      serviceDbMock: vi.fn(() => ({ rpc: serviceRpc, from: serviceFrom }))
    }
  }
)
const maybeSingleQueue: Array<{ data: unknown; error: unknown }> = []
const queryLog: Array<{ filters: Array<[string, unknown]> }> = []
let authorizationHistoryRows:
  Array<ProfileRow & { is_current: boolean }> | undefined

function chainableQuery() {
  const chain: Record<string, unknown> = {}
  const filters: Array<[string, unknown]> = []
  let projection: string | undefined
  chain.select = vi.fn((selected: string) => {
    projection = selected
    return chain
  })
  chain.eq = vi.fn((column: string, value: string | boolean) => {
    filters.push([column, value])
    return chain
  })
  chain.maybeSingle = vi.fn(async () => {
    if (
      authorizationHistoryRows !== undefined &&
      projection === 'cluster_code, guild_code, role, is_app_admin'
    ) {
      const matchingRow = authorizationHistoryRows.find((row) =>
        filters.every(
          ([column, value]) =>
            (row as unknown as Record<string, unknown>)[column] === value
        )
      )
      if (!matchingRow) {
        return { data: null, error: null }
      }
      const { is_current: _isCurrent, ...profile } = matchingRow
      return { data: profile, error: null }
    }
    return maybeSingleQueue.shift() ?? { data: null, error: null }
  })
  queryLog.push({ filters })
  return chain
}

const supabaseMock = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } }))
  },
  from: vi.fn(() => chainableQuery()),
  rpc: rpcMock
}

vi.mock('@/app/lib/db', () => ({
  db: vi.fn(async () => supabaseMock),
  serviceDb: serviceDbMock
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

const CLUSTER_BY_GUILD: Record<string, string> = {
  'MY-GUILD': 'CL-A',
  'SAME-CLUSTER-GUILD': 'CL-A',
  'OTHER-GUILD': 'CL-B'
}

vi.mock('@/app/lib/services/guild-config-service', () => ({
  GuildConfigService: {
    getBasic: vi.fn(async (_client: unknown, guildCode: string) => {
      const cluster = CLUSTER_BY_GUILD[guildCode]
      if (!cluster) return null
      return {
        guild_code: guildCode,
        display_name: guildCode,
        cluster_code: cluster
      }
    })
  }
}))

import { fetchPlayerStats } from '@/app/(dashboard)/player-stats/search/[searchName]/actions'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'

type ProfileRow = {
  cluster_code: string | null
  guild_code: string | null
  role: string | null
  is_app_admin: boolean | null
}

function primeProfile(profile: ProfileRow | null) {
  // First maybeSingle() = authorization lookup; second = player mapping.
  maybeSingleQueue.push({ data: profile, error: null })
  maybeSingleQueue.push({ data: null, error: null })
}

function expectCurrentMembershipQuery() {
  expect(supabaseMock.from).toHaveBeenNthCalledWith(1, 'player_mapping')
  expect(queryLog[0]?.filters).toEqual([
    ['user_id', 'user-1'],
    ['is_current', true]
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  maybeSingleQueue.length = 0
  queryLog.length = 0
  authorizationHistoryRows = undefined
  serviceFromMock.mockImplementation(() => chainableQuery())
  rpcMock.mockResolvedValue({
    data: null,
    error: null
  })
  serviceRpcMock.mockResolvedValue({
    data: { totalDamage: 123 },
    error: null
  })
})

describe('fetchPlayerStats admin gate (F14)', () => {
  it('blocks an unauthenticated caller before any membership or stats read', async () => {
    supabaseMock.auth.getUser.mockResolvedValueOnce({
      data: { user: null }
    } as never)

    const result = await fetchPlayerStats('SomePlayer', 'OTHER-GUILD', '104')

    expect(result).toEqual({
      stats: null,
      context: null,
      error: 'Unauthorized'
    })
    expect(supabaseMock.from).not.toHaveBeenCalled()
    expect(GuildConfigService.getBasic).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(serviceDbMock).not.toHaveBeenCalled()
  })

  it('fails closed when the current membership lookup errors', async () => {
    maybeSingleQueue.push({
      data: null,
      error: { message: 'database detail that must not escape' }
    })

    const result = await fetchPlayerStats('SomePlayer', 'OTHER-GUILD', '104')

    expect(result).toEqual({
      stats: null,
      context: null,
      error: 'Authorization check failed.'
    })
    expect(supabaseMock.from).toHaveBeenCalledTimes(1)
    expectCurrentMembershipQuery()
    expect(GuildConfigService.getBasic).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(serviceDbMock).not.toHaveBeenCalled()
  })

  it('fails closed when the authenticated caller has no current mapping', async () => {
    maybeSingleQueue.push({ data: null, error: null })

    const result = await fetchPlayerStats('SomePlayer', 'OTHER-GUILD', '104')

    expect(result.stats).toBeNull()
    expect(result.error).toBe(
      'You are not authorized to view stats for this guild.'
    )
    expect(supabaseMock.from).toHaveBeenCalledTimes(1)
    expectCurrentMembershipQuery()
    expect(GuildConfigService.getBasic).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(serviceDbMock).not.toHaveBeenCalled()
  })

  it('denies a former member whose only player mapping is historical', async () => {
    authorizationHistoryRows = [
      {
        cluster_code: 'CL-A',
        guild_code: 'MY-GUILD',
        role: 'member',
        is_app_admin: false,
        is_current: false
      }
    ]

    const result = await fetchPlayerStats('SomePlayer', 'MY-GUILD', '104')

    expect(result).toEqual({
      stats: null,
      context: null,
      error: 'You are not authorized to view stats for this guild.'
    })
    expect(supabaseMock.from).toHaveBeenCalledTimes(1)
    expectCurrentMembershipQuery()
    expect(GuildConfigService.getBasic).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(serviceRpcMock).not.toHaveBeenCalled()
    expect(serviceDbMock).not.toHaveBeenCalled()
  })

  it('denies a former app admin despite spoofed elevated auth metadata', async () => {
    supabaseMock.auth.getUser.mockResolvedValueOnce({
      data: {
        user: {
          id: 'user-1',
          user_metadata: { role: 'admin', is_app_admin: true },
          app_metadata: { role: 'admin', is_app_admin: true }
        }
      }
    } as never)
    authorizationHistoryRows = [
      {
        cluster_code: 'CL-A',
        guild_code: 'MY-GUILD',
        role: 'leader',
        is_app_admin: true,
        is_current: false
      }
    ]

    const result = await fetchPlayerStats('SomePlayer', 'OTHER-GUILD', '104')

    expect(result).toEqual({
      stats: null,
      context: null,
      error: 'You are not authorized to view stats for this guild.'
    })
    expect(supabaseMock.from).toHaveBeenCalledTimes(1)
    expectCurrentMembershipQuery()
    expect(GuildConfigService.getBasic).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(serviceRpcMock).not.toHaveBeenCalled()
    expect(serviceDbMock).not.toHaveBeenCalled()
  })

  it('fails closed when a non-admin current mapping has no guild', async () => {
    maybeSingleQueue.push({
      data: {
        cluster_code: 'CL-A',
        guild_code: null,
        role: 'member',
        is_app_admin: false
      },
      error: null
    })

    const result = await fetchPlayerStats('SomePlayer', 'OTHER-GUILD', '104')

    expect(result.stats).toBeNull()
    expect(result.error).toBe(
      'You are not authorized to view stats for this guild.'
    )
    expect(supabaseMock.from).toHaveBeenCalledTimes(1)
    expect(GuildConfigService.getBasic).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
    expect(serviceDbMock).not.toHaveBeenCalled()
  })

  it('lets a real app admin view a guild outside their cluster', async () => {
    primeProfile({
      cluster_code: 'CL-A',
      guild_code: 'MY-GUILD',
      role: 'member',
      is_app_admin: true
    })

    const result = await fetchPlayerStats('SomePlayer', 'OTHER-GUILD', '104')

    expect(result.error).toBeNull()
    expect(result.stats).toEqual({ totalDamage: 123 })
    expect(serviceDbMock).toHaveBeenCalledOnce()
    expect(serviceRpcMock).toHaveBeenCalledWith(
      'get_player_stats_comprehensive',
      expect.objectContaining({ p_guild_code: 'OTHER-GUILD' })
    )
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('allows a mapped non-admin to view their own guild without cluster metadata', async () => {
    primeProfile({
      cluster_code: null,
      guild_code: 'NO-CLUSTER-GUILD',
      role: 'member',
      is_app_admin: false
    })

    const result = await fetchPlayerStats(
      'SomePlayer',
      'NO-CLUSTER-GUILD',
      '104'
    )

    expect(result.error).toBeNull()
    expect(GuildConfigService.getBasic).toHaveBeenCalledTimes(1)
    expect(GuildConfigService.getBasic).toHaveBeenCalledWith(
      supabaseMock,
      'NO-CLUSTER-GUILD'
    )
    expect(serviceDbMock).toHaveBeenCalledOnce()
    expect(serviceRpcMock).toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('still blocks a non-admin cross-cluster, even with a leadership role', async () => {
    primeProfile({
      cluster_code: 'CL-A',
      guild_code: 'MY-GUILD',
      role: 'leader',
      is_app_admin: false
    })

    const result = await fetchPlayerStats('SomePlayer', 'OTHER-GUILD', '104')

    expect(result.stats).toBeNull()
    expect(result.error).toBe(
      'You are not authorized to view stats for this guild.'
    )
    expect(rpcMock).not.toHaveBeenCalled()
    expect(serviceRpcMock).not.toHaveBeenCalled()
    expect(serviceDbMock).not.toHaveBeenCalled()
  })

  it('still allows a non-admin within their own cluster', async () => {
    primeProfile({
      cluster_code: 'CL-A',
      guild_code: 'MY-GUILD',
      role: 'member',
      is_app_admin: false
    })

    const result = await fetchPlayerStats(
      'SomePlayer',
      'SAME-CLUSTER-GUILD',
      '104'
    )

    expect(result.error).toBeNull()
    expect(serviceDbMock).toHaveBeenCalledOnce()
    expect(serviceRpcMock).toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('treats a missing is_app_admin flag as non-admin (fail closed)', async () => {
    primeProfile({
      cluster_code: 'CL-A',
      guild_code: 'MY-GUILD',
      role: 'member',
      is_app_admin: null
    })

    const result = await fetchPlayerStats('SomePlayer', 'OTHER-GUILD', '104')

    expect(result.stats).toBeNull()
    expect(result.error).toBe(
      'You are not authorized to view stats for this guild.'
    )
    expect(serviceDbMock).not.toHaveBeenCalled()
  })
})
