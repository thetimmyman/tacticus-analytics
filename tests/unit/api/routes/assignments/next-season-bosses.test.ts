import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockRequireRole: ReturnType<typeof vi.fn>
let mockEnsureRotationSnapshot: ReturnType<typeof vi.fn>
let mockComputeFutureConfigBosses: ReturnType<typeof vi.fn>
let mockGetSeasonConfigIdForOffset: ReturnType<typeof vi.fn>

describe('GET /api/assignments/next-season-bosses', () => {
  let GET: () => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    mockRequireRole = vi.fn()
    mockEnsureRotationSnapshot = vi.fn()
    mockComputeFutureConfigBosses = vi.fn()
    mockGetSeasonConfigIdForOffset = vi.fn()

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
      ensureRotationSnapshot: mockEnsureRotationSnapshot,
      computeFutureConfigBosses: mockComputeFutureConfigBosses
    }))

    vi.doMock('@/app/lib/loki/season-configs', () => ({
      getSeasonConfigIdForOffset: mockGetSeasonConfigIdForOffset,
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
      await import('@/app/api/assignments/next-season-bosses/route')
    GET = routeModule.GET
  })

  describe('authentication', () => {
    it('returns 500 when authentication fails', async () => {
      mockRequireRole.mockRejectedValue(new Error('Authentication required'))

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })

    it('returns 500 when user lacks officer role', async () => {
      const roleError = new Error('Insufficient permissions')
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
        'Unable to resolve upcoming guild boss rotation'
      )
    })

    it('returns next season bosses on success', async () => {
      const mockSnapshot = {
        currentConfigId: 'config-123',
        seasonNumber: 83,
        nextConfigId: 'config-124',
        matches: true,
        observedBosses: ['boss1', 'boss2'],
        currentBosses: [
          { id: 'current', name: 'Current Boss', canonical: 'curr' }
        ],
        nextBosses: [
          { id: 'ghazghkull', name: 'Ghazghkull', canonical: 'ghaz' },
          { id: 'avatar', name: 'Avatar of Khaine', canonical: 'avatar' }
        ],
        resolvedAt: '2025-01-01T12:00:00Z'
      }
      mockEnsureRotationSnapshot.mockResolvedValue(mockSnapshot)
      mockComputeFutureConfigBosses.mockReturnValue([
        { id: 'future1', name: 'Future Boss 1', canonical: 'f1' }
      ])
      mockGetSeasonConfigIdForOffset.mockReturnValue({ id: 'config-125' })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.currentConfigId).toBe('config-123')
      expect(body.seasonNumber).toBe(83)
      expect(body.nextConfigId).toBe('config-124')
      expect(body.futureConfigId).toBe('config-125')
      expect(body.matches).toBe(true)
      expect(body.observed).toEqual(['boss1', 'boss2'])
      expect(body.source).toBe('loki-rotation-cache')
      expect(body.resolvedAt).toBe('2025-01-01T12:00:00Z')
    })

    it('normalizes boss response by removing canonical field', async () => {
      const mockSnapshot = {
        currentConfigId: 'config-123',
        seasonNumber: 83,
        nextConfigId: 'config-124',
        matches: true,
        observedBosses: [],
        currentBosses: [],
        nextBosses: [
          {
            id: 'ghazghkull',
            name: 'Ghazghkull',
            canonical: 'ghaz',
            faction: 'ork'
          }
        ],
        resolvedAt: '2025-01-01T12:00:00Z'
      }
      mockEnsureRotationSnapshot.mockResolvedValue(mockSnapshot)
      mockComputeFutureConfigBosses.mockReturnValue([])
      mockGetSeasonConfigIdForOffset.mockReturnValue({ id: 'config-125' })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.bosses[0]).not.toHaveProperty('canonical')
      expect(body.bosses[0].id).toBe('ghazghkull')
      expect(body.bosses[0].name).toBe('Ghazghkull')
      expect(body.bosses[0].faction).toBe('ork')
    })

    it('includes future preview from computed future bosses', async () => {
      const mockSnapshot = {
        currentConfigId: 'config-123',
        seasonNumber: 83,
        nextConfigId: 'config-124',
        matches: true,
        observedBosses: [],
        currentBosses: [],
        nextBosses: [{ id: 'next1', name: 'Next 1', canonical: 'n1' }],
        resolvedAt: '2025-01-01T12:00:00Z'
      }
      mockEnsureRotationSnapshot.mockResolvedValue(mockSnapshot)
      mockComputeFutureConfigBosses.mockReturnValue([
        { id: 'future1', name: 'Future 1', canonical: 'f1' },
        { id: 'future2', name: 'Future 2', canonical: 'f2' }
      ])
      mockGetSeasonConfigIdForOffset.mockReturnValue({ id: 'config-125' })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.futurePreview).toHaveLength(2)
      expect(body.futurePreview[0]).not.toHaveProperty('canonical')
      expect(body.futurePreview[0].id).toBe('future1')
      expect(body.futurePreview[1].id).toBe('future2')
    })

    it('calls computeFutureConfigBosses with offset 2 and snapshot date', async () => {
      const resolvedAt = '2025-01-15T10:30:00Z'
      const mockSnapshot = {
        currentConfigId: 'config-123',
        seasonNumber: 83,
        nextConfigId: 'config-124',
        matches: true,
        observedBosses: [],
        currentBosses: [],
        nextBosses: [],
        resolvedAt
      }
      mockEnsureRotationSnapshot.mockResolvedValue(mockSnapshot)
      mockComputeFutureConfigBosses.mockReturnValue([])
      mockGetSeasonConfigIdForOffset.mockReturnValue({ id: 'config-125' })

      await GET()

      expect(mockComputeFutureConfigBosses).toHaveBeenCalledWith(
        2,
        expect.any(Date)
      )
      const calledDate = mockComputeFutureConfigBosses.mock.calls[0][1]
      expect(calledDate.getTime()).toBe(new Date(resolvedAt).getTime())
    })

    it('calls getSeasonConfigIdForOffset with offset 2 and reference date', async () => {
      const resolvedAt = '2025-01-15T10:30:00Z'
      const mockSnapshot = {
        currentConfigId: 'config-123',
        seasonNumber: 83,
        nextConfigId: 'config-124',
        matches: true,
        observedBosses: [],
        currentBosses: [],
        nextBosses: [],
        resolvedAt
      }
      mockEnsureRotationSnapshot.mockResolvedValue(mockSnapshot)
      mockComputeFutureConfigBosses.mockReturnValue([])
      mockGetSeasonConfigIdForOffset.mockReturnValue({ id: 'config-125' })

      await GET()

      expect(mockGetSeasonConfigIdForOffset).toHaveBeenCalledWith(
        2,
        expect.any(Date)
      )
    })

    it('includes default boss levels', async () => {
      const mockSnapshot = {
        currentConfigId: 'config-123',
        seasonNumber: 83,
        nextConfigId: 'config-124',
        matches: true,
        observedBosses: [],
        currentBosses: [],
        nextBosses: [],
        resolvedAt: '2025-01-01T12:00:00Z'
      }
      mockEnsureRotationSnapshot.mockResolvedValue(mockSnapshot)
      mockComputeFutureConfigBosses.mockReturnValue([])
      mockGetSeasonConfigIdForOffset.mockReturnValue({ id: 'config-125' })

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
    it('returns 500 on unexpected error during snapshot fetch', async () => {
      mockRequireRole.mockResolvedValue({ user: { id: 'user-123' } })
      mockEnsureRotationSnapshot.mockRejectedValue(new Error('Cache error'))

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })

    it('returns 500 on error computing future bosses', async () => {
      mockRequireRole.mockResolvedValue({ user: { id: 'user-123' } })
      const mockSnapshot = {
        currentConfigId: 'config-123',
        seasonNumber: 83,
        nextConfigId: 'config-124',
        matches: true,
        observedBosses: [],
        currentBosses: [],
        nextBosses: [],
        resolvedAt: '2025-01-01T12:00:00Z'
      }
      mockEnsureRotationSnapshot.mockResolvedValue(mockSnapshot)
      mockComputeFutureConfigBosses.mockImplementation(() => {
        throw new Error('Compute error')
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })
  })
})
