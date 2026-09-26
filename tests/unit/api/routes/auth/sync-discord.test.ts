import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  serviceDb: vi.fn(),
  featureFlags: { discordAuth: true },
  sealDiscordRelinkState: vi.fn(),
  unsealDiscordRelinkState: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({
  db: mocks.db,
  serviceDb: mocks.serviceDb
}))

vi.mock('@/app/lib/utils/feature-flags', () => ({
  featureFlags: mocks.featureFlags
}))

function thenableQuery<T>(result: T) {
  const query = {
    select: vi.fn(),
    update: vi.fn(),
    in: vi.fn(),
    eq: vi.fn(),
    then: <R1, R2>(
      onFulfilled?: (value: T) => R1,
      onRejected?: (reason: Error) => R2
    ) => Promise.resolve(result).then(onFulfilled, onRejected)
  }
  query.select.mockReturnValue(query)
  query.update.mockReturnValue(query)
  query.in.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

const discordUser = {
  id: '11111111-1111-4111-8111-111111111111',
  identities: [
    {
      provider: 'discord',
      identity_data: {
        id: '123456789012345678',
        username: 'testuser',
        discriminator: '1234',
        global_name: 'Test User'
      }
    }
  ]
}

const authorityRow = {
  mapping_id: 42,
  player_id: 'player-42',
  user_id: discordUser.id,
  guild_code: 'TEST',
  role: 'member',
  is_app_admin: false,
  ownership_attestation_id: '22222222-2222-4222-8222-222222222222'
}

const unlinkState = {
  version: 1 as const,
  userId: discordUser.id,
  unlinkId: '33333333-3333-4333-8333-333333333333',
  relinkNonce: '44444444-4444-4444-8444-444444444444',
  generation: 2,
  expiresAt: '2026-08-09T21:00:00.000Z'
}

vi.mock('@/app/lib/auth/discord-relink-state', () => ({
  DISCORD_RELINK_STATE_COOKIE: 'eot-discord-relink-state',
  discordRelinkCookieOptions: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600
  },
  sealDiscordRelinkState: mocks.sealDiscordRelinkState,
  unsealDiscordRelinkState: mocks.unsealDiscordRelinkState
}))

function request(method: string, withState = false) {
  return new NextRequest('http://localhost/api/auth/sync-discord', {
    method,
    headers: withState
      ? { cookie: 'eot-discord-relink-state=sealed-state' }
      : undefined
  })
}

