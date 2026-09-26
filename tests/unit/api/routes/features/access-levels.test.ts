import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireAuthForApi = vi.fn()
vi.mock('@/app/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
  return {
    ...actual,
    requireAuthForApi: (...args: unknown[]) => mockRequireAuthForApi(...args)
  }
})

const mockGetUserAccessLevels = vi.fn()
vi.mock('@/app/lib/services/feature-release-service', () => ({
  getUserAccessLevels: (...args: any[]) => mockGetUserAccessLevels(...args)
}))

function createRequest(): NextRequest {
  return new NextRequest('http://localhost/api/features/access-levels', {
    method: 'GET'
  })
}

describe('GET /api/features/access-levels', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    const { AuthError } = await import('@/app/lib/auth')
    mockRequireAuthForApi.mockRejectedValue(
      new AuthError('Unauthorized', 'UNAUTHENTICATED')
    )

    const { GET } = await import('@/app/api/features/access-levels/route')
    const response = await GET(createRequest())
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json.error.message).toBe('Unauthorized')
  })

  it('returns user access levels on success', async () => {
    const mockLevels = {
      isEarlyAccess: true,
      isPremium: false,
      isAlphaTester: true,
      subscriptionTier: 'free'
    }
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-123' } })
    mockGetUserAccessLevels.mockResolvedValue(mockLevels)

    const { GET } = await import('@/app/api/features/access-levels/route')
    const response = await GET(createRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual(mockLevels)
  })

  it('calls getUserAccessLevels with user id', async () => {
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-456' } })
    mockGetUserAccessLevels.mockResolvedValue({})

    const { GET } = await import('@/app/api/features/access-levels/route')
    await GET(createRequest())

    expect(mockGetUserAccessLevels).toHaveBeenCalledWith('user-456')
  })

  it('sets Cache-Control header for private caching', async () => {
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-123' } })
    mockGetUserAccessLevels.mockResolvedValue({})

    const { GET } = await import('@/app/api/features/access-levels/route')
    const response = await GET(createRequest())

    expect(response.headers.get('Cache-Control')).toBe('private, max-age=60')
  })

  it('returns 500 when getUserAccessLevels throws', async () => {
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-123' } })
    mockGetUserAccessLevels.mockRejectedValue(new Error('Service error'))

    const { GET } = await import('@/app/api/features/access-levels/route')
    const response = await GET(createRequest())
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Service error')
  })

  it('returns generic error message for non-Error exceptions', async () => {
    mockRequireAuthForApi.mockResolvedValue({ user: { id: 'user-123' } })
    mockGetUserAccessLevels.mockRejectedValue('String error')

    const { GET } = await import('@/app/api/features/access-levels/route')
    const response = await GET(createRequest())
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Internal error')
  })

  it('returns 500 when the auth boundary throws unexpectedly', async () => {
    mockRequireAuthForApi.mockRejectedValue(new Error('Auth error'))

    const { GET } = await import('@/app/api/features/access-levels/route')
    const response = await GET(createRequest())
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Auth error')
  })
})
