import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockRequireRole: ReturnType<typeof vi.fn>
let mockEnsureRotationSnapshot: ReturnType<typeof vi.fn>

describe('GET /api/assignments/current-season-bosses', () => {
  let GET: () => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    mockRequireRole = vi.fn()
    mockEnsureRotationSnapshot = vi.fn()

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireRole: mockRequireRole,
        requireRoleForApi: mockRequireRole
      }
    })

    vi.doMock('@/app/lib/loki/rotation-cache', () => ({
      ensureRotationSnapshot: mockEnsureRotationSnapshot
    }))

    vi.doMock('@/app/lib/loki/season-configs', () => ({
      type: {}
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    const routeModule =
      await import('@/app/api/assignments/current-season-bosses/route')
    GET = routeModule.GET
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      const authError = new Error('Authentication required')
      ;(authError as any).status = 401
      mockRequireRole.mockRejectedValue(authError)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })

    it('returns 403 when user does not have officer role', async () => {
      const roleError = new Error('Insufficient permissions')
      ;(roleError as any).status = 403
      mockRequireRole.mockRejectedValue(roleError)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })
  })

  describe('rotation cache', () => {
    beforeEach(() => {
      mockRequireRole.mockResolvedValue({
        user: { id: 'user-123' },
        profile: { role: 'officer' }
      })
    })

    it('returns 503 when rotation snapshot is unavailable', async () => {
      mockEnsureRotationSnapshot.mockResolvedValue(null)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.error).toBeDefined()
      expect(body.error.metadata?.reason).toBe('rotation_cache_unavailable')
      expect(body.error.message).toContain(
        'Unable to resolve guild boss rotation'
      )
    })

    it('returns current season bosses on success', async () => {
      const mockSnapshot = {
        currentConfigId: 'config-123',
        seasonNumber: 83,
        matches: true,
        observedBosses: ['boss1', 'boss2'],
        currentBosses: [
          { id: 'ghazghkull', name: 'Ghazghkull', canonical: 'ghaz' },
          { id: 'avatar', name: 'Avatar of Khaine', canonical: 'avatar' }
        ],
        nextBosses: [
          { id: 'hive-tyrant', name: 'Hive Tyrant', canonical: 'tyrant' }
        ],
        resolvedAt: '2025-01-01T12:00:00Z'
      }
      mockEnsureRotationSnapshot.mockResolvedValue(mockSnapshot)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.configId).toBe('config-123')
      expect(body.seasonNumber).toBe(83)
      expect(body.matches).toBe(true)
      expect(body.observed).toEqual(['boss1', 'boss2'])
      expect(body.source).toBe('loki-rotation-cache')
      expect(body.resolvedAt).toBe('2025-01-01T12:00:00Z')
    })

    it('normalizes boss response by removing canonical field', async () => {
      const mockSnapshot = {
        currentConfigId: 'config-123',
        seasonNumber: 83,
        matches: true,
        observedBosses: [],
        currentBosses: [
          {
            id: 'ghazghkull',
            name: 'Ghazghkull',
            canonical: 'ghaz',
            someField: 'value'
          }
        ],
        nextBosses: [{ id: 'avatar', name: 'Avatar', canonical: 'avatar' }],
        resolvedAt: '2025-01-01T12:00:00Z'
      }
      mockEnsureRotationSnapshot.mockResolvedValue(mockSnapshot)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.bosses[0]).not.toHaveProperty('canonical')
      expect(body.bosses[0].id).toBe('ghazghkull')
      expect(body.bosses[0].name).toBe('Ghazghkull')
      expect(body.bosses[0].someField).toBe('value')
    })

    it('includes upcoming preview from next bosses', async () => {
      const mockSnapshot = {
        currentConfigId: 'config-123',
        seasonNumber: 83,
        matches: true,
        observedBosses: [],
        currentBosses: [{ id: 'boss1', name: 'Boss 1', canonical: 'b1' }],
        nextBosses: [
          { id: 'boss2', name: 'Boss 2', canonical: 'b2' },
          { id: 'boss3', name: 'Boss 3', canonical: 'b3' }
        ],
        resolvedAt: '2025-01-01T12:00:00Z'
      }
      mockEnsureRotationSnapshot.mockResolvedValue(mockSnapshot)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.upcomingPreview).toHaveLength(2)
      expect(body.upcomingPreview[0]).not.toHaveProperty('canonical')
      expect(body.upcomingPreview[0].id).toBe('boss2')
    })

    it('includes default boss levels', async () => {
      const mockSnapshot = {
        currentConfigId: 'config-123',
        seasonNumber: 83,
        matches: true,
        observedBosses: [],
        currentBosses: [],
        nextBosses: [],
        resolvedAt: '2025-01-01T12:00:00Z'
      }
      mockEnsureRotationSnapshot.mockResolvedValue(mockSnapshot)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.levels).toEqual([
        'M5',
        'M4',
        'M3',
        'M2',
        'M1',
        'L5',
        'L4',
        'L3',
        'L2',
        'L1'
      ])
    })
  })

  describe('error handling', () => {
    it('returns 500 on unexpected error', async () => {
      mockRequireRole.mockResolvedValue({ user: { id: 'user-123' } })
      mockEnsureRotationSnapshot.mockRejectedValue(new Error('Cache error'))

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })
  })
})
