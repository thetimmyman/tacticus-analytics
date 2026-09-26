import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The sync runs for every live Discord identity, regardless of the self-set `discord_synced` flag,
 * which once latched after a zero-row update.
 */

// The name avoids the secret-scanner's discord-client-id rule.
const IDENTITY_SNOWFLAKE = '100000000000000001'

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
  featureFlags: { discordAuth: true, requireDiscordLink: false }
}))
vi.mock('@/app/lib/auth/discord-relink-activation', () => ({
  activatePendingDiscordRelink: vi.fn().mockResolvedValue({ success: true }),
  DiscordRelinkActivationError: class DiscordRelinkActivationError extends Error {
    constructor(
      message: string,
      readonly discardState: boolean
    ) {
      super(message)
    }
  }
}))
vi.mock('@/app/lib/auth/discord-relink-state', () => ({
  DISCORD_RELINK_STATE_COOKIE: 'eot-discord-relink-state'
}))
vi.mock('@/app/lib/auth/user-bans', () => ({
  findActiveBanForAuthUser: vi.fn().mockResolvedValue(null)
}))

interface UserOverrides {
  metadata?: Record<string, unknown>
  withDiscordIdentity?: boolean
}

function buildUser({
  metadata = {},
  withDiscordIdentity = true
}: UserOverrides = {}) {
  return {
    id: 'user-1',
    user_metadata: { role: 'member', ...metadata },
    identities: withDiscordIdentity
      ? [
          {
            provider: 'discord',
            identity_data: {
              provider_id: IDENTITY_SNOWFLAKE,
              name: 'testuser#0'
            }
          }
        ]
      : []
  }
}

// Also thenable because the sync guard awaits the builder.
function buildSupabaseStub(currentRowDiscordId: string | null, user: unknown) {
  const from = vi.fn(() => ({
    select: (columns: string) => {
      const rows =
        columns === 'discord_user_id'
          ? [{ discord_user_id: currentRowDiscordId }]
          : [{ role: 'member', is_current: true }]
      const builder: Record<string, unknown> = {
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: rows[0], error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: rows, error: null })
      }
      return builder
    }
  }))

  return {
    from,
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'new-token' }, user },
        error: null
      }),
      signOut: vi.fn().mockResolvedValue({ error: null })
    }
  }
}

async function runCallback(
  supabaseStub: unknown,
  options: { code?: string; sealedState?: string; recovery?: boolean } = {}
) {
  const ssr = await import('@supabase/ssr')
  const headers = await import('next/headers')
  const deleteCookie = vi.fn()
  vi.mocked(headers.cookies).mockResolvedValue({
    getAll: () => [],
    get: (name: string) =>
      name === 'eot-discord-relink-state' && options.sealedState
        ? { value: options.sealedState }
        : undefined,
    set: () => {},
    delete: deleteCookie
  } as never)
  vi.mocked(ssr.createServerClient).mockReturnValue(supabaseStub as never)

  const { GET } = await import('@/app/(auth)/auth/callback/route')
  const response = await GET(
    new Request(
      `https://tacticusanalytics.com/auth/callback?redirectTo=%2Fprofile&provider=discord${options.code ? `&code=${options.code}` : ''}${options.recovery ? '&type=recovery' : ''}`
    )
  )
  return { response, deleteCookie }
}

