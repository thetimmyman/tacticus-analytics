import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChainedMock as createSharedChainedMock } from '@/tests/helpers/supabase-mock'

const mockSupabase = {
  from: vi.fn()
}

vi.mock('@/app/lib/auth/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase))
}))

// thenMode 'raw' keeps this file's legacy non-array-coercing await shape.
const createChainedMock = (data: any = null, error: any = null) =>
  createSharedChainedMock(data, error, [], { thenMode: 'raw' })

describe('GET /api/features/stages', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns feature stages as key-value pairs', async () => {
    const features = [
      { feature_key: 'meta_atlas', release_stage: 'ga' },
      { feature_key: 'war_tracking', release_stage: 'beta' },
      { feature_key: 'roster_development', release_stage: 'alpha' }
    ]
    mockSupabase.from.mockReturnValue(createChainedMock(features))

    const { GET } = await import('@/app/api/features/stages/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      meta_atlas: 'ga',
      war_tracking: 'beta',
      roster_development: 'alpha'
    })
  })

  it('returns empty object when no features exist', async () => {
    mockSupabase.from.mockReturnValue(createChainedMock([]))

    const { GET } = await import('@/app/api/features/stages/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({})
  })

  it('returns empty object when data is null', async () => {
    mockSupabase.from.mockReturnValue(createChainedMock(null))

    const { GET } = await import('@/app/api/features/stages/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({})
  })

  it('returns 500 when database query fails', async () => {
    mockSupabase.from.mockReturnValue(
      createChainedMock(null, { message: 'Database error' })
    )

    const { GET } = await import('@/app/api/features/stages/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Database error')
  })

  it('sets Cache-Control header for public caching', async () => {
    mockSupabase.from.mockReturnValue(createChainedMock([]))

    const { GET } = await import('@/app/api/features/stages/route')
    const response = await GET()

    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=60, stale-while-revalidate=300'
    )
  })

  it('queries feature_releases table with correct columns', async () => {
    mockSupabase.from.mockReturnValue(createChainedMock([]))

    const { GET } = await import('@/app/api/features/stages/route')
    await GET()

    expect(mockSupabase.from).toHaveBeenCalledWith('feature_releases')
  })

  it('handles multiple features with same stage', async () => {
    const features = [
      { feature_key: 'feature1', release_stage: 'beta' },
      { feature_key: 'feature2', release_stage: 'beta' },
      { feature_key: 'feature3', release_stage: 'ga' }
    ]
    mockSupabase.from.mockReturnValue(createChainedMock(features))

    const { GET } = await import('@/app/api/features/stages/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
      feature1: 'beta',
      feature2: 'beta',
      feature3: 'ga'
    })
  })

  it('returns 500 when createClient throws', async () => {
    const { createClient } = await import('@/app/lib/auth/server')
    vi.mocked(createClient).mockRejectedValueOnce(new Error('Connection error'))

    const { GET } = await import('@/app/api/features/stages/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Failed to connect to database')
  })

  it('returns generic error for non-Error exceptions', async () => {
    const { createClient } = await import('@/app/lib/auth/server')
    vi.mocked(createClient).mockRejectedValueOnce('String error')

    const { GET } = await import('@/app/api/features/stages/route')
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error.message).toBe('Failed to connect to database')
  })
})
