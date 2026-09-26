import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Pins: session + guild membership required; the RPC gets only validated inputs.

const { dbMock, serviceRpc, requireGuildMemberMock, requireSessionUserMock } =
  vi.hoisted(() => ({
    dbMock: vi.fn(),
    serviceRpc: vi.fn(),
    requireGuildMemberMock: vi.fn(),
    requireSessionUserMock: vi.fn()
  }))

vi.mock('@/app/lib/db', () => ({
  db: dbMock,
  serviceDb: () => ({ rpc: serviceRpc })
}))
vi.mock('@/app/lib/auth/guild-permissions', () => ({
  requireGuildMember: requireGuildMemberMock
}))
vi.mock('@/app/lib/api/session-user', () => ({
  requireSessionUser: requireSessionUserMock
}))

const request = (query: string) =>
  new NextRequest(
    `http://localhost/api/performance/five-season-averages${query}`
  )

describe('GET /api/performance/five-season-averages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.mockResolvedValue({})
    requireSessionUserMock.mockResolvedValue({ id: 'user-1' })
    requireGuildMemberMock.mockResolvedValue(undefined)
    serviceRpc.mockResolvedValue({ data: [], error: null })
  })

  it('rejects a missing guild parameter with 400', async () => {
    const { GET } = await import('./route')
    const response = await GET(request('?season=83'))
    expect(response.status).toBe(400)
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric season with 400', async () => {
    const { GET } = await import('./route')
    const response = await GET(request('?guild=G1&season=abc'))
    expect(response.status).toBe(400)
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it('propagates the membership gate rejection without calling the RPC', async () => {
    const { Errors } = await import('@/app/lib/errors/AppError')
    requireGuildMemberMock.mockRejectedValue(
      Errors.forbidden('Not a member of this guild')
    )
    const { GET } = await import('./route')
    const response = await GET(request('?guild=G1&season=83'))
    expect(response.status).toBe(403)
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it('calls the service-role RPC with validated args and returns its rows', async () => {
    const rows = [{ player_id: 'p1', player_name: 'Alpha' }]
    serviceRpc.mockResolvedValue({ data: rows, error: null })

    const { GET } = await import('./route')
    const response = await GET(request('?guild=G1&season=83'))

    expect(requireGuildMemberMock).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'G1',
      '/api/performance/five-season-averages'
    )
    expect(serviceRpc).toHaveBeenCalledWith('get_player_five_season_averages', {
      p_guild_code: 'G1',
      p_current_season: 83
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual(rows)
  })

  it('maps an RPC error to a 500 without leaking details', async () => {
    serviceRpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for table player_mapping' }
    })
    const { GET } = await import('./route')
    const response = await GET(request('?guild=G1&season=83'))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('player_mapping')
  })
})
