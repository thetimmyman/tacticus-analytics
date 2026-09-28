import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

let mockRunSyncHealthChecks: ReturnType<typeof vi.fn>
let mockRunDataIntegrityHealthChecks: ReturnType<typeof vi.fn>
let mockGetOptionalAuthForApi: ReturnType<typeof vi.fn>

describe('GET /api/health/sync-status', () => {
  let GET: () => Promise<NextResponse>

  beforeEach(async () => {
    vi.resetModules()

    mockRunSyncHealthChecks = vi.fn()
    mockRunDataIntegrityHealthChecks = vi.fn()
    // Authenticated by default; the anonymous tier has its own block.
    mockGetOptionalAuthForApi = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
      profile: { guild_code: 'TESTGLD' }
    })

    vi.doMock('@/app/lib/health', () => ({
      runSyncHealthChecks: mockRunSyncHealthChecks,
      runDataIntegrityHealthChecks: mockRunDataIntegrityHealthChecks
    }))

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return { ...actual, getOptionalAuthForApi: mockGetOptionalAuthForApi }
    })

    const routeModule = await import('@/app/api/health/sync-status/route')
    GET = routeModule.GET
  })

  describe('health status calculation', () => {
    it('returns healthy when failure rate is low and no integrity issues', async () => {
      mockRunSyncHealthChecks.mockResolvedValue({
        totalActiveGuilds: 50,
        failingGuilds: 2,
        disabledDueToFailures: 0,
        commonErrorPatterns: [],
        avgConsecutiveFailures: 1
      })

      mockRunDataIntegrityHealthChecks.mockResolvedValue({
        orphanedPlayers: { count: 0 },
        syncGaps: { count: 0 },
        seasonDataIntegrity: { healthy: true },
        staleGuilds: { count: 0 },
        excludedGuilds: { count: 0, guilds: [], memberCount: 0, checked: true }
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(mockRunSyncHealthChecks).toHaveBeenCalledWith({
        emitAlerts: false
      })
      expect(mockRunDataIntegrityHealthChecks).toHaveBeenCalledWith({
        emitAlerts: false
      })
      expect(body.status).toBe('healthy')
      expect(body.timestamp).toBeDefined()
      expect(body.responseTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('returns degraded when failure rate is between 10-30%', async () => {
      mockRunSyncHealthChecks.mockResolvedValue({
        totalActiveGuilds: 50,
        failingGuilds: 10,
        disabledDueToFailures: 2,
        commonErrorPatterns: ['API_KEY_INVALID'],
        avgConsecutiveFailures: 3
      })

      mockRunDataIntegrityHealthChecks.mockResolvedValue({
        orphanedPlayers: { count: 0 },
        syncGaps: { count: 0 },
        seasonDataIntegrity: { healthy: true },
        staleGuilds: { count: 0 },
        excludedGuilds: { count: 0, guilds: [], memberCount: 0, checked: true }
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })

    it('returns unhealthy when failure rate exceeds 30%', async () => {
      mockRunSyncHealthChecks.mockResolvedValue({
        totalActiveGuilds: 50,
        failingGuilds: 20,
        disabledDueToFailures: 5,
        commonErrorPatterns: ['DB_ERROR', 'TIMEOUT'],
        avgConsecutiveFailures: 5
      })

      mockRunDataIntegrityHealthChecks.mockResolvedValue({
        orphanedPlayers: { count: 0 },
        syncGaps: { count: 0 },
        seasonDataIntegrity: { healthy: true },
        staleGuilds: { count: 0 },
        excludedGuilds: { count: 0, guilds: [], memberCount: 0, checked: true }
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('unhealthy')
    })

    it('returns degraded when season data integrity is unhealthy', async () => {
      mockRunSyncHealthChecks.mockResolvedValue({
        totalActiveGuilds: 50,
        failingGuilds: 2,
        disabledDueToFailures: 0,
        commonErrorPatterns: [],
        avgConsecutiveFailures: 1
      })

      mockRunDataIntegrityHealthChecks.mockResolvedValue({
        orphanedPlayers: { count: 0 },
        syncGaps: { count: 0 },
        seasonDataIntegrity: { healthy: false, issue: 'Missing season data' },
        staleGuilds: { count: 0 },
        excludedGuilds: { count: 0, guilds: [], memberCount: 0, checked: true }
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })

    it('returns degraded when sync gaps exist', async () => {
      mockRunSyncHealthChecks.mockResolvedValue({
        totalActiveGuilds: 50,
        failingGuilds: 2,
        disabledDueToFailures: 0,
        commonErrorPatterns: [],
        avgConsecutiveFailures: 1
      })

      mockRunDataIntegrityHealthChecks.mockResolvedValue({
        orphanedPlayers: { count: 0 },
        syncGaps: { count: 5, guilds: ['GUILD1', 'GUILD2'] },
        seasonDataIntegrity: { healthy: true },
        staleGuilds: { count: 0 },
        excludedGuilds: { count: 0, guilds: [], memberCount: 0, checked: true }
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })

    it('handles zero active guilds without division error', async () => {
      mockRunSyncHealthChecks.mockResolvedValue({
        totalActiveGuilds: 0,
        failingGuilds: 0,
        disabledDueToFailures: 0,
        commonErrorPatterns: [],
        avgConsecutiveFailures: 0
      })

      mockRunDataIntegrityHealthChecks.mockResolvedValue({
        orphanedPlayers: { count: 0 },
        syncGaps: { count: 0 },
        seasonDataIntegrity: { healthy: true },
        staleGuilds: { count: 0 },
        excludedGuilds: { count: 0, guilds: [], memberCount: 0, checked: true }
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.sync.failureRate).toBe(0)
    })
  })

  describe('response structure', () => {
    it('includes sync metrics in response', async () => {
      mockRunSyncHealthChecks.mockResolvedValue({
        totalActiveGuilds: 100,
        failingGuilds: 5,
        disabledDueToFailures: 2,
        commonErrorPatterns: ['API_KEY_INVALID', 'RATE_LIMITED'],
        avgConsecutiveFailures: 2.5
      })

      mockRunDataIntegrityHealthChecks.mockResolvedValue({
        orphanedPlayers: { count: 0 },
        syncGaps: { count: 0 },
        seasonDataIntegrity: { healthy: true },
        staleGuilds: { count: 0 },
        excludedGuilds: { count: 0, guilds: [], memberCount: 0, checked: true }
      })

      const response = await GET()
      const body = await response.json()

      expect(body.sync).toBeDefined()
      expect(body.sync.totalActiveGuilds).toBe(100)
      expect(body.sync.failingGuilds).toBe(5)
      expect(body.sync.failureRate).toBe(5)
      expect(body.sync.disabledDueToFailures).toBe(2)
      expect(body.sync.commonErrorPatterns).toEqual([
        'API_KEY_INVALID',
        'RATE_LIMITED'
      ])
      expect(body.sync.avgConsecutiveFailures).toBe(2.5)
    })

    it('includes data integrity metrics in response', async () => {
      mockRunSyncHealthChecks.mockResolvedValue({
        totalActiveGuilds: 50,
        failingGuilds: 0,
        disabledDueToFailures: 0,
        commonErrorPatterns: [],
        avgConsecutiveFailures: 0
      })

      const mockDataIntegrity = {
        orphanedPlayers: {
          count: 3,
          players: ['player1', 'player2', 'player3']
        },
        syncGaps: { count: 2, guilds: ['GUILD1', 'GUILD2'] },
        seasonDataIntegrity: { healthy: true, lastSeason: 'S100' },
        staleGuilds: { count: 1, guilds: ['STALE1'] },
        excludedGuilds: { count: 0, guilds: [], memberCount: 0, checked: true }
      }

      mockRunDataIntegrityHealthChecks.mockResolvedValue(mockDataIntegrity)

      const response = await GET()
      const body = await response.json()

      expect(body.dataIntegrity).toBeDefined()
      expect(body.dataIntegrity.orphanedPlayers).toEqual(
        mockDataIntegrity.orphanedPlayers
      )
      expect(body.dataIntegrity.syncGaps).toEqual(mockDataIntegrity.syncGaps)
      expect(body.dataIntegrity.seasonDataIntegrity).toEqual(
        mockDataIntegrity.seasonDataIntegrity
      )
      expect(body.dataIntegrity.staleGuilds).toEqual(
        mockDataIntegrity.staleGuilds
      )
    })

    it('rounds failure rate to one decimal place', async () => {
      mockRunSyncHealthChecks.mockResolvedValue({
        totalActiveGuilds: 73,
        failingGuilds: 11,
        disabledDueToFailures: 0,
        commonErrorPatterns: [],
        avgConsecutiveFailures: 0
      })

      mockRunDataIntegrityHealthChecks.mockResolvedValue({
        orphanedPlayers: { count: 0 },
        syncGaps: { count: 0 },
        seasonDataIntegrity: { healthy: true },
        staleGuilds: { count: 0 },
        excludedGuilds: { count: 0, guilds: [], memberCount: 0, checked: true }
      })

      const response = await GET()
      const body = await response.json()

      expect(body.sync.failureRate).toBe(15.1)
    })
  })

  describe('error handling', () => {
    it('returns 500 with error status when sync check throws', async () => {
      mockRunSyncHealthChecks.mockRejectedValue(
        new Error('Database connection failed')
      )
      mockRunDataIntegrityHealthChecks.mockResolvedValue({
        orphanedPlayers: { count: 0 },
        syncGaps: { count: 0 },
        seasonDataIntegrity: { healthy: true },
        staleGuilds: { count: 0 },
        excludedGuilds: { count: 0, guilds: [], memberCount: 0, checked: true }
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.metadata.status).toBe('error')
      expect(body.error.message).toBe('Database connection failed')
      expect(body.error.metadata.timestamp).toBeDefined()
      expect(body.error.metadata.responseTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('returns 500 with error status when data integrity check throws', async () => {
      mockRunSyncHealthChecks.mockResolvedValue({
        totalActiveGuilds: 50,
        failingGuilds: 0,
        disabledDueToFailures: 0,
        commonErrorPatterns: [],
        avgConsecutiveFailures: 0
      })
      mockRunDataIntegrityHealthChecks.mockRejectedValue(
        new Error('Query timeout')
      )

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.metadata.status).toBe('error')
      expect(body.error.message).toBe('Query timeout')
    })

    it('returns generic error for non-Error exceptions', async () => {
      mockRunSyncHealthChecks.mockRejectedValue('String error')
      mockRunDataIntegrityHealthChecks.mockResolvedValue({
        orphanedPlayers: { count: 0 },
        syncGaps: { count: 0 },
        seasonDataIntegrity: { healthy: true },
        staleGuilds: { count: 0 },
        excludedGuilds: { count: 0, guilds: [], memberCount: 0, checked: true }
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.metadata.status).toBe('error')
      expect(body.error.message).toBe('Health check failed')
    })
  })

  describe('parallel execution', () => {
    it('runs both health checks in parallel', async () => {
      let syncFinished = false
      let integrityStartedBeforeSyncFinished = false

      mockRunSyncHealthChecks.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        syncFinished = true
        return {
          totalActiveGuilds: 50,
          failingGuilds: 0,
          disabledDueToFailures: 0,
          commonErrorPatterns: [],
          avgConsecutiveFailures: 0
        }
      })

      mockRunDataIntegrityHealthChecks.mockImplementation(async () => {
        integrityStartedBeforeSyncFinished = !syncFinished
        await new Promise((resolve) => setTimeout(resolve, 10))
        return {
          orphanedPlayers: { count: 0 },
          syncGaps: { count: 0 },
          seasonDataIntegrity: { healthy: true },
          staleGuilds: { count: 0 },
          excludedGuilds: {
            count: 0,
            guilds: [],
            memberCount: 0,
            checked: true
          }
        }
      })

      await GET()

      expect(mockRunSyncHealthChecks).toHaveBeenCalledTimes(1)
      expect(mockRunDataIntegrityHealthChecks).toHaveBeenCalledTimes(1)
      expect(integrityStartedBeforeSyncFinished).toBe(true)
    })
  })

  describe('anonymous disclosure tier', () => {
    const seedDegradedWithNamedGuilds = () => {
      mockRunSyncHealthChecks.mockResolvedValue({
        totalActiveGuilds: 261,
        failingGuilds: 1,
        disabledDueToFailures: 0,
        // The social-engineering payload: which specific guild is broken.
        commonErrorPatterns: [
          { pattern: 'auth', guilds: ['【TG】Test Guild'] }
        ],
        avgConsecutiveFailures: 3
      })
      mockRunDataIntegrityHealthChecks.mockResolvedValue({
        orphanedPlayers: { count: 88 },
        syncGaps: { count: 8, guilds: ['GuildA', 'GuildB'] },
        seasonDataIntegrity: {
          healthy: false,
          issues: ["Season transition monitor hasn't run in 196 hours"]
        },
        staleGuilds: { count: 9, guilds: ['GuildC'] }
      })
    }

    it('gives an anonymous caller liveness only — no named guilds, no ops detail', async () => {
      mockGetOptionalAuthForApi.mockResolvedValue(null)
      seedDegradedWithNamedGuilds()

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
      expect(body.timestamp).toBeDefined()

      expect(body.sync).toBeUndefined()
      expect(body.dataIntegrity).toBeUndefined()

      const serialized = JSON.stringify(body)
      expect(serialized).not.toContain('Test Guild')
      expect(serialized).not.toContain('GuildA')
      expect(serialized).not.toContain('GuildC')
      expect(serialized).not.toContain('196 hours')
    })

    it('gives an authenticated caller the full operational detail', async () => {
      mockGetOptionalAuthForApi.mockResolvedValue({
        user: { id: 'user-1' },
        profile: { guild_code: 'TESTGLD' }
      })
      seedDegradedWithNamedGuilds()

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
      expect(body.sync.totalActiveGuilds).toBe(261)
      expect(body.dataIntegrity.orphanedPlayers.count).toBe(88)
      expect(JSON.stringify(body)).toContain('Test Guild')
    })
  })
})
