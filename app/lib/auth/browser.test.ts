import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processLock } from '@supabase/supabase-js'

const createBrowserClientMock = vi.fn((..._args: readonly unknown[]) => ({
  mockClient: true
}))
vi.mock('@supabase/ssr', () => ({
  createBrowserClient: (...args: readonly unknown[]) =>
    createBrowserClientMock(...args)
}))

type AuthOptions = { auth?: { lock?: unknown } }
type BrowserModule = typeof import('@/app/lib/auth/browser')

describe('browser auth client lock configuration (WI-2410)', () => {
  let mod: BrowserModule

  beforeEach(async () => {
    createBrowserClientMock.mockClear()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    // tests/setup.vitest.ts mocks this module globally; load the real one.
    mod = await vi.importActual<BrowserModule>('@/app/lib/auth/browser')
  })

  // navigator.locks aborts under contention on mobile; processLock never does.
  it('configures the main browser client with the in-memory processLock', () => {
    mod.createBrowserClient()

    expect(createBrowserClientMock).toHaveBeenCalledTimes(1)
    const options = createBrowserClientMock.mock.calls[0]![2] as AuthOptions
    expect(options.auth?.lock).toBe(processLock)
  })

  it('configures the storage client with the same processLock', () => {
    mod.createStorageClient()

    expect(createBrowserClientMock).toHaveBeenCalledTimes(1)
    const options = createBrowserClientMock.mock.calls[0]![2] as AuthOptions
    expect(options.auth?.lock).toBe(processLock)
  })
})
