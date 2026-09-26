import { afterEach, describe, expect, it, vi } from 'vitest'

const createBrowserClientMock = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: createBrowserClientMock
}))

vi.unmock('@/app/lib/auth/browser')

const ORIGINAL_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
}

const setEnv = (values: Partial<typeof ORIGINAL_ENV>) => {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key as keyof typeof ORIGINAL_ENV]
    } else {
      process.env[key as keyof typeof ORIGINAL_ENV] = value
    }
  }
}

const restoreEnv = () => {
  setEnv(ORIGINAL_ENV)
}

const importBrowserModule = async () => {
  vi.resetModules()
  vi.unmock('@/app/lib/auth/browser')
  return import('@/app/lib/auth/browser')
}

afterEach(() => {
  restoreEnv()
  createBrowserClientMock.mockReset()
})

describe('auth browser client', () => {
  it('creates browser client with JSON headers and no global Prefer', async () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key'
    })
    createBrowserClientMock.mockReturnValue({ client: 'browser' })
    const { createClient } = await importBrowserModule()

    const client = createClient()

    expect(client).toEqual({ client: 'browser' })
    expect(createBrowserClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.objectContaining({
        global: {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }
        },
        auth: expect.objectContaining({
          storageKey: 'tacticus-auth-token',
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true
        })
      })
    )

    // A global `Prefer: return=representation` 42501s every mutation on column-whitelisted tables.
    const options = createBrowserClientMock.mock.calls[0]![2] as {
      global?: { headers?: Record<string, string> }
    }
    expect(options.global?.headers).not.toHaveProperty('Prefer')
  })

  it('creates storage client without headers', async () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key'
    })
    createBrowserClientMock.mockReturnValue({ client: 'storage' })
    const { createStorageClient } = await importBrowserModule()

    const client = createStorageClient()

    expect(client).toEqual({ client: 'storage' })
    expect(createBrowserClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          storageKey: 'tacticus-auth-token',
          autoRefreshToken: false,
          persistSession: true,
          detectSessionInUrl: false
        })
      })
    )
  })

  it('throws when required env vars are missing in the browser', async () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined
    })
    const { createClient } = await importBrowserModule()

    expect(() => createClient()).toThrow(
      'Missing required Supabase environment variables'
    )
  })
})
