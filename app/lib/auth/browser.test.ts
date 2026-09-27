import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authConfig } from './config'

const createBrowserClientMock = vi.fn((..._args: readonly unknown[]) => ({
  mockClient: true
}))
vi.mock('@supabase/ssr', () => ({
  createBrowserClient: (...args: readonly unknown[]) =>
    createBrowserClientMock(...args)
}))

type AuthOptions = { auth?: { lock?: unknown } }
type BrowserModule = typeof import('@/app/lib/auth/browser')

const flushRejections = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('browser auth client lock configuration', () => {
  let mod: BrowserModule

  beforeEach(async () => {
    createBrowserClientMock.mockClear()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    // tests/setup.vitest.ts mocks this module globally; load the real one.
    mod = await vi.importActual<BrowserModule>('@/app/lib/auth/browser')
  })

  it('configures the main browser client with the settled process lock', () => {
    mod.createBrowserClient()

    expect(createBrowserClientMock).toHaveBeenCalledTimes(1)
    const options = createBrowserClientMock.mock.calls[0]![2] as AuthOptions
    expect(options.auth?.lock).toBe(mod.settledProcessLock)
  })

  it('configures the storage client with the same settled process lock', () => {
    mod.createStorageClient()

    expect(createBrowserClientMock).toHaveBeenCalledTimes(1)
    const options = createBrowserClientMock.mock.calls[0]![2] as AuthOptions
    expect(options.auth?.lock).toBe(mod.settledProcessLock)
  })

  it('leaves no unhandled rejection behind while preserving the caller error', async () => {
    const errors: unknown[] = []
    const onUnhandled = (error: unknown) => errors.push(error)
    process.on('unhandledRejection', onUnhandled)
    try {
      const original = new Error('synthetic failure')
      await expect(
        mod.settledProcessLock(
          `settled-${crypto.randomUUID()}`,
          -1,
          async () => {
            throw original
          }
        )
      ).rejects.toBe(original)
      await flushRejections()
      expect(errors).not.toContain(original)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('returns values and serializes operations on the same lock', async () => {
    const name = `serial-${crypto.randomUUID()}`
    const events: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = mod.settledProcessLock(name, -1, async () => {
      events.push('first start')
      await firstGate
      events.push('first end')
      return 'first value'
    })
    const second = mod.settledProcessLock(name, -1, async () => {
      events.push('second start')
      return 'second value'
    })

    await flushRejections()
    expect(events).toEqual(['first start'])
    releaseFirst()
    await expect(first).resolves.toBe('first value')
    await expect(second).resolves.toBe('second value')
    expect(events).toEqual(['first start', 'first end', 'second start'])
  })

  it('continues after a rejected operation on the same lock', async () => {
    const name = `recovery-${crypto.randomUUID()}`
    const original = new Error('synthetic failure')
    await expect(
      mod.settledProcessLock(name, -1, async () => {
        throw original
      })
    ).rejects.toBe(original)
    await expect(
      mod.settledProcessLock(name, -1, async () => 'recovered')
    ).resolves.toBe('recovered')
  })

  it('propagates lock-acquire timeout errors', async () => {
    const name = `timeout-${crypto.randomUUID()}`
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = mod.settledProcessLock(name, -1, async () => {
      await firstGate
    })
    try {
      await expect(
        mod.settledProcessLock(name, 0, async () => 'unreachable')
      ).rejects.toMatchObject({ isAcquireTimeout: true })
    } finally {
      releaseFirst()
      await first
    }
  })

  it('treats a corrupted session cookie as signed out without an unhandled rejection', async () => {
    const { createBrowserClient } =
      await vi.importActual<typeof import('@supabase/ssr')>('@supabase/ssr')
    const key = authConfig.session.storageKey
    document.cookie = `${key}=base64-%C3%28; path=/`
    const errors: unknown[] = []
    const onUnhandled = (error: unknown) => errors.push(error)
    process.on('unhandledRejection', onUnhandled)
    try {
      const client = createBrowserClient(
        'https://example.supabase.co',
        'anon-key',
        {
          auth: {
            storageKey: key,
            lock: mod.settledProcessLock,
            autoRefreshToken: false,
            detectSessionInUrl: false
          }
        }
      )
      const { data } = await client.auth.getSession()
      expect(data.session).toBeNull()
      await flushRejections()
      expect(errors).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      document.cookie = `${key}=; Max-Age=0; path=/`
    }
  })
})
