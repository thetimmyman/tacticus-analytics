import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockRequireAuthForApi: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockGetPlaybookContent: ReturnType<typeof vi.fn>
let mockPlaybooks: { bosses: unknown[]; generatedAt: string }

describe('GET /api/playbooks/[bossId]', () => {
  let GET: (
    request: Request,
    context: { params: Promise<{ bossId: string }> }
  ) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    mockRequireAuthForApi = vi.fn()
    mockCheckFeatureAccess = vi.fn()
    mockGetPlaybookContent = vi.fn()
    mockPlaybooks = {
      bosses: [
        { id: 'ghazghkull', name: 'Ghazghkull', playbook: 'ghazghkull-main' },
        {
          id: 'avatar',
          name: 'Avatar of Khaine',
          playbook: 'avatar-main',
          primesPlaybook: 'avatar-primes'
        },
        { id: 'hive-tyrant', name: 'Hive Tyrant', playbook: 'hive-tyrant-main' }
      ],
      generatedAt: '2025-01-01T00:00:00Z'
    }

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return { ...actual, requireAuthForApi: mockRequireAuthForApi }
    })

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess
    }))

    vi.doMock('@/data/boss-playbooks/playbooks.json', () => ({
      default: mockPlaybooks
    }))

    vi.doMock('@/data/boss-playbooks/playbook-content.generated', () => ({
      getPlaybookContent: mockGetPlaybookContent
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    const routeModule = await import('@/app/api/playbooks/[bossId]/route')
    GET = routeModule.GET
  })

  const createRequest = (bossId: string) => {
    return [
      new Request(`http://localhost/api/playbooks/${bossId}`),
      { params: Promise.resolve({ bossId }) }
    ] as const
  }

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      const { AuthError } = await import('@/app/lib/auth')
      mockRequireAuthForApi.mockRejectedValue(
        new AuthError('Authentication required', 'UNAUTHENTICATED')
      )

      const [request, context] = createRequest('ghazghkull')
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })
  })

  describe('feature access', () => {
    it('returns 403 when user does not have feature access', async () => {
      mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-123' } })
      mockCheckFeatureAccess.mockResolvedValue({
        has_access: false,
        stage: 'beta',
        reason: 'Feature in beta testing'
      })

      const [request, context] = createRequest('ghazghkull')
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('Boss Playbooks requires alpha ')
      expect(body.error.metadata?.stage).toBe('beta')
    })
  })

  describe('validation', () => {
    beforeEach(() => {
      mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-123' } })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    })

    it('returns 404 when boss is not found', async () => {
      const [request, context] = createRequest('nonexistent-boss')
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error.message).toContain('nonexistent-boss')
      expect(body.error.message).toContain('not found')
    })
  })

  describe('successful fetch', () => {
    beforeEach(() => {
      mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-123' } })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    })

    it('returns boss playbook data', async () => {
      mockGetPlaybookContent.mockReturnValue(
        '# Ghazghkull Strategy\n\nContent here.'
      )

      const [request, context] = createRequest('ghazghkull')
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.boss.id).toBe('ghazghkull')
      expect(body.data.boss.name).toBe('Ghazghkull')
      expect(body.data.markdownContent).toBe(
        '# Ghazghkull Strategy\n\nContent here.'
      )
      expect(body.data.lastUpdated).toBe('2025-01-01T00:00:00Z')
    })

    it('includes primes playbook when available', async () => {
      mockGetPlaybookContent.mockImplementation((playbook: string) => {
        if (playbook === 'avatar-main') return '# Avatar Main Strategy'
        if (playbook === 'avatar-primes') return '# Avatar Primes Strategy'
        return null
      })

      const [request, context] = createRequest('avatar')
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.markdownContent).toBe('# Avatar Main Strategy')
      expect(body.data.primesMarkdownContent).toBe('# Avatar Primes Strategy')
    })

    it('returns default content when playbook content not found', async () => {
      mockGetPlaybookContent.mockReturnValue(null)

      const [request, context] = createRequest('hive-tyrant')
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.markdownContent).toContain('Hive Tyrant Playbook')
      expect(body.data.markdownContent).toContain('coming soon')
    })

    it('does not include primes content when boss has no primes playbook', async () => {
      mockGetPlaybookContent.mockReturnValue('# Main Content')

      const [request, context] = createRequest('ghazghkull')
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.primesMarkdownContent).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('returns 500 on unexpected error', async () => {
      mockRequireAuthForApi.mockRejectedValue(new Error('Unexpected error'))

      const [request, context] = createRequest('ghazghkull')
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to fetch playbook')
    })

    it('returns 500 when playbook content throws', async () => {
      mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-123' } })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockGetPlaybookContent.mockImplementation(() => {
        throw new Error('Content load error')
      })

      const [request, context] = createRequest('ghazghkull')
      const response = await GET(request, context)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to fetch playbook')
    })
  })
})
