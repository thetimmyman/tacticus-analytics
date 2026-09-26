import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
  const mockRequireAuthForApi = vi.fn()
  return {
    ...actual,
    requireAuthForApi: mockRequireAuthForApi
  }
})

vi.mock('@/app/lib/services/feature-release-service', () => ({
  checkFeatureAccess: vi.fn()
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/data/boss-playbooks/playbooks.json', () => ({
  default: {
    bosses: [
      { id: 'boss1', name: 'Boss 1', playbook: 'playbook1.md' },
      {
        id: 'ghazghkull',
        name: 'Ghazghkull Thraka',
        playbook: 'ghazghkull-playbook.md',
        primesPlaybook: 'ghazghkull-primes-playbook.md'
      }
    ],
    generatedAt: '2026-01-01T00:00:00Z'
  }
}))

vi.mock('@/data/boss-playbooks/playbook-content.generated', () => ({
  getPlaybookContent: vi.fn((id) => `# Content for ${id}`)
}))

describe('Playbooks Routes', () => {
  let requireAuthForApi: ReturnType<typeof vi.fn>
  let checkFeatureAccess: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    const authModule = await import('@/app/lib/auth')
    const featureModule =
      await import('@/app/lib/services/feature-release-service')

    requireAuthForApi = vi.mocked(authModule.requireAuthForApi)
    checkFeatureAccess = vi.mocked(featureModule.checkFeatureAccess)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/playbooks/[bossId]', () => {
    function createRequest(bossId = 'boss1'): Request {
      return new NextRequest(`http://localhost:3000/api/playbooks/${bossId}`)
    }

    it('returns 401 when not authenticated', async () => {
      const { AuthError } = await import('@/app/lib/auth')
      requireAuthForApi.mockRejectedValue(
        new AuthError('Authentication required', 'UNAUTHENTICATED')
      )

      const { GET } = await import('@/app/api/playbooks/[bossId]/route')

      const response = await GET(createRequest(), {
        params: Promise.resolve({ bossId: 'boss1' })
      })

      expect(response.status).toBe(401)
    })

    it('returns 403 when feature access is denied', async () => {
      requireAuthForApi.mockResolvedValue({ user: { id: 'user-1' } })
      checkFeatureAccess.mockResolvedValue({ has_access: false })

      const { GET } = await import('@/app/api/playbooks/[bossId]/route')

      const response = await GET(createRequest(), {
        params: Promise.resolve({ bossId: 'boss1' })
      })

      expect(response.status).toBe(403)
    })

    it('returns 404 for unknown boss', async () => {
      requireAuthForApi.mockResolvedValue({ user: { id: 'user-1' } })
      checkFeatureAccess.mockResolvedValue({ has_access: true })

      const { GET } = await import('@/app/api/playbooks/[bossId]/route')

      const response = await GET(createRequest(), {
        params: Promise.resolve({ bossId: 'unknown' })
      })

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error.message).toContain('not found')
    })

    it('returns playbook content for valid boss', async () => {
      requireAuthForApi.mockResolvedValue({ user: { id: 'user-1' } })
      checkFeatureAccess.mockResolvedValue({ has_access: true })

      const { GET } = await import('@/app/api/playbooks/[bossId]/route')

      const response = await GET(createRequest(), {
        params: Promise.resolve({ bossId: 'boss1' })
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.data.boss.id).toBe('boss1')
      expect(body.data.markdownContent).toBe('# Content for playbook1.md')
      expect(body.data.playbookV1).toBeUndefined()
    })

    it('preserves markdown without exposing a legacy private fixture', async () => {
      requireAuthForApi.mockResolvedValue({ user: { id: 'user-1' } })
      checkFeatureAccess.mockResolvedValue({ has_access: true })

      const { GET } = await import('@/app/api/playbooks/[bossId]/route')

      const response = await GET(createRequest('ghazghkull'), {
        params: Promise.resolve({ bossId: 'ghazghkull' })
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.data.boss.id).toBe('ghazghkull')
      expect(body.data.markdownContent).toBe(
        '# Content for ghazghkull-playbook.md'
      )
      expect(body.data.primesMarkdownContent).toBe(
        '# Content for ghazghkull-primes-playbook.md'
      )

      expect(body.data.playbookV1).toBeUndefined()
      expect(body.data.playbookV1Source).toBeUndefined()
    })
  })
})
