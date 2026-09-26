import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'
import type { Json } from '@tacticus/app-core/types'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn()
}))

vi.mock('@/app/lib/auth/server', () => ({
  createClient: mocks.createClient,
  createServiceClient: mocks.createServiceClient
}))

function singleQuery(result: { data: Json; error: Json }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result)
  }
}

describe('/api/guild/invite-code canonical RPC boundary', () => {
  let supabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null
        })
      },
      from: vi.fn(),
      rpc: vi.fn()
    }
    mocks.createClient.mockResolvedValue(supabase)
    mocks.createServiceClient.mockReturnValue(supabase)
  })

  it('requires an authenticated session', async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'not authenticated' }
    })
    const { GET } = await import('@/app/api/guild/invite-code/route')

    const response = await GET(
      new NextRequest('http://localhost/api/guild/invite-code?guild_code=TEST')
    )

    expect(response.status).toBe(401)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('preserves POST request validation before any database lookup', async () => {
    const { POST } = await import('@/app/api/guild/invite-code/route')

    const response = await POST(
      new NextRequest('http://localhost/api/guild/invite-code', {
        method: 'POST',
        body: JSON.stringify({ player_id: 'p1' })
      })
    )

    expect(response.status).toBe(400)
    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'missing caller profile',
      membership: null,
      target: undefined,
      status: 403
    },
    {
      name: 'cross-guild caller',
      membership: { role: 'leader', guild_code: 'OTHER' },
      target: undefined,
      status: 403
    },
    {
      name: 'plain member caller',
      membership: { role: 'member', guild_code: 'TEST' },
      target: undefined,
      status: 403
    },
    {
      name: 'missing target roster row',
      membership: { role: 'officer', guild_code: 'TEST' },
      target: null,
      status: 404
    },
    {
      name: 'already claimed target',
      membership: { role: 'leader', guild_code: 'TEST' },
      target: { id: 42, player_id: 'p1', user_id: 'claimed-user' },
      status: 400
    }
  ])(
    'preserves POST denial for $name',
    async ({ membership, target, status }) => {
      supabase.from.mockReturnValueOnce(
        singleQuery({ data: membership, error: membership ? null : {} })
      )
      if (target !== undefined) {
        supabase.from.mockReturnValueOnce(
          singleQuery({ data: target, error: target ? null : {} })
        )
      }
      const { POST } = await import('@/app/api/guild/invite-code/route')

      const response = await POST(
        new NextRequest('http://localhost/api/guild/invite-code', {
          method: 'POST',
          body: JSON.stringify({ player_id: 'p1', guild_code: 'TEST' })
        })
      )

      expect(response.status).toBe(status)
      expect(supabase.rpc).not.toHaveBeenCalled()
    }
  )

  it('creates an invite only through the caller-bound mapping RPC', async () => {
    supabase.from
      .mockReturnValueOnce(
        singleQuery({
          data: { role: 'leader', guild_code: 'TEST' },
          error: null
        })
      )
      .mockReturnValueOnce(
        singleQuery({
          data: {
            id: 42,
            player_id: 'p1',
            user_id: null,
            display_name: 'Player One'
          },
          error: null
        })
      )
    supabase.rpc.mockResolvedValue({
      data: {
        success: true,
        invite_id: 'invite-1',
        code: 'ABC123',
        expires_at: '2026-08-12T00:00:00Z',
        player_name: 'Player One',
        guild_code: 'TEST'
      },
      error: null
    })
    const { POST } = await import('@/app/api/guild/invite-code/route')

    const response = await POST(
      new NextRequest('http://localhost/api/guild/invite-code', {
        method: 'POST',
        body: JSON.stringify({ player_id: 'p1', guild_code: 'TEST' })
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      code: 'ABC123',
      player_name: 'Player One'
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_player_invite_code',
      expect.objectContaining({ p_mapping_id: 42 })
    )
    expect(supabase.from).not.toHaveBeenCalledWith('player_invite_codes')
  })

  it('preserves create business denials', async () => {
    supabase.from
      .mockReturnValueOnce(
        singleQuery({
          data: { role: 'officer', guild_code: 'TEST' },
          error: null
        })
      )
      .mockReturnValueOnce(
        singleQuery({
          data: { id: 42, player_id: 'p1', user_id: null },
          error: null
        })
      )
    supabase.rpc.mockResolvedValue({
      data: {
        success: false,
        error: 'Player mapping not found',
        error_code: 'NOT_FOUND'
      },
      error: null
    })
    const { POST } = await import('@/app/api/guild/invite-code/route')

    const response = await POST(
      new NextRequest('http://localhost/api/guild/invite-code', {
        method: 'POST',
        body: JSON.stringify({ player_id: 'p1', guild_code: 'TEST' })
      })
    )

    expect(response.status).toBe(404)
  })

  it('preserves a concurrent ALREADY_CLAIMED denial from create', async () => {
    supabase.from
      .mockReturnValueOnce(
        singleQuery({
          data: { role: 'officer', guild_code: 'TEST' },
          error: null
        })
      )
      .mockReturnValueOnce(
        singleQuery({
          data: { id: 42, player_id: 'p1', user_id: null },
          error: null
        })
      )
    supabase.rpc.mockResolvedValue({
      data: {
        success: false,
        error: 'Player already claimed',
        error_code: 'ALREADY_CLAIMED'
      },
      error: null
    })
    const { POST } = await import('@/app/api/guild/invite-code/route')

    const response = await POST(
      new NextRequest('http://localhost/api/guild/invite-code', {
        method: 'POST',
        body: JSON.stringify({ player_id: 'p1', guild_code: 'TEST' })
      })
    )

    expect(response.status).toBe(400)
  })

  it('lists codes only through the authenticated read RPC', async () => {
    supabase.from.mockReturnValueOnce(
      singleQuery({
        data: { role: 'officer', guild_code: 'TEST' },
        error: null
      })
    )
    supabase.rpc.mockResolvedValue({
      data: [{ id: 'invite-1', code: 'ABC123', guild_code: 'TEST' }],
      error: null
    })
    const { GET } = await import('@/app/api/guild/invite-code/route')

    const response = await GET(
      new NextRequest('http://localhost/api/guild/invite-code?guild_code=TEST')
    )

    expect(response.status).toBe(200)
    expect(supabase.rpc).toHaveBeenCalledWith('list_player_invite_codes', {
      p_guild_code: 'TEST'
    })
    expect(supabase.from).not.toHaveBeenCalledWith('player_invite_codes')
  })

  it('requires guild_code before list authorization', async () => {
    const { GET } = await import('@/app/api/guild/invite-code/route')

    const response = await GET(
      new NextRequest('http://localhost/api/guild/invite-code')
    )

    expect(response.status).toBe(400)
    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'missing caller profile', mapping: null },
    {
      name: 'cross-guild caller',
      mapping: { role: 'leader', guild_code: 'OTHER' }
    },
    {
      name: 'plain member caller',
      mapping: { role: 'member', guild_code: 'TEST' }
    }
  ])('preserves GET denial for $name', async ({ mapping }) => {
    supabase.from.mockReturnValueOnce(
      singleQuery({ data: mapping, error: mapping ? null : {} })
    )
    const { GET } = await import('@/app/api/guild/invite-code/route')

    const response = await GET(
      new NextRequest('http://localhost/api/guild/invite-code?guild_code=TEST')
    )

    expect(response.status).toBe(403)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('maps an invite-read authorization failure to 403', async () => {
    supabase.from.mockReturnValueOnce(
      singleQuery({
        data: { role: 'officer', guild_code: 'TEST' },
        error: null
      })
    )
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' }
    })
    const { GET } = await import('@/app/api/guild/invite-code/route')

    const response = await GET(
      new NextRequest('http://localhost/api/guild/invite-code?guild_code=TEST')
    )

    expect(response.status).toBe(403)
  })

  it('revokes through the caller-bound RPC and preserves ALREADY_USED', async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        success: false,
        error: 'Cannot revoke a used invite code',
        error_code: 'ALREADY_USED'
      },
      error: null
    })
    const { DELETE } = await import('@/app/api/guild/invite-code/route')

    const response = await DELETE(
      new NextRequest('http://localhost/api/guild/invite-code?id=invite-1', {
        method: 'DELETE'
      })
    )

    expect(response.status).toBe(400)
    expect(supabase.rpc).toHaveBeenCalledWith('revoke_player_invite_code', {
      p_invite_id: 'invite-1',
      p_reason: 'officer_revoked'
    })
  })

  it('requires an invite ID before revoke', async () => {
    const { DELETE } = await import('@/app/api/guild/invite-code/route')

    const response = await DELETE(
      new NextRequest('http://localhost/api/guild/invite-code', {
        method: 'DELETE'
      })
    )

    expect(response.status).toBe(400)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('preserves NOT_FOUND and authorization denials from revoke', async () => {
    const { DELETE } = await import('@/app/api/guild/invite-code/route')
    supabase.rpc.mockResolvedValueOnce({
      data: {
        success: false,
        error: 'Invite code not found',
        error_code: 'NOT_FOUND'
      },
      error: null
    })

    const missing = await DELETE(
      new NextRequest(
        'http://localhost/api/guild/invite-code?id=missing-invite',
        { method: 'DELETE' }
      )
    )

    expect(missing.status).toBe(404)

    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied' }
    })
    const denied = await DELETE(
      new NextRequest(
        'http://localhost/api/guild/invite-code?id=foreign-invite',
        { method: 'DELETE' }
      )
    )

    expect(denied.status).toBe(403)
  })

  it('returns success only after the revoke RPC confirms success', async () => {
    supabase.rpc.mockResolvedValue({
      data: { success: true },
      error: null
    })
    const { DELETE } = await import('@/app/api/guild/invite-code/route')

    const response = await DELETE(
      new NextRequest('http://localhost/api/guild/invite-code?id=invite-1', {
        method: 'DELETE'
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
  })
})
