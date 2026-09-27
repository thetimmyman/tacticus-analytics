import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createClient, createServiceClient } from '@/app/lib/auth/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn()
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn()
}))

vi.mock('@tacticus/app-core/server-env', () => ({
  serverEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_INTERNAL_URL: 'http://supabase-kong:8000'
  }
}))

describe('Auth Server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createClient', () => {
    it('creates client with cookie handling in request context', async () => {
      const mockCookieStore = {
        getAll: vi.fn().mockReturnValue([{ name: 'test', value: '123' }]),
        set: vi.fn()
      }
      vi.mocked(cookies).mockResolvedValue(mockCookieStore as any)

      await createClient()

      expect(createServerClient).toHaveBeenCalledWith(
        'http://supabase-kong:8000',
        'anon-key',
        expect.objectContaining({
          cookies: expect.objectContaining({
            getAll: expect.any(Function),
            setAll: expect.any(Function)
          })
        })
      )

      const call = vi.mocked(createServerClient).mock.calls[0]
      const cookieOptions = call[2]?.cookies

      expect(cookieOptions?.getAll()).toEqual([{ name: 'test', value: '123' }])

      cookieOptions?.setAll?.([{ name: 'new', value: '456', options: {} }], {})
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'new',
        '456',
        expect.any(Object)
      )
    })

    it('creates fallback client when outside request context', async () => {
      vi.mocked(cookies).mockRejectedValue(new Error('Outside request context'))

      await createClient()

      expect(createServerClient).toHaveBeenCalledWith(
        'http://supabase-kong:8000',
        'anon-key',
        expect.objectContaining({
          cookies: expect.objectContaining({
            getAll: expect.any(Function),
            setAll: expect.any(Function)
          })
        })
      )

      const call = vi.mocked(createServerClient).mock.calls[0]
      const cookieOptions = call[2]?.cookies

      expect(cookieOptions?.getAll()).toEqual([])
      expect(() => cookieOptions?.setAll?.([], {})).not.toThrow()
    })
  })

  describe('createServiceClient', () => {
    it('creates service client with correct key', () => {
      createServiceClient()

      expect(createServerClient).toHaveBeenCalledWith(
        'http://supabase-kong:8000',
        'service-key',
        expect.objectContaining({
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        })
      )
    })
  })
})
