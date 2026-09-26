import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolvePlayerIdentity } from '@/app/lib/player-stats/resolve-player-identity'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

function createMockSupabase(mappingResult: any, allMappingsResult?: any) {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const chainable = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: mappingResult, error: null })
  }

  let callCount = 0
  return {
    from: vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return chainable
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({
          data: allMappingsResult ?? [],
          error: null
        })
      }
    })
  } as any // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolvePlayerIdentity', () => {
  it('returns playerId and all historical display names when found', async () => {
    const supabase = createMockSupabase({ player_id: 'pid-123' }, [
      { display_name: 'OldName' },
      { display_name: 'CurrentName' }
    ])

    const result = await resolvePlayerIdentity(
      supabase,
      'CurrentName',
      'GUILD1'
    )
    expect(result.playerId).toBe('pid-123')
    expect(result.displayNames).toContain('OldName')
    expect(result.displayNames).toContain('CurrentName')
  })

  it('returns null playerId and [playerName] when not found', async () => {
    const supabase = createMockSupabase(null)

    const result = await resolvePlayerIdentity(supabase, 'Unknown', 'GUILD1')
    expect(result.playerId).toBeNull()
    expect(result.displayNames).toEqual(['Unknown'])
  })

  it('deduplicates display names', async () => {
    const supabase = createMockSupabase({ player_id: 'pid-123' }, [
      { display_name: 'Same' },
      { display_name: 'Same' },
      { display_name: 'Other' }
    ])

    const result = await resolvePlayerIdentity(supabase, 'Same', 'GUILD1')
    expect(result.displayNames).toEqual(['Same', 'Other'])
  })

  it('returns [playerName] on query error (graceful degradation)', async () => {
    const supabase = {
      from: vi.fn().mockImplementation(() => {
        throw new Error('DB connection failed')
      })
    } as any // eslint-disable-line @typescript-eslint/no-explicit-any

    const result = await resolvePlayerIdentity(supabase, 'Player1', 'GUILD1')
    expect(result.playerId).toBeNull()
    expect(result.displayNames).toEqual(['Player1'])
  })
})
