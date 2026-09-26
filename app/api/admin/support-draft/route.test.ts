import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
  const mockRequireRoleForApi = vi.fn()
  return {
    ...actual,
    requireRoleForApi: mockRequireRoleForApi,
    AuthError: actual.AuthError
  }
})

describe('POST /api/admin/support-draft', () => {
  let requireRoleForApi: ReturnType<typeof vi.fn>
  type JsonRequestBody = Record<string, string | number | boolean | null>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    const authModule = await import('@/app/lib/auth')
    requireRoleForApi = vi.mocked(authModule.requireRoleForApi)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createRequest(body: JsonRequestBody): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/support-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  it('rejects a member-role caller with 403', async () => {
    const { AuthError } = await import('@/app/lib/auth')
    requireRoleForApi.mockRejectedValue(
      new AuthError(
        'Insufficient permissions',
        'INSUFFICIENT_ROLE',
        'officer',
        'member'
      )
    )

    const { POST } = await import('./route')
    const response = await POST(
      createRequest({ question: 'How do tokens work?' })
    )

    expect(response.status).toBe(403)
  })

  it('allows an officer-role caller and returns a draft result shape', async () => {
    requireRoleForApi.mockResolvedValue({
      user: { id: 'officer-1', role: 'officer' }
    })

    const { POST } = await import('./route')
    const response = await POST(
      createRequest({ question: 'How does Token Tracking work?' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveProperty('answer')
    expect(body).toHaveProperty('sources')
    expect(body).toHaveProperty('confidence')
    expect(body).toHaveProperty('needsHandoff')
  })

  it('returns a validation error for a missing question field', async () => {
    requireRoleForApi.mockResolvedValue({
      user: { id: 'officer-1', role: 'officer' }
    })

    const { POST } = await import('./route')
    const response = await POST(createRequest({}))

    expect(response.status).toBe(400)
  })

  it('returns a validation error for a malformed JSON body', async () => {
    requireRoleForApi.mockResolvedValue({
      user: { id: 'officer-1', role: 'officer' }
    })

    const { POST } = await import('./route')
    const malformedRequest = new NextRequest(
      'http://localhost:3000/api/admin/support-draft',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json'
      }
    )
    const response = await POST(malformedRequest)

    expect(response.status).toBe(400)
  })
})
