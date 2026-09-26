import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useFeatureStage Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('useFeatureStages', () => {
    it('should fetch feature stages from API', async () => {
      const mockStages = {
        'guild-war': 'beta',
        'meta-atlas': 'ga'
      }

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStages)
      } as Response)

      const { useFeatureStages } =
        await import('@/app/lib/hooks/useFeatureStage')
      const { result } = renderHook(() => useFeatureStages(), {
        wrapper: createWrapper()
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual(mockStages)
      expect(global.fetch).toHaveBeenCalledWith('/api/features/stages')
    })

    it('should handle fetch error', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500
      } as Response)

      const { useFeatureStages } =
        await import('@/app/lib/hooks/useFeatureStage')
      const { result } = renderHook(() => useFeatureStages(), {
        wrapper: createWrapper()
      })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error).toBeDefined()
    })

    it('should have 5 minute stale time', async () => {
      const mockStages = { 'test-feature': 'ga' }

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStages)
      } as Response)

      const { useFeatureStages } =
        await import('@/app/lib/hooks/useFeatureStage')
      const { result } = renderHook(() => useFeatureStages(), {
        wrapper: createWrapper()
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(global.fetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('useFeatureStage', () => {
    it('should return specific feature stage', async () => {
      const mockStages = {
        'guild-war': 'beta'
      }

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStages)
      } as Response)

      const { useFeatureStage } =
        await import('@/app/lib/hooks/useFeatureStage')
      const { result } = renderHook(() => useFeatureStage('guild-war'), {
        wrapper: createWrapper()
      })

      await waitFor(() => {
        expect(result.current).toBe('beta')
      })
    })

    it('should return undefined for unknown feature', async () => {
      const mockStages = {
        'guild-war': 'beta'
      }

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStages)
      } as Response)

      const { useFeatureStage } =
        await import('@/app/lib/hooks/useFeatureStage')
      const { result } = renderHook(() => useFeatureStage('unknown-feature'), {
        wrapper: createWrapper()
      })

      await waitFor(() => {
        expect(result.current).toBeUndefined()
      })
    })

    it('should return undefined while loading', async () => {
      let resolvePromise: (value: unknown) => void
      const fetchPromise = new Promise((resolve) => {
        resolvePromise = resolve
      })

      vi.mocked(global.fetch).mockReturnValueOnce(
        fetchPromise as Promise<Response>
      )

      const { useFeatureStage } =
        await import('@/app/lib/hooks/useFeatureStage')
      const { result } = renderHook(() => useFeatureStage('guild-war'), {
        wrapper: createWrapper()
      })

      expect(result.current).toBeUndefined()

      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ 'guild-war': 'ga' })
      })

      await waitFor(() => {
        expect(result.current).toBe('ga')
      })
    })

    it('should handle different release stages', async () => {
      const mockStages = {
        'feature-alpha': 'alpha',
        'feature-beta': 'beta',
        'feature-ga': 'ga',
        'feature-internal': 'internal'
      }

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStages)
      } as Response)

      const { useFeatureStages } =
        await import('@/app/lib/hooks/useFeatureStage')
      const { result } = renderHook(() => useFeatureStages(), {
        wrapper: createWrapper()
      })

      await waitFor(() => {
        expect(result.current.data).toEqual(mockStages)
      })

      expect(result.current.data?.['feature-alpha']).toBe('alpha')
      expect(result.current.data?.['feature-beta']).toBe('beta')
      expect(result.current.data?.['feature-ga']).toBe('ga')
      expect(result.current.data?.['feature-internal']).toBe('internal')
    })
  })
})
