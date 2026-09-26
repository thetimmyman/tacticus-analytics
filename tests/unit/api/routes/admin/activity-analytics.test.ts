import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>

const dayMs = 24 * 60 * 60 * 1000

const createAdminProfileQuery = (isAdmin = true) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { is_app_admin: isAdmin } })
})

describe('/api/admin/activity-analytics', () => {
  let GET: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: vi.fn(() => mockSupabase)
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/admin/activity-analytics/route')
    GET = routeModule.GET
  })

  describe('GET /api/admin/activity-analytics', () => {
    it('returns 401 when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new NextRequest(
        'http://localhost/api/admin/activity-analytics'
      )
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Unauthorized')
      expect(body.error.metadata.error).toBe('Unauthorized')
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('returns 403 when user is not admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } }
      })
      mockSupabase.from.mockReturnValue(createAdminProfileQuery(false))

      const request = new NextRequest(
        'http://localhost/api/admin/activity-analytics'
      )
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toBe('Forbidden')
      expect(body.error.metadata.error).toBe('Forbidden')
      expect(mockSupabase.from).toHaveBeenCalledTimes(1)
      expect(mockSupabase.from).toHaveBeenCalledWith('player_mapping')
    })

    it('returns aggregated activity summary and filters', async () => {
      const now = new Date()
      const users = [
        {
          user_id: 'user-1',
          display_name: 'User One',
          guild_code: 'GUILD1',
          role: 'leader',
          last_active_at: now.toISOString()
        },
        {
          user_id: 'user-2',
          display_name: 'User Two',
          guild_code: 'GUILD2',
          role: 'member',
          last_active_at: new Date(now.getTime() - 10 * dayMs).toISOString()
        },
        {
          user_id: 'user-3',
          display_name: 'User Three',
          guild_code: null,
          role: null,
          last_active_at: new Date(now.getTime() - dayMs).toISOString()
        },
        {
          user_id: 'user-4',
          display_name: 'User Four',
          guild_code: 'GUILD1',
          role: 'officer',
          last_active_at: null
        }
      ]

      const guildConfigs = [
        {
          guild_code: 'GUILD1',
          display_name: 'Guild One',
          cluster_code: 'CL1'
        },
        { guild_code: 'GUILD2', display_name: 'Guild Two', cluster_code: 'CL1' }
      ]
      const guilds = [
        {
          guild_code: 'GUILD1',
          display_name: 'Guild One',
          cluster_code: 'CL1'
        },
        { guild_code: 'GUILD2', display_name: 'Guild Two', cluster_code: 'CL1' }
      ]
      const clusters = [
        { cluster_code: 'CL1' },
        { cluster_code: null },
        { cluster_code: 'CL2' },
        { cluster_code: 'CL1' }
      ]
      const playerQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        data: users,
        error: null
      }

      let playerMappingCalls = 0
      let guildConfigCalls = 0

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } }
      })
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          playerMappingCalls += 1
          return playerMappingCalls === 1
            ? createAdminProfileQuery(true)
            : playerQuery
        }
        if (table === 'guild_config') {
          guildConfigCalls += 1
          if (guildConfigCalls === 1) {
            return { select: vi.fn().mockResolvedValue({ data: guildConfigs }) }
          }
          if (guildConfigCalls === 2) {
            return {
              select: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({ data: guilds })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: clusters })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/activity-analytics?days_back=7'
      )
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.summary.totalClaimedUsers).toBe(4)
      expect(body.summary.activeCount).toBe(2)
      expect(body.summary.inactiveCount).toBe(2)
      expect(body.summary.activityRate).toBe(50)
      expect(body.summary.daysBack).toBe(7)
      expect(body.dailyActivity).toHaveLength(7)
      expect(body.filters.guilds).toEqual(guilds)
      expect(body.filters.clusters).toEqual(['CL1', 'CL2'])
      const guildOne = body.guildActivity.find(
        (entry: { guild_code: string }) => entry.guild_code === 'GUILD1'
      )
      const unknownGuild = body.guildActivity.find(
        (entry: { guild_code: string }) => entry.guild_code === 'Unknown'
      )

      expect(guildOne).toMatchObject({
        guild_name: 'Guild One',
        active: 1,
        total: 2
      })
      expect(unknownGuild).toMatchObject({
        guild_name: 'Unknown',
        active: 1,
        total: 1
      })
    })

    it('applies guild, cluster, and role filters to the query', async () => {
      const eqMock = vi.fn().mockReturnThis()
      const inMock = vi.fn().mockReturnThis()
      const playerQuery = {
        select: vi.fn().mockReturnThis(),
        eq: eqMock,
        not: vi.fn().mockReturnThis(),
        in: inMock,
        data: [],
        error: null
      }

      const guildConfigs = [
        {
          guild_code: 'GUILD1',
          display_name: 'Guild One',
          cluster_code: 'CL1'
        },
        { guild_code: 'GUILD2', display_name: 'Guild Two', cluster_code: 'CL1' }
      ]
      let playerMappingCalls = 0
      let guildConfigCalls = 0

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } }
      })
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          playerMappingCalls += 1
          return playerMappingCalls === 1
            ? createAdminProfileQuery(true)
            : playerQuery
        }
        if (table === 'guild_config') {
          guildConfigCalls += 1
          if (guildConfigCalls === 1) {
            return { select: vi.fn().mockResolvedValue({ data: guildConfigs }) }
          }
          if (guildConfigCalls === 2) {
            return {
              select: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({ data: [] })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: [] })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/activity-analytics?guild_code=GUILD1&cluster_code=CL1&role=leader'
      )
      const response = await GET(request)
      await response.json()

      expect(eqMock).toHaveBeenCalledWith('guild_code', 'GUILD1')
      expect(eqMock).toHaveBeenCalledWith('role', 'leader')
      expect(inMock).toHaveBeenCalledWith('guild_code', ['GUILD1', 'GUILD2'])
    })

    it('returns 500 when activity query fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const playerQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        data: null,
        error: { message: 'DB error' }
      }

      let playerMappingCalls = 0

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1' } }
      })
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          playerMappingCalls += 1
          return playerMappingCalls === 1
            ? createAdminProfileQuery(true)
            : playerQuery
        }
        if (table === 'guild_config') {
          return { select: vi.fn().mockResolvedValue({ data: [] }) }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/activity-analytics'
      )
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('DB error')

      errorSpy.mockRestore()
    })
  })
})