describe('auth callback — Discord profile sync', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('syncs on the already-authenticated path when the row lacks the snowflake', async () => {
    const user = buildUser()
    const { response } = await runCallback(buildSupabaseStub(null, user))

    const { syncDiscordProfile } =
      await import('@/app/lib/discord/sync-profile')
    expect(syncDiscordProfile).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(307)
  })

  it('still syncs when user_metadata.discord_synced already latched true', async () => {
    const user = buildUser({ metadata: { discord_synced: true } })
    await runCallback(buildSupabaseStub(null, user))

    const { syncDiscordProfile } =
      await import('@/app/lib/discord/sync-profile')
    expect(syncDiscordProfile).toHaveBeenCalledTimes(1)
  })

  it('still invokes the idempotent sync when the row already has the snowflake', async () => {
    const user = buildUser()
    await runCallback(buildSupabaseStub(IDENTITY_SNOWFLAKE, user))

    const { syncDiscordProfile } =
      await import('@/app/lib/discord/sync-profile')
    expect(syncDiscordProfile).toHaveBeenCalledTimes(1)
  })

  it('does not sync when the user has no Discord identity', async () => {
    const user = buildUser({ withDiscordIdentity: false })
    await runCallback(buildSupabaseStub(null, user))

    const { syncDiscordProfile } =
      await import('@/app/lib/discord/sync-profile')
    expect(syncDiscordProfile).not.toHaveBeenCalled()
  })

  it('activates encrypted relink state before syncing a fresh OAuth callback', async () => {
    const user = buildUser()
    const { response, deleteCookie } = await runCallback(
      buildSupabaseStub(null, user),
      { code: 'fresh-oauth-code', sealedState: 'sealed-state' }
    )
    const { activatePendingDiscordRelink } =
      await import('@/app/lib/auth/discord-relink-activation')
    const { syncDiscordProfile } =
      await import('@/app/lib/discord/sync-profile')

    expect(activatePendingDiscordRelink).toHaveBeenCalledWith(
      expect.anything(),
      user,
      'sealed-state'
    )
    expect(
      vi.mocked(activatePendingDiscordRelink).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(syncDiscordProfile).mock.invocationCallOrder[0]!)
    expect(deleteCookie).toHaveBeenCalledWith('eot-discord-relink-state')
    expect(response.status).toBe(307)
  })

  it('retains relink state when activation fails so the callback can retry', async () => {
    const user = buildUser()
    const supabase = buildSupabaseStub(null, user)
    const { activatePendingDiscordRelink } =
      await import('@/app/lib/auth/discord-relink-activation')
    vi.mocked(activatePendingDiscordRelink).mockRejectedValueOnce(
      new Error('transient database failure')
    )

    const { response, deleteCookie } = await runCallback(supabase, {
      code: 'fresh-oauth-code',
      sealedState: 'sealed-state'
    })

    expect(response.status).toBe(307)
    expect(deleteCookie).not.toHaveBeenCalledWith('eot-discord-relink-state')
    expect(supabase.auth.signOut).not.toHaveBeenCalled()
  })

  it('discards relink state proven invalid or stale', async () => {
    const user = buildUser()
    const { activatePendingDiscordRelink, DiscordRelinkActivationError } =
      await import('@/app/lib/auth/discord-relink-activation')
    vi.mocked(activatePendingDiscordRelink).mockRejectedValueOnce(
      new DiscordRelinkActivationError('stale nonce', true)
    )

    const { deleteCookie } = await runCallback(buildSupabaseStub(null, user), {
      code: 'fresh-oauth-code',
      sealedState: 'sealed-state'
    })

    expect(deleteCookie).toHaveBeenCalledWith('eot-discord-relink-state')
  })

  it('clears a newly exchanged session when ban verification throws', async () => {
    const user = buildUser()
    const supabase = buildSupabaseStub(null, user)
    supabase.auth.getSession.mockResolvedValueOnce({
      data: { session: null }
    })
    const { findActiveBanForAuthUser } =
      await import('@/app/lib/auth/user-bans')
    vi.mocked(findActiveBanForAuthUser).mockRejectedValueOnce(
      new Error('Unable to verify account access')
    )

    const { response } = await runCallback(supabase, {
      code: 'fresh-oauth-code'
    })

    expect(response.headers.get('location')).toContain(
      '/auth/error?error=unexpected'
    )
    expect(supabase.auth.signOut).toHaveBeenCalledOnce()
  })

  it('clears a recovered callback session when exchange reports an error', async () => {
    const user = buildUser()
    const supabase = buildSupabaseStub(null, user)
    supabase.auth.getSession
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValueOnce({
        data: { session: { access_token: 'recovered' } }
      })
    supabase.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: 'exchange race' }
    })
    const { findActiveBanForAuthUser } =
      await import('@/app/lib/auth/user-bans')
    vi.mocked(findActiveBanForAuthUser).mockRejectedValueOnce(
      new Error('Unable to verify account access')
    )

    await runCallback(supabase, { code: 'fresh-oauth-code' })

    expect(supabase.auth.signOut).toHaveBeenCalledOnce()
  })

  it('clears an exchange-error recovery session that replaced an existing session', async () => {
    const user = buildUser()
    const supabase = buildSupabaseStub(null, user)
    supabase.auth.getSession
      .mockResolvedValueOnce({
        data: { session: { access_token: 'preexisting' } }
      })
      .mockResolvedValueOnce({
        data: { session: { access_token: 'recovered' } }
      })
    supabase.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: 'exchange race' }
    })
    const { findActiveBanForAuthUser } =
      await import('@/app/lib/auth/user-bans')
    vi.mocked(findActiveBanForAuthUser).mockRejectedValueOnce(
      new Error('Unable to verify account access')
    )

    await runCallback(supabase, { code: 'recovery-code', recovery: true })

    expect(supabase.auth.signOut).toHaveBeenCalledOnce()
  })

  it('clears a recovered session when callback identity verification fails', async () => {
    const user = buildUser()
    const supabase = buildSupabaseStub(null, user)
    supabase.auth.getSession
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValueOnce({
        data: { session: { access_token: 'recovered' } }
      })
    supabase.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: 'exchange race' }
    })
    supabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'identity verification failed' }
    })

    const { response } = await runCallback(supabase, {
      code: 'fresh-oauth-code'
    })

    expect(response.headers.get('location')).toContain(
      '/auth/error?error=unexpected'
    )
    expect(supabase.auth.signOut).toHaveBeenCalledOnce()
  })
})
