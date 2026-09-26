import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('GET /api/boss/identifiers', () => {
  let GET: () => Promise<Response>
  let mockCreateClient: ReturnType<typeof vi.fn>
  let mockLogger: { error: ReturnType<typeof vi.fn> }
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockLogger = { error: vi.fn() }

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))
    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: vi.fn(() => mockLogger),
      logError: vi.fn(),
      generateRequestId: vi.fn(() => 'test-request-id'),
      logger: mockLogger
    }))

    mockSupabase = {
      from: vi.fn()
    }
    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/boss/identifiers/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns boss identifiers and count', async () => {
    const bosses = [
      {
        id: 1,
        unit_id: 'boss-1',
        boss_type: 'Legendary',
        boss_name: 'Test Boss',
        encounter_index: 1,
        icon_path: null,
        portrait_path: null,
        thumbnail_path: null,
        map_display_name: 'Test Boss',
        asset_slug: 'test-boss'
      }
    ]

    const orderMock = vi.fn().mockResolvedValue({ data: bosses, error: null })
    const notMock = vi.fn().mockReturnValue({ order: orderMock })
    const selectMock = vi.fn().mockReturnValue({ not: notMock })
    mockSupabase.from.mockReturnValue({ select: selectMock })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.bosses).toEqual(bosses)
    expect(body.count).toBe(1)
    expect(mockSupabase.from).toHaveBeenCalledWith('boss_mapping')
    expect(notMock).toHaveBeenCalledWith('unit_id', 'is', null)
    expect(orderMock).toHaveBeenCalledWith('boss_type')
  })

  it('returns 500 when the query fails', async () => {
    const error = new Error('Query failed')
    const orderMock = vi.fn().mockResolvedValue({ data: null, error })
    const notMock = vi.fn().mockReturnValue({ order: orderMock })
    const selectMock = vi.fn().mockReturnValue({ not: notMock })
    mockSupabase.from.mockReturnValue({ select: selectMock })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toContain('Failed to fetch boss identifie')
    expect(body.error.metadata?.bosses).toEqual([])
    expect(mockLogger.error).toHaveBeenCalledWith(
      { error },
      'Boss identifiers error'
    )
  })
})
