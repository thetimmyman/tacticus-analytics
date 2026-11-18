import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * A password-reset callback must only land on the reset page with the session its own code
 * created. When the exchange fails, a session that was already in the browser belongs to some
 * other sign-in, and resetting it would change the wrong account's password.
 */

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@tacticus/app-core/server-env', () => ({
  serverEnv: {
    SUPABASE_INTERNAL_URL: 'http://supabase-kong:8000',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key'
  }
}))
vi.mock('@/app/lib/discord/sync-profile', () => ({
  syncDiscordProfile: vi.fn().mockResolvedValue({ status: 'synced' })
}))
vi.mock('@/app/lib/utils/feature-flags', () => ({
  featureFlags: { discordAuth: false, requireDiscordLink: false }
}))
vi.mock('@/app/lib/auth/discord-relink-activation', () => ({
  activatePendingDiscordRelink: vi.fn(),
  DiscordRelinkActivationError: class extends Error {}
}))
vi.mock('@/app/lib/auth/discord-relink-state', () => ({
  DISCORD_RELINK_STATE_COOKIE: 'eot-discord-relink-state'
}))
vi.mock('@/app/lib/auth/user-bans', () => ({
  findActiveBanForAuthUser: vi.fn().mockResolvedValue(null)
}))

const SIGNED_IN_USER = { id: 'signed-in-account', user_metadata: {} }
const RECOVERED_USER = { id: 'reset-link-account', user_metadata: {} }
const PREEXISTING = { access_token: 'preexisting' }

function stub({
  before,
  after,
  exchangeError,
  userAfter
}: {
  before: { access_token: string } | null
  after: { access_token: string } | null
  exchangeError: string | null
  userAfter: { id: string } | null
}) {
  return {
    from: vi.fn(),
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValueOnce({ data: { session: before } })
        .mockResolvedValue({ data: { session: after } }),
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: userAfter }, error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue(
        exchangeError
          ? {
              data: { session: null, user: null },
              error: { message: exchangeError }
            }
          : {
              data: {
                session: { access_token: 'recovered' },
                user: RECOVERED_USER
              },
              error: null
            }
      ),
      signOut: vi.fn().mockResolvedValue({ error: null })
    }
  }
}

async function runRecoveryCallback(supabaseStub: unknown) {
  const ssr = await import('@supabase/ssr')
  const headers = await import('next/headers')
  vi.mocked(headers.cookies).mockResolvedValue({
    getAll: () => [],
    get: () => undefined,
    set: () => {},
    delete: vi.fn()
  } as never)
  vi.mocked(ssr.createServerClient).mockReturnValue(supabaseStub as never)

  const { GET } = await import('@/app/(auth)/auth/callback/route')
  const response = await GET(
    new Request(
      'https://tacticusanalytics.com/auth/callback?type=recovery&next=%2Fauth%2Freset-password&code=recovery-code'
    )
  )
  return response.headers.get('location') ?? ''
}

describe('auth callback — password recovery never reuses an existing session', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses the reset page when the link was opened without its verifier while another account is signed in', async () => {
    const supabase = stub({
      before: PREEXISTING,
      after: PREEXISTING,
      exchangeError:
        'PKCE code verifier not found in storage. This can happen if the auth flow was initiated in a different browser or device.',
      userAfter: SIGNED_IN_USER
    })

    const location = await runRecoveryCallback(supabase)

    expect(location).not.toContain('/auth/reset-password')
    expect(location).toContain('/auth/login?error=link_expired')
    expect(decodeURIComponent(location)).toMatch(/same browser/i)
    expect(supabase.auth.signOut).not.toHaveBeenCalled()
  })

  it('refuses the reset page when a used link is opened while another account is signed in', async () => {
    const supabase = stub({
      before: PREEXISTING,
      after: PREEXISTING,
      exchangeError: 'Token has expired or has already been used',
      userAfter: SIGNED_IN_USER
    })

    const location = await runRecoveryCallback(supabase)

    expect(location).not.toContain('/auth/reset-password')
    expect(location).toContain('/auth/login?error=link_expired')
  })

  it('still reaches the reset page when a racing request established a new session', async () => {
    const supabase = stub({
      before: null,
      after: { access_token: 'recovered' },
      exchangeError: 'exchange race',
      userAfter: RECOVERED_USER
    })

    expect(await runRecoveryCallback(supabase)).toBe(
      'https://tacticusanalytics.com/auth/reset-password'
    )
  })

  it('reaches the reset page when the exchange replaces a signed-in session', async () => {
    const supabase = stub({
      before: PREEXISTING,
      after: { access_token: 'recovered' },
      exchangeError: null,
      userAfter: RECOVERED_USER
    })

    expect(await runRecoveryCallback(supabase)).toBe(
      'https://tacticusanalytics.com/auth/reset-password'
    )
  })
})
