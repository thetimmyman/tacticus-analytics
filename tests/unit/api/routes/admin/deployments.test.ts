import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let mockDb: ReturnType<typeof vi.fn>
let mockReadFile: ReturnType<typeof vi.fn>

function createAdminProfileQuery(isAdmin: boolean) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { is_app_admin: isAdmin },
      error: null
    })
  }
}

async function loadRoute({ selfHosted }: { selfHosted: boolean }) {
  vi.resetModules()
  mockDb = vi.fn()
  mockReadFile = vi.fn().mockResolvedValue(
    JSON.stringify({
      version: '1.2.3',
      buildNumber: 42,
      lastUpdated: '2026-07-06T00:00:00.000Z'
    })
  )

  if (selfHosted) {
    process.env.DEPLOYMENT_MODE = 'self-hosted'
    delete process.env.NEXT_PUBLIC_DEPLOYMENT
  } else {
    delete process.env.DEPLOYMENT_MODE
    delete process.env.NEXT_PUBLIC_DEPLOYMENT
  }

  vi.doMock('@/app/lib/db', () => ({
    db: mockDb
  }))
  vi.doMock('fs/promises', () => ({
    default: { readFile: mockReadFile },
    readFile: mockReadFile
  }))

  return import('@/app/api/admin/deployments/route')
}

function createSupabase({
  user = { id: 'admin-1' },
  isAdmin = true
}: {
  user?: { id: string } | null
  isAdmin?: boolean
} = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } })
    },
    from: vi.fn().mockReturnValue(createAdminProfileQuery(isAdmin))
  }
}

describe('/api/admin/deployments', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    delete process.env.DEPLOYMENT_MODE
    delete process.env.NEXT_PUBLIC_DEPLOYMENT
  })

  // An anonymous 400 would reveal whether the deployment is self-hosted.
  it('GET rejects an unauthenticated caller before the availability check', async () => {
    const { GET } = await loadRoute({ selfHosted: false })
    mockDb.mockResolvedValue(createSupabase({ user: null }))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Unauthorized')
  })

  it('GET returns availability validation for an app admin off self-hosted', async () => {
    const { GET } = await loadRoute({ selfHosted: false })
    mockDb.mockResolvedValue(createSupabase())

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('self-hosted deployment')
  })

  it('POST rejects an unauthenticated caller before parsing the body', async () => {
    const { POST } = await loadRoute({ selfHosted: false })
    const json = vi.fn()
    mockDb.mockResolvedValue(createSupabase({ user: null }))

    const response = await POST({
      headers: new Headers(),
      url: 'http://localhost/api/admin/deployments',
      json
    } as unknown as NextRequest)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Unauthorized')
    expect(json).not.toHaveBeenCalled()
  })

  it('POST returns availability validation for an app admin off self-hosted', async () => {
    const { POST } = await loadRoute({ selfHosted: false })
    const json = vi.fn()
    mockDb.mockResolvedValue(createSupabase())

    const response = await POST({
      headers: new Headers(),
      url: 'http://localhost/api/admin/deployments',
      json
    } as unknown as NextRequest)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('self-hosted deployment')
    expect(json).not.toHaveBeenCalled()
  })

  it('GET returns 401 when self-hosted caller is unauthenticated', async () => {
    const { GET } = await loadRoute({ selfHosted: true })
    mockDb.mockResolvedValue(createSupabase({ user: null }))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Unauthorized')
  })

  it('GET returns 403 when self-hosted caller is not app admin', async () => {
    const { GET } = await loadRoute({ selfHosted: true })
    mockDb.mockResolvedValue(createSupabase({ isAdmin: false }))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('Admin access required')
  })

  it('GET returns disabled deployment-management payload for app admins', async () => {
    const { GET } = await loadRoute({ selfHosted: true })
    mockDb.mockResolvedValue(createSupabase())

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.current).toMatchObject({
      version: '1.2.3',
      buildNumber: 42
    })
    expect(body.selfHosted).toBe(true)
    expect(body.managementAvailable).toBe(false)
  })

  it('POST parses and validates actions only after app-admin auth', async () => {
    const { POST } = await loadRoute({ selfHosted: true })
    mockDb.mockResolvedValue(createSupabase())

    const response = await POST(
      new NextRequest('http://localhost/api/admin/deployments', {
        method: 'POST',
        body: JSON.stringify({ action: 'list' })
      })
    )
    const body = await response.json()

    expect(response.status).toBe(501)
    expect(body.error.message).toContain('disabled')
    expect(body.error.metadata.success).toBe(false)
    expect(body.error.metadata.action).toBe('list')
  })

  it('POST returns 401 before body parsing when self-hosted caller is unauthenticated', async () => {
    const { POST } = await loadRoute({ selfHosted: true })
    mockDb.mockResolvedValue(createSupabase({ user: null }))
    const json = vi.fn().mockRejectedValue(new Error('body should not parse'))

    const response = await POST({
      headers: new Headers(),
      url: 'http://localhost/api/admin/deployments',
      json
    } as unknown as NextRequest)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Unauthorized')
    expect(json).not.toHaveBeenCalled()
  })

  it('POST returns 403 before body parsing when self-hosted caller is not app admin', async () => {
    const { POST } = await loadRoute({ selfHosted: true })
    mockDb.mockResolvedValue(createSupabase({ isAdmin: false }))
    const json = vi.fn().mockRejectedValue(new Error('body should not parse'))

    const response = await POST({
      headers: new Headers(),
      url: 'http://localhost/api/admin/deployments',
      json
    } as unknown as NextRequest)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('Admin access required')
    expect(json).not.toHaveBeenCalled()
  })
})
