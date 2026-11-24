// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sharedFetch = vi.hoisted(() => vi.fn())

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/app/lib/network/undici-agent', () => ({
  getSharedFetch: () => sharedFetch
}))
vi.mock('@tacticus/app-core/server-env', () => ({
  serverEnv: {
    SUPABASE_INTERNAL_URL: 'http://supabase-kong:8000',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key'
  }
}))
vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }),
  generateRequestId: () => 'req-1'
}))
vi.mock('@/app/lib/discord/sync-profile', () => ({
  syncDiscordProfile: vi.fn()
}))
vi.mock('@/app/lib/utils/feature-flags', () => ({
  featureFlags: { discordAuth: false, requireDiscordLink: false }
}))

type CookieWriterConfig = {
  cookies: {
    setAll: (
      cookies: { name: string; value: string; options?: object }[]
    ) => void
  }
}

const HARDENED = { secure: true, sameSite: 'lax', httpOnly: false }

describe('server-side session cookie writers enforce Secure and SameSite', () => {
  let captured: CookieWriterConfig | null
  let cookieStoreSet: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    captured = null
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SITE_URL', 'https://tacticusanalytics.com')

    const ssr = await import('@supabase/ssr')
    vi.mocked(ssr.createServerClient).mockImplementation(
      (_url, _key, config) => {
        captured = config as unknown as CookieWriterConfig
        return { auth: {} } as never
      }
    )

    cookieStoreSet = vi.fn()
    const headers = await import('next/headers')
    vi.mocked(headers.cookies).mockResolvedValue({
      getAll: () => [],
      set: cookieStoreSet,
      get: () => undefined,
      delete: vi.fn()
    } as never)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('app/lib/auth/server.ts writes hardened options on setAll', async () => {
    const { createClient } = await import('@/app/lib/auth/server')
    await createClient()

    captured!.cookies.setAll([
      { name: 'sb-session', value: 'v', options: { httpOnly: false } }
    ])

    expect(cookieStoreSet).toHaveBeenCalledWith(
      'sb-session',
      'v',
      expect.objectContaining(HARDENED)
    )
  })

  it('the auth callback route writes hardened options on setAll', async () => {
    const liveClient = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: 'live' } }
        })),
        getUser: vi.fn(async () => ({
          data: { user: { id: 'user-1', user_metadata: {} } },
          error: null
        }))
      }
    }
    vi.mocked(
      (await import('@supabase/ssr')).createServerClient
    ).mockImplementation((_url, _key, config) => {
      captured = config as unknown as CookieWriterConfig
      return liveClient as never
    })

    const { GET } = await import('@/app/(auth)/auth/callback/route')
    await GET(
      new Request('https://tacticusanalytics.com/auth/callback?next=%2Fhome')
    )

    captured!.cookies.setAll([
      { name: 'sb-session', value: 'v', options: { httpOnly: false } }
    ])

    expect(cookieStoreSet).toHaveBeenCalledWith(
      'sb-session',
      'v',
      expect.objectContaining(HARDENED)
    )
  })
})
