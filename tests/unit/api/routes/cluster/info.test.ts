import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock
} from 'vitest'

// vitest 5 types a bare vi.fn() as function-or-constructor; these mocks are called.
type AnyMock = Mock<(...args: any[]) => any>
import { NextRequest } from 'next/server'

function createRequest(clusterCode?: string): NextRequest {
  const url = clusterCode
    ? `http://localhost/api/cluster/info?code=${clusterCode}`
    : 'http://localhost/api/cluster/info'
  return new NextRequest(url, { method: 'GET' })
}

describe('GET /api/cluster/info', () => {
  let GET: (req: NextRequest) => Promise<Response>
  let mockRequireRole: AnyMock
  let mockFetchClusterDetails: AnyMock

  beforeEach(async () => {
    vi.resetModules()
    mockRequireRole = vi.fn()
    mockFetchClusterDetails = vi.fn()

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      }
    }))
    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireRole: mockRequireRole,
        requireRoleForApi: mockRequireRole
      }
    })
    vi.doMock('@/app/lib/services/guild-settings-service', () => ({
      fetchClusterDetails: (...args: any[]) => mockFetchClusterDetails(...args)
    }))

    const routeModule = await import('@/app/api/cluster/info/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 400 when cluster code is missing', async () => {
    const response = await GET(createRequest())
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(json.error.message).toBe('Missing cluster code')
  })

  it('returns 400 when cluster code is empty', async () => {
    const response = await GET(createRequest(''))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(json.error.message).toBe('Missing cluster code')
  })

  it('returns 500 when requireRole throws (unauthorized)', async () => {
    mockRequireRole.mockRejectedValue(new Error('Unauthorized'))

    const response = await GET(createRequest('CLUSTER1'))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error).toBeDefined()
    expect(json.error.message).toBe('An unexpected error occurred')
  })

  it('returns 500 when fetchClusterDetails throws', async () => {
    mockRequireRole.mockResolvedValue({ user: { id: 'user-1' } })
    mockFetchClusterDetails.mockRejectedValue(new Error('Database error'))

    const response = await GET(createRequest('CLUSTER1'))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error).toBeDefined()
    expect(json.error.message).toBe('An unexpected error occurred')
  })

  it('returns cluster data successfully', async () => {
    const mockCluster = {
      cluster_code: 'CLUSTER1',
      display_name: 'Test Cluster',
      description: 'A test cluster',
      guilds: [{ guild_code: 'GUILD1', display_name: 'Guild One' }]
    }
    mockRequireRole.mockResolvedValue({ user: { id: 'user-1' } })
    mockFetchClusterDetails.mockResolvedValue(mockCluster)

    const response = await GET(createRequest('CLUSTER1'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(mockCluster)
  })

  it('calls requireRole with officer', async () => {
    mockRequireRole.mockResolvedValue({ user: { id: 'user-1' } })
    mockFetchClusterDetails.mockResolvedValue({ cluster_code: 'CLUSTER1' })

    await GET(createRequest('CLUSTER1'))

    expect(mockRequireRole).toHaveBeenCalledWith('officer')
  })

  it('passes cluster code to fetchClusterDetails', async () => {
    mockRequireRole.mockResolvedValue({ user: { id: 'user-1' } })
    mockFetchClusterDetails.mockResolvedValue({ cluster_code: 'MYCODE' })

    await GET(createRequest('MYCODE'))

    expect(mockFetchClusterDetails).toHaveBeenCalledWith('MYCODE')
  })

  it('returns null data when cluster not found', async () => {
    mockRequireRole.mockResolvedValue({ user: { id: 'user-1' } })
    mockFetchClusterDetails.mockResolvedValue(null)

    const response = await GET(createRequest('UNKNOWN'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toBeNull()
  })
})
