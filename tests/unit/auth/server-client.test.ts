import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const SUPABASE_PUBLIC_URL = 'https://api.tacticusanalytics.com'
const SUPABASE_INTERNAL_URL = 'http://supabase-kong:8000'
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const sharedFetch = vi.hoisted(() => vi.fn())

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn()
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn()
}))

vi.mock('@/app/lib/network/undici-agent', () => ({
  getSharedFetch: () => sharedFetch
}))

vi.mock('@tacticus/app-core/server-env', () => ({
  serverEnv: {
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_PUBLIC_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_INTERNAL_URL: SUPABASE_INTERNAL_URL
  }
}))

describe('Auth Server Client', () => {
  let createServerClient: ReturnType<typeof vi.fn>
  let cookies: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    sharedFetch.mockResolvedValue(new Response())

    const ssr = await import('@supabase/ssr')
    const headers = await import('next/headers')

    createServerClient = vi.mocked(ssr.createServerClient)
    cookies = vi.mocked(headers.cookies)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createClient', () => {
    it('creates client with cookie handlers when cookies are available', async () => {
      const mockCookieStore = {
        getAll: vi
          .fn()
          .mockReturnValue([{ name: 'sb-token', value: 'test-token' }]),
        set: vi.fn()
      }

      cookies.mockResolvedValue(mockCookieStore)
      createServerClient.mockReturnValue({ auth: {} })

      const { createClient } = await import('@/app/lib/auth/server')
      const client = await createClient()

      expect(createServerClient).toHaveBeenCalledWith(
        SUPABASE_INTERNAL_URL,
        SUPABASE_ANON_KEY,
        expect.objectContaining({
          cookies: expect.objectContaining({
            getAll: expect.any(Function),
            setAll: expect.any(Function)
          })
        })
      )
      expect(client).toBeDefined()
    })

    it('uses internal URL instead of public URL to avoid DNS issues', async () => {
      const mockCookieStore = {
        getAll: vi.fn().mockReturnValue([]),
        set: vi.fn()
      }

      cookies.mockResolvedValue(mockCookieStore)
      createServerClient.mockReturnValue({ auth: {} })

      const { createClient } = await import('@/app/lib/auth/server')
      await createClient()

      const callArgs = createServerClient.mock.calls[0]
      expect(callArgs[0]).toBe(SUPABASE_INTERNAL_URL)
      expect(callArgs[0]).not.toBe(SUPABASE_PUBLIC_URL)
    })

    it('cookie getAll returns all cookies from store', async () => {
      const mockCookies = [
        { name: 'cookie1', value: 'value1' },
        { name: 'cookie2', value: 'value2' }
      ]

      const mockCookieStore = {
        getAll: vi.fn().mockReturnValue(mockCookies),
        set: vi.fn()
      }

      cookies.mockResolvedValue(mockCookieStore)

      let capturedCookieConfig: {
        getAll: () => { name: string; value: string }[]
        setAll: (
          cookies: { name: string; value: string; options?: object }[]
        ) => void
      } | null = null
      createServerClient.mockImplementation((_url, _key, config) => {
        capturedCookieConfig = config.cookies
        return { auth: {} }
      })

      const { createClient } = await import('@/app/lib/auth/server')
      await createClient()

      expect(capturedCookieConfig).not.toBeNull()
      const result = capturedCookieConfig!.getAll()
      expect(result).toEqual(mockCookies)
    })

    it('cookie setAll sets multiple cookies', async () => {
      const mockCookieStore = {
        getAll: vi.fn().mockReturnValue([]),
        set: vi.fn()
      }

      cookies.mockResolvedValue(mockCookieStore)

      let capturedCookieConfig: {
        getAll: () => unknown[]
        setAll: (
          cookies: { name: string; value: string; options?: object }[]
        ) => void
      } | null = null
      createServerClient.mockImplementation((_url, _key, config) => {
        capturedCookieConfig = config.cookies
        return { auth: {} }
      })

      const { createClient } = await import('@/app/lib/auth/server')
      await createClient()

      expect(capturedCookieConfig).not.toBeNull()

      const cookiesToSet = [
        { name: 'test1', value: 'val1', options: { httpOnly: true } },
        { name: 'test2', value: 'val2', options: { secure: true } }
      ]

      capturedCookieConfig!.setAll(cookiesToSet)

      expect(mockCookieStore.set).toHaveBeenCalledTimes(2)
      expect(mockCookieStore.set).toHaveBeenNthCalledWith(
        1,
        'test1',
        'val1',
        expect.objectContaining({ httpOnly: true })
      )
      expect(mockCookieStore.set).toHaveBeenNthCalledWith(
        2,
        'test2',
        'val2',
        expect.objectContaining({ secure: true })
      )
    })

    it('silently handles setAll errors from Server Components', async () => {
      const mockCookieStore = {
        getAll: vi.fn().mockReturnValue([]),
        set: vi.fn().mockImplementation(() => {
          throw new Error('Cannot set cookies in Server Component')
        })
      }

      cookies.mockResolvedValue(mockCookieStore)

      let capturedCookieConfig: {
        setAll: (
          cookies: { name: string; value: string; options?: object }[]
        ) => void
      } | null = null
      createServerClient.mockImplementation((_url, _key, config) => {
        capturedCookieConfig = config.cookies
        return { auth: {} }
      })

      const { createClient } = await import('@/app/lib/auth/server')
      await createClient()

      expect(() => {
        capturedCookieConfig!.setAll([{ name: 'test', value: 'val' }])
      }).not.toThrow()
    })

    it('falls back to stateless client when cookies throws', async () => {
      cookies.mockRejectedValue(new Error('Cookies not available during build'))
      createServerClient.mockReturnValue({ auth: {} })

      const { createClient } = await import('@/app/lib/auth/server')
      const client = await createClient()

      expect(client).toBeDefined()
      expect(createServerClient).toHaveBeenLastCalledWith(
        SUPABASE_INTERNAL_URL,
        SUPABASE_ANON_KEY,
        expect.objectContaining({
          cookies: expect.objectContaining({
            getAll: expect.any(Function),
            setAll: expect.any(Function)
          })
        })
      )
    })

    it('stateless client getAll returns empty array', async () => {
      cookies.mockRejectedValue(new Error('Build time'))

      let capturedCookieConfig: { getAll: () => unknown[] } | null = null
      createServerClient.mockImplementation((_url, _key, config) => {
        capturedCookieConfig = config.cookies
        return { auth: {} }
      })

      const { createClient } = await import('@/app/lib/auth/server')
      await createClient()

      const getAllCalls = createServerClient.mock.calls
      const lastCall = getAllCalls[getAllCalls.length - 1]
      const cookieConfig = lastCall[2].cookies

      expect(cookieConfig.getAll()).toEqual([])
    })

    it('stateless client setAll is no-op', async () => {
      cookies.mockRejectedValue(new Error('Build time'))

      let capturedCookieConfig: {
        setAll: (cookies: { name: string; value: string }[]) => void
      } | null = null
      createServerClient.mockImplementation((_url, _key, config) => {
        capturedCookieConfig = config.cookies
        return { auth: {} }
      })

      const { createClient } = await import('@/app/lib/auth/server')
      await createClient()

      const getAllCalls = createServerClient.mock.calls
      const lastCall = getAllCalls[getAllCalls.length - 1]
      const cookieConfig = lastCall[2].cookies

      expect(() =>
        cookieConfig.setAll([{ name: 'test', value: 'val' }])
      ).not.toThrow()
    })
  })

  describe('createServiceClient', () => {
    it('creates client with service role key', async () => {
      createServerClient.mockReturnValue({ auth: {} })

      const { createServiceClient } = await import('@/app/lib/auth/server')
      const client = createServiceClient()

      expect(createServerClient).toHaveBeenCalledWith(
        SUPABASE_INTERNAL_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        expect.objectContaining({
          auth: {
            autoRefreshToken: false,
            persistSession: false
          },
          cookies: expect.objectContaining({
            getAll: expect.any(Function),
            setAll: expect.any(Function)
          })
        })
      )
      expect(client).toBeDefined()
    })

    it('disables auto refresh for service client', async () => {
      createServerClient.mockReturnValue({ auth: {} })

      const { createServiceClient } = await import('@/app/lib/auth/server')
      createServiceClient()

      const callArgs = createServerClient.mock.calls[0]
      const config = callArgs[2]

      expect(config.auth.autoRefreshToken).toBe(false)
    })

    it('disables session persistence for service client', async () => {
      createServerClient.mockReturnValue({ auth: {} })

      const { createServiceClient } = await import('@/app/lib/auth/server')
      createServiceClient()

      const callArgs = createServerClient.mock.calls[0]
      const config = callArgs[2]

      expect(config.auth.persistSession).toBe(false)
    })

    it('service client getAll returns empty array', async () => {
      createServerClient.mockReturnValue({ auth: {} })

      const { createServiceClient } = await import('@/app/lib/auth/server')
      createServiceClient()

      const callArgs = createServerClient.mock.calls[0]
      const cookieConfig = callArgs[2].cookies

      expect(cookieConfig.getAll()).toEqual([])
    })

    it('service client setAll is no-op', async () => {
      createServerClient.mockReturnValue({ auth: {} })

      const { createServiceClient } = await import('@/app/lib/auth/server')
      createServiceClient()

      const callArgs = createServerClient.mock.calls[0]
      const cookieConfig = callArgs[2].cookies

      expect(() =>
        cookieConfig.setAll([{ name: 'test', value: 'val' }])
      ).not.toThrow()
    })

    it('is synchronous (does not return a promise)', async () => {
      createServerClient.mockReturnValue({ auth: {} })

      const { createServiceClient } = await import('@/app/lib/auth/server')
      const result = createServiceClient()

      expect(result).not.toBeInstanceOf(Promise)
    })

    it('pins the supplied AbortSignal onto every service fetch', async () => {
      createServerClient.mockReturnValue({ auth: {} })
      const controller = new AbortController()

      const { createServiceClient } = await import('@/app/lib/auth/server')
      createServiceClient(controller.signal)

      const config = createServerClient.mock.calls[0][2] as {
        global: { fetch: typeof fetch }
      }
      const unrelatedSignal = new AbortController().signal
      await config.global.fetch('http://supabase-kong:8000/rest/v1/rpc/test', {
        method: 'POST',
        signal: unrelatedSignal
      })

      expect(sharedFetch).toHaveBeenCalledWith(
        'http://supabase-kong:8000/rest/v1/rpc/test',
        expect.objectContaining({
          method: 'POST',
          signal: controller.signal
        })
      )
    })
  })

  describe('environment configuration', () => {
    it('uses internal URL for server-side auth client', async () => {
      cookies.mockResolvedValue({
        getAll: vi.fn().mockReturnValue([]),
        set: vi.fn()
      })
      createServerClient.mockReturnValue({ auth: {} })

      const { createClient } = await import('@/app/lib/auth/server')
      await createClient()

      expect(createServerClient).toHaveBeenCalledWith(
        SUPABASE_INTERNAL_URL,
        expect.any(String),
        expect.any(Object)
      )
    })

    it('uses anon key for regular client', async () => {
      cookies.mockResolvedValue({
        getAll: vi.fn().mockReturnValue([]),
        set: vi.fn()
      })
      createServerClient.mockReturnValue({ auth: {} })

      const { createClient } = await import('@/app/lib/auth/server')
      await createClient()

      expect(createServerClient).toHaveBeenCalledWith(
        expect.any(String),
        SUPABASE_ANON_KEY,
        expect.any(Object)
      )
    })

    it('uses service role key for service client', async () => {
      createServerClient.mockReturnValue({ auth: {} })

      const { createServiceClient } = await import('@/app/lib/auth/server')
      createServiceClient()

      expect(createServerClient).toHaveBeenCalledWith(
        expect.any(String),
        SUPABASE_SERVICE_ROLE_KEY,
        expect.any(Object)
      )
    })
  })
})