describe('/api/auth/sync-discord canonical lifecycle', () => {
  let supabase: {
    auth: {
      getUser: ReturnType<typeof vi.fn>
      updateUser: ReturnType<typeof vi.fn>
    }
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let service: { rpc: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.featureFlags.discordAuth = true
    mocks.sealDiscordRelinkState.mockResolvedValue('sealed-state')
    mocks.unsealDiscordRelinkState.mockResolvedValue(unlinkState)
    const lookup = thenableQuery({
      data: [{ display_name: 'Existing Name' }],
      error: null
    })
    const update = thenableQuery({ error: null })
    supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: discordUser },
          error: null
        }),
        updateUser: vi.fn().mockResolvedValue({ error: null })
      },
      from: vi.fn().mockReturnValueOnce(lookup).mockReturnValueOnce(update),
      rpc: vi.fn()
    }
    service = {
      rpc: vi.fn().mockResolvedValue({ data: [authorityRow], error: null })
    }
    mocks.db.mockResolvedValue(supabase)
    mocks.serviceDb.mockReturnValue(service)
  })

  it('fails closed when Discord auth is disabled', async () => {
    mocks.featureFlags.discordAuth = false
    const { POST } = await import('@/app/api/auth/sync-discord/route')

    const response = await POST(request('POST'))

    expect(response.status).toBe(403)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns a no-op when the session has no Discord identity', async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { ...discordUser, identities: [] } },
      error: null
    })
    const { POST } = await import('@/app/api/auth/sync-discord/route')

    const response = await POST(request('POST'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'No Discord identity found'
    })
    expect(service.rpc).not.toHaveBeenCalled()
  })

  it('syncs only the mapping IDs returned by immutable ownership proof', async () => {
    const { POST } = await import('@/app/api/auth/sync-discord/route')

    const response = await POST(request('POST'))

    expect(response.status).toBe(200)
    expect(service.rpc).toHaveBeenCalledWith('resolve_verified_players', {
      p_user_ids: [discordUser.id]
    })
    const updateQuery = supabase.from.mock.results[1]!.value
    expect(updateQuery.in).toHaveBeenCalledWith('id', [42])
    expect(updateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ discord_user_id: '123456789012345678' })
    )
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({
      data: {
        discord_synced: true,
        discord_username: 'testuser#1234'
      }
    })
  })

  it('returns an onboarding no-op without writing when ownership proof is absent', async () => {
    service.rpc.mockResolvedValueOnce({ data: [], error: null })
    const { POST } = await import('@/app/api/auth/sync-discord/route')

    const response = await POST(request('POST'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'Complete onboarding before syncing your Discord profile'
    })
    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.auth.updateUser).not.toHaveBeenCalled()
  })

  it('activates one exact fresh generation before syncing a relinked identity', async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        success: true,
        unlink_id: unlinkState.unlinkId,
        generation: unlinkState.generation,
        mapping_id: 42,
        discord_user_id: '123456789012345678',
        fresh_generation_activated: true
      },
      error: null
    })
    const { POST } = await import('@/app/api/auth/sync-discord/route')

    const response = await POST(request('POST', true))

    expect(response.status).toBe(200)
    expect(supabase.rpc).toHaveBeenCalledWith(
      'activate_discord_identity_generation',
      {
        p_unlink_id: unlinkState.unlinkId,
        p_relink_nonce: unlinkState.relinkNonce
      }
    )
    expect(response.headers.get('set-cookie')).toContain(
      'eot-discord-relink-state='
    )
  })

  it('prepares DB authority before provider unlink without direct table writes', async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        success: true,
        unlink_id: unlinkState.unlinkId,
        relink_nonce: unlinkState.relinkNonce,
        generation: unlinkState.generation,
        cleared_mappings: 1,
        provider_unlink_required: true,
        stale_sync_blocked: true
      },
      error: null
    })
    const { DELETE } = await import('@/app/api/auth/sync-discord/route')

    const response = await DELETE(request('DELETE'))

    expect(response.status).toBe(200)
    expect(supabase.rpc).toHaveBeenCalledWith(
      'prepare_discord_identity_unlink',
      {}
    )
    expect(supabase.from).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body).toMatchObject({
      unlinkId: unlinkState.unlinkId,
      generation: unlinkState.generation
    })
    expect(body).not.toHaveProperty('relinkNonce')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  })

  it('confirms live provider absence after unlink', async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        success: true,
        unlink_id: unlinkState.unlinkId,
        generation: unlinkState.generation,
        identity_absent: true,
        cleared_mappings: 1,
        relink_requires_nonce: true
      },
      error: null
    })
    const { PATCH } = await import('@/app/api/auth/sync-discord/route')

    const response = await PATCH(request('PATCH', true))

    expect(response.status).toBe(200)
    expect(supabase.rpc).toHaveBeenCalledWith(
      'confirm_discord_identity_unlink',
      { p_unlink_id: unlinkState.unlinkId }
    )
    expect(response.headers.get('set-cookie')).toContain(
      'eot-discord-relink-state='
    )
    expect(response.headers.get('set-cookie')).toContain(
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    )
  })

  it('keeps unlink fail closed when the live identity remains', async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        success: false,
        error: 'Discord identity is still linked',
        error_code: 'IDENTITY_STILL_LINKED'
      },
      error: null
    })
    const { PATCH } = await import('@/app/api/auth/sync-discord/route')

    const response = await PATCH(request('PATCH', true))

    expect(response.status).toBe(409)
  })
})
