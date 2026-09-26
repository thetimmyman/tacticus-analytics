import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ADMIN_AUTH = {
  user: { id: 'admin-user' },
  profile: { is_app_admin: true }
}

describe('GET /api/admin/invite-codes/guild-members', () => {
  let GET: (request: NextRequest) => Promise<Response>
  let requireAppAdmin: ReturnType<typeof vi.fn>
  let db: ReturnType<typeof vi.fn>
  let serviceDb: ReturnType<typeof vi.fn>
  let rpc: ReturnType<typeof vi.fn>
  let from: ReturnType<typeof vi.fn>
  let forbiddenError: Error
  let rosterResult: {
    data: Array<{
      player_id: string
      display_name: string
      role: string
      user_id: string | null
    }> | null
    error: { message: string } | null
  }

  beforeEach(async () => {
    vi.resetModules()

    const { Errors } = await import('@/app/lib/errors/AppError')
    forbiddenError = Errors.forbidden('Admin access required', {
      error: 'Admin access required'
    })
    requireAppAdmin = vi.fn().mockResolvedValue(ADMIN_AUTH)
    rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    db = vi.fn().mockResolvedValue({ rpc })

    rosterResult = { data: [], error: null }
    const rosterQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn((column: string) =>
        column === 'display_name' ? Promise.resolve(rosterResult) : rosterQuery
      )
    }
    from = vi.fn().mockReturnValue(rosterQuery)
    serviceDb = vi.fn().mockReturnValue({ from })

    vi.doMock('@/app/lib/auth/app-admin', () => ({
      requireAppAdminForApi: requireAppAdmin
    }))
    vi.doMock('@/app/lib/db', () => ({ db, serviceDb }))
    ;({ GET } =
      await import('@/app/api/admin/invite-codes/guild-members/route'))
  })

  function request(guildCode = 'TEST'): NextRequest {
    return new NextRequest(
      `http://localhost/api/admin/invite-codes/guild-members?guild_code=${guildCode}`
    )
  }

  it('requires app-admin authority before either database lookup', async () => {
    requireAppAdmin.mockRejectedValue(forbiddenError)

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(serviceDb).not.toHaveBeenCalled()
    expect(db).not.toHaveBeenCalled()
  })

  it('requires an exact guild code before either database lookup', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/admin/invite-codes/guild-members')
    )

    expect(response.status).toBe(400)
    expect(serviceDb).not.toHaveBeenCalled()
    expect(db).not.toHaveBeenCalled()
  })

  it('uses the uncapped server-filtered active-invite RPC and maps its rows', async () => {
    const olderActivePlayerIds = Array.from(
      { length: 101 },
      (_, index) => `history-${index + 1}`
    )
    rosterResult.data = [
      ...olderActivePlayerIds.map((playerId) => ({
        player_id: playerId,
        display_name: playerId,
        role: 'member',
        user_id: null
      })),
      {
        player_id: 'claimed-player',
        display_name: 'Claimed Player',
        role: 'member',
        user_id: 'claimed-user'
      }
    ]
    rpc.mockResolvedValue({
      data: [
        ...olderActivePlayerIds.map((playerId, index) => ({
          player_id: playerId,
          code: `ACTIVE${index + 1}`,
          expires_at: '2026-12-31T00:00:00.000Z'
        })),
        {
          player_id: 'history-1',
          code: 'OLDER-DUPLICATE',
          expires_at: '2026-11-30T00:00:00.000Z'
        }
      ],
      error: null
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('player_mapping')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('list_active_player_invite_codes', {
      p_guild_code: 'TEST'
    })
    expect(rpc).not.toHaveBeenCalledWith(
      'list_player_invite_codes',
      expect.anything()
    )
    expect(body.members).toHaveLength(102)
    expect(body.members[0]).toMatchObject({
      player_id: 'history-1',
      has_account: false,
      active_invite_code: {
        code: 'ACTIVE1',
        expires_at: '2026-12-31T00:00:00.000Z'
      }
    })
    expect(body.members.at(-1)).toMatchObject({
      player_id: 'claimed-player',
      has_account: true,
      active_invite_code: null
    })
  })

  it('fails closed on an RPC error or malformed response', async () => {
    rosterResult.data = [
      {
        player_id: 'player-1',
        display_name: 'Player 1',
        role: 'member',
        user_id: null
      }
    ]
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'lookup failed', code: 'XX000' }
    })

    const failedLookup = await GET(request())
    expect(failedLookup.status).toBe(500)

    rpc.mockResolvedValueOnce({
      data: [
        {
          player_id: 'player-1',
          code: null,
          expires_at: '2026-12-31T00:00:00.000Z'
        }
      ],
      error: null
    })
    const malformedLookup = await GET(request())
    expect(malformedLookup.status).toBe(500)
  })
})
