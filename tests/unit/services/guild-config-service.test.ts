import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'

vi.mock('@tacticus/app-core/unified-cache', () => ({
  mainCache: {
    getOrFetch: vi.fn((key, fetchFn, options) => fetchFn()),
    invalidate: vi.fn(() => 1)
  }
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

import { mainCache } from '@tacticus/app-core/unified-cache'

const createMockSupabase = (mockData: any = null, mockError: any = null) =>
  ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: mockData, error: mockError }),
          order: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: mockData, error: mockError })
          })),
          eq: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: mockData, error: mockError })
          }))
        }))
      }))
    }))
  }) as any

describe('GuildConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getBasic', () => {
    it('should get basic guild config through cache', async () => {
      const mockConfig = {
        guild_code: 'TEST',
        display_name: 'Test Guild',
        enabled: true,
        cluster_code: 'EOT',
        cluster_id: 'cluster-1',
        is_active: true
      }
      const mockSupabase = createMockSupabase(mockConfig)

      const result = await GuildConfigService.getBasic(mockSupabase, 'test')

      expect(result).toEqual(mockConfig)
      expect(mainCache.getOrFetch).toHaveBeenCalledWith(
        expect.stringContaining('guild_config:basic:TEST'),
        expect.any(Function),
        expect.objectContaining({ priority: 'medium' })
      )
    })

    it('should normalize guild code to uppercase', async () => {
      const mockSupabase = createMockSupabase(null)

      await GuildConfigService.getBasic(mockSupabase, '  test  ')

      expect(mainCache.getOrFetch).toHaveBeenCalledWith(
        expect.stringContaining('TEST'),
        expect.any(Function),
        expect.any(Object)
      )
    })

    it('should return null for non-existent guild', async () => {
      const mockSupabase = createMockSupabase(null)

      const result = await GuildConfigService.getBasic(mockSupabase, 'NOTFOUND')

      expect(result).toBeNull()
    })
  })

  describe('exists', () => {
    it('should return true when guild exists', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 1, error: null })
          }))
        }))
      } as any

      const result = await GuildConfigService.exists(mockSupabase, 'TEST')

      expect(result).toBe(true)
    })

    it('should return false when guild does not exist', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 0, error: null })
          }))
        }))
      } as any

      const result = await GuildConfigService.exists(mockSupabase, 'NOTFOUND')

      expect(result).toBe(false)
    })
  })

  describe('isEnabled', () => {
    it('should return true for enabled and active guild', async () => {
      const mockConfig = {
        guild_code: 'TEST',
        display_name: 'Test Guild',
        enabled: true,
        cluster_code: 'EOT',
        cluster_id: 'cluster-1',
        is_active: true
      }
      const mockSupabase = createMockSupabase(mockConfig)

      const result = await GuildConfigService.isEnabled(mockSupabase, 'TEST')

      expect(result).toBe(true)
    })

    it('should return false for disabled guild', async () => {
      const mockConfig = {
        guild_code: 'TEST',
        display_name: 'Test Guild',
        enabled: false,
        cluster_code: 'EOT',
        cluster_id: 'cluster-1',
        is_active: true
      }
      const mockSupabase = createMockSupabase(mockConfig)

      const result = await GuildConfigService.isEnabled(mockSupabase, 'TEST')

      expect(result).toBe(false)
    })
  })

  describe('getClusterGuilds', () => {
    it('should get all guilds in cluster through cache', async () => {
      const mockGuilds = [
        {
          guild_code: 'GUILD1',
          display_name: 'Guild 1',
          enabled: true,
          cluster_code: 'EOT',
          cluster_id: 'c1',
          is_active: true
        },
        {
          guild_code: 'GUILD2',
          display_name: 'Guild 2',
          enabled: true,
          cluster_code: 'EOT',
          cluster_id: 'c1',
          is_active: true
        }
      ]
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi
                  .fn()
                  .mockResolvedValue({ data: mockGuilds, error: null })
              }))
            }))
          }))
        }))
      } as any

      const result = await GuildConfigService.getClusterGuilds(
        mockSupabase,
        'eot'
      )

      expect(result).toHaveLength(2)
      expect(mainCache.getOrFetch).toHaveBeenCalledWith(
        expect.stringContaining('guild_config:cluster_guilds:EOT'),
        expect.any(Function),
        expect.any(Object)
      )
    })
  })

  describe('invalidation', () => {
    it('should invalidate guild-specific cache', () => {
      const evicted = GuildConfigService.invalidateGuild('test')
      expect(mainCache.invalidate).toHaveBeenCalledWith(undefined, 'TEST')
      expect(evicted).toBe(1)
    })

    it('should invalidate cluster cache', () => {
      const evicted = GuildConfigService.invalidateCluster('eot')
      expect(mainCache.invalidate).toHaveBeenCalledWith(undefined, 'EOT')
      expect(evicted).toBe(1)
    })

    it('should invalidate all guild config caches', () => {
      const evicted = GuildConfigService.invalidateAll()
      expect(mainCache.invalidate).toHaveBeenCalledWith(
        undefined,
        'guild_config'
      )
      expect(evicted).toBe(1)
    })
  })

  describe('normalizeCode', () => {
    it('should normalize guild codes to uppercase', () => {
      expect(GuildConfigService.normalizeCode('test')).toBe('TEST')
      expect(GuildConfigService.normalizeCode('  Test  ')).toBe('TEST')
      expect(GuildConfigService.normalizeCode('TEST')).toBe('TEST')
    })
  })
})
