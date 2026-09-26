/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSupabase, mockGuildConfigService, loggerErrorMock } = vi.hoisted(
  () => ({
    mockSupabase: {
      from: vi.fn(),
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn()
    },
    mockGuildConfigService: {
      getBasic: vi.fn()
    },
    loggerErrorMock: vi.fn()
  })
)

vi.mock('@/app/lib/auth/server', () => ({
  createClient: vi.fn(() => mockSupabase)
}))

vi.mock('@/app/lib/services/guild-config-service', () => ({
  GuildConfigService: mockGuildConfigService
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    error: loggerErrorMock
  })
}))

import {
  getClusterInfo,
  getClusterInfoFromProfile
} from '@/app/lib/utils/cluster'

describe('Cluster Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSupabase.from.mockReturnValue(mockSupabase)
    mockSupabase.select.mockReturnValue(mockSupabase)
    mockSupabase.eq.mockReturnValue(mockSupabase)
  })

  describe('getClusterInfo', () => {
    it('returns cluster info when found', async () => {
      mockGuildConfigService.getBasic.mockResolvedValueOnce({
        cluster_id: 'c1'
      })
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          display_name: 'Custom Cluster',
          short_name: 'CC',
          description: 'Desc'
        },
        error: null
      })

      const result = await getClusterInfo('G1')

      expect(result).toEqual({
        display_name: 'Custom Cluster',
        short_name: 'CC',
        description: 'Desc'
      })
    })

    it('returns fallback when guild config has no cluster_id', async () => {
      mockGuildConfigService.getBasic.mockResolvedValueOnce({
        cluster_id: null
      })

      const result = await getClusterInfo('G1')

      expect(result.short_name).toBe('TA')
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('returns fallback when cluster not found', async () => {
      mockGuildConfigService.getBasic.mockResolvedValueOnce({
        cluster_id: 'c1'
      })
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' }
      })

      const result = await getClusterInfo('G1')

      expect(result.short_name).toBe('TA')
    })

    it('returns fallback on error', async () => {
      mockGuildConfigService.getBasic.mockRejectedValue(new Error('DB Error'))

      const result = await getClusterInfo('G1')

      expect(result.short_name).toBe('TA')

      expect(loggerErrorMock).toHaveBeenCalled()
    })
  })

  describe('getClusterInfoFromProfile', () => {
    it('calls getClusterInfo with guild code', async () => {
      mockGuildConfigService.getBasic.mockResolvedValueOnce({
        cluster_id: 'c1'
      })
      mockSupabase.single.mockResolvedValueOnce({
        data: { display_name: 'Test', short_name: 'T', description: 'D' },
        error: null
      })

      const result = await getClusterInfoFromProfile({ guild_code: 'G1' })

      expect(result.short_name).toBe('T')
    })

    it('returns fallback if profile has no guild code', async () => {
      const result = await getClusterInfoFromProfile({})
      expect(result.short_name).toBe('TA')
    })

    it('returns fallback if profile is null', async () => {
      const result = await getClusterInfoFromProfile(null)
      expect(result.short_name).toBe('TA')
    })
  })
})
