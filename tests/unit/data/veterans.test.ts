import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  db: vi.fn()
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

describe('Veterans Data Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('getVeteranStats', () => {
    it('should throw error when guild code is empty', async () => {
      const { getVeteranStats } = await import('@/app/lib/data/veterans')
      await expect(getVeteranStats('')).rejects.toThrow(
        'Guild code is required'
      )
    })

    it('should return veterans from RPC when available', async () => {
      const mockSeasons = [
        { Season: '85' },
        { Season: '84' },
        { Season: '83' },
        { Season: '82' },
        { Season: '81' },
        { Season: '80' }
      ]
      const mockVeterans = [
        {
          display_name: 'Veteran One',
          seasons: ['85', '84', '83', '82', '81']
        },
        { display_name: 'Veteran Two', seasons: ['85', '84', '83', '82', '81'] }
      ]

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue({ data: mockSeasons, error: null })
            })
          })
        }),
        rpc: vi.fn().mockResolvedValue({ data: mockVeterans, error: null })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getVeteranStats } = await import('@/app/lib/data/veterans')
      const result = await getVeteranStats('TEST')

      expect(result.count).toBe(2)
      expect(result.seasons).toHaveLength(5)
      expect(result.players).toContain('Veteran One')
      expect(result.players).toContain('Veteran Two')
    })

    it('should return empty when less than 5 seasons available', async () => {
      const mockSeasons = [{ Season: '83' }, { Season: '82' }, { Season: '81' }]

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi
                  .fn()
                  .mockResolvedValue({ data: mockSeasons, error: null })
              })
            })
          })
        }),
        rpc: vi
          .fn()
          .mockResolvedValue({ data: null, error: new Error('No RPC') })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getVeteranStats } = await import('@/app/lib/data/veterans')
      const result = await getVeteranStats('TEST')

      expect(result.count).toBe(0)
      expect(result.seasons).toHaveLength(3)
      expect(result.players).toEqual([])
    })

    it('should fallback to manual calculation when RPC fails', async () => {
      const mockSeasons = [
        { Season: '85' },
        { Season: '84' },
        { Season: '83' },
        { Season: '82' },
        { Season: '81' }
      ]

      const createSeasonPlayersResponse = (seasonIndex: number) => {
        const allPlayers = [
          { displayName: 'Player One' },
          { displayName: 'Player Two' },
          { displayName: 'Player Three' }
        ]
        if (seasonIndex < 5) {
          return { data: allPlayers, error: null }
        }
        return { data: allPlayers.slice(0, 2), error: null }
      }

      let seasonQueryCount = 0
      const mockSupabase = {
        from: vi.fn().mockImplementation(() => ({
          select: vi.fn().mockImplementation((fields: string) => {
            if (fields === 'Season') {
              return {
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi
                      .fn()
                      .mockResolvedValue({ data: mockSeasons, error: null })
                  })
                })
              }
            }
            if (fields === 'displayName') {
              return {
                eq: vi.fn().mockImplementation(() => ({
                  eq: vi.fn().mockImplementation(() => ({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockImplementation(() => {
                        const response =
                          createSeasonPlayersResponse(seasonQueryCount)
                        seasonQueryCount++
                        return Promise.resolve(response)
                      })
                    })
                  }))
                }))
              }
            }
            return { eq: vi.fn() }
          })
        })),
        rpc: vi
          .fn()
          .mockResolvedValue({ data: null, error: new Error('RPC not found') })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getVeteranStats } = await import('@/app/lib/data/veterans')
      const result = await getVeteranStats('TEST')

      expect(result.seasons).toHaveLength(5)
      expect(Array.isArray(result.players)).toBe(true)
    })

    it('should throw error when seasons fetch fails', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: null,
                  error: new Error('Database error')
                })
              })
            })
          })
        }),
        rpc: vi
          .fn()
          .mockResolvedValue({ data: null, error: new Error('No RPC') })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getVeteranStats } = await import('@/app/lib/data/veterans')
      await expect(getVeteranStats('TEST')).rejects.toThrow(
        'Failed to fetch seasons'
      )
    })

    it('should sort seasons in descending order', async () => {
      const mockSeasons = [
        { Season: '81' },
        { Season: '85' },
        { Season: '83' },
        { Season: '82' },
        { Season: '84' },
        { Season: '80' }
      ]
      const mockVeterans = [
        { display_name: 'Vet', seasons: ['85', '84', '83', '82', '81'] }
      ]

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue({ data: mockSeasons, error: null })
            })
          })
        }),
        rpc: vi.fn().mockResolvedValue({ data: mockVeterans, error: null })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getVeteranStats } = await import('@/app/lib/data/veterans')
      const result = await getVeteranStats('TEST')

      expect(result.seasons).toEqual(['85', '84', '83', '82', '81'])
    })

    it('should filter out null seasons', async () => {
      const mockSeasons = [
        { Season: '85' },
        { Season: null },
        { Season: '84' },
        { Season: '83' },
        { Season: '82' },
        { Season: '81' }
      ]
      const mockVeterans = [
        { display_name: 'Vet', seasons: ['85', '84', '83', '82', '81'] }
      ]

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue({ data: mockSeasons, error: null })
            })
          })
        }),
        rpc: vi.fn().mockResolvedValue({ data: mockVeterans, error: null })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getVeteranStats } = await import('@/app/lib/data/veterans')
      const result = await getVeteranStats('TEST')

      expect(result.seasons).not.toContain(null)
    })

    it('should handle displayName field in RPC response', async () => {
      const mockSeasons = [
        { Season: '85' },
        { Season: '84' },
        { Season: '83' },
        { Season: '82' },
        { Season: '81' }
      ]
      const mockVeterans = [
        {
          display_name: 'Veteran Via DisplayName',
          seasons: ['85', '84', '83', '82', '81']
        }
      ]

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue({ data: mockSeasons, error: null })
            })
          })
        }),
        rpc: vi.fn().mockResolvedValue({ data: mockVeterans, error: null })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getVeteranStats } = await import('@/app/lib/data/veterans')
      const result = await getVeteranStats('TEST')

      expect(result.players).toContain('Veteran Via DisplayName')
    })
  })

  describe('getDetailedVeteranStats', () => {
    it('should return empty when less than 2 seasons', async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: [{ display_name: 'Player One', seasons: ['85'] }],
          error: null
        })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getDetailedVeteranStats } =
        await import('@/app/lib/data/veterans')
      const result = await getDetailedVeteranStats('TEST')

      expect(result.participationBySeasons).toEqual([])
      expect(result.retentionRate).toBe(0)
    })

    it('should calculate participation by season counts', async () => {
      const mockPlayers = [
        { displayName: 'Player One' },
        { displayName: 'Player Two' },
        { displayName: 'Player Three' }
      ]

      const mockVeterans = [
        { display_name: 'Player One', seasons: ['85', '84', '83', '82', '81'] },
        { display_name: 'Player Two', seasons: ['85', '84', '83', '82', '81'] }
      ]

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockImplementation(() => {
            return {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi
                      .fn()
                      .mockResolvedValue({ data: mockPlayers, error: null })
                  })
                })
              })
            }
          })
        }),
        rpc: vi.fn().mockResolvedValue({ data: mockVeterans, error: null })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getDetailedVeteranStats } =
        await import('@/app/lib/data/veterans')
      const result = await getDetailedVeteranStats('TEST')

      expect(result.veterans.count).toBe(2)
      expect(result.participationBySeasons.length).toBeGreaterThan(0)
      expect(typeof result.retentionRate).toBe('number')
    })

    it('should calculate retention rate correctly', async () => {
      const mockSeasons = [{ Season: '85' }, { Season: '84' }]

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockImplementation((fields: string) => {
            if (fields === 'Season') {
              return {
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi
                      .fn()
                      .mockResolvedValue({ data: mockSeasons, error: null })
                  })
                })
              }
            }
            return {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: [{ displayName: 'P1' }, { displayName: 'P2' }],
                      error: null
                    })
                  })
                })
              })
            }
          })
        }),
        rpc: vi
          .fn()
          .mockResolvedValue({ data: null, error: new Error('No RPC') })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getDetailedVeteranStats } =
        await import('@/app/lib/data/veterans')
      const result = await getDetailedVeteranStats('TEST')

      expect(typeof result.retentionRate).toBe('number')
      expect(result.retentionRate).toBeGreaterThanOrEqual(0)
    })
  })
})
