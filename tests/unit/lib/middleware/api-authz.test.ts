import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  findActiveBanForAuthUser: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({ db: mocks.db }))
vi.mock('@/app/lib/auth/user-bans', () => ({
  findActiveBanForAuthUser: mocks.findActiveBanForAuthUser
}))

function profileQuery(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result)
  }
}

describe('checkApiSecurity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findActiveBanForAuthUser.mockResolvedValue(null)
  })

  it('denies a session with an active durable ban before reading its role', async () => {
    const from = vi.fn()
    mocks.db.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null
        })
      },
      from
    })
    mocks.findActiveBanForAuthUser.mockResolvedValue({ id: 'ban-1' })

    const { checkApiSecurity } = await import('@/app/lib/middleware/api-authz')
    const result = await checkApiSecurity(
      new NextRequest('http://localhost/api/legacy')
    )

    expect(result).toEqual({
      allowed: false,
      reason: 'Account suspended',
      deniedStatus: 403
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('fails closed when the role lookup errors', async () => {
    const query = profileQuery({
      data: null,
      error: { message: 'profile lookup failed' }
    })
    mocks.db.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null
        })
      },
      from: vi.fn().mockReturnValue(query)
    })

    const { checkApiSecurity } = await import('@/app/lib/middleware/api-authz')
    const result = await checkApiSecurity(
      new NextRequest('http://localhost/api/legacy'),
      ['admin']
    )

    expect(result).toEqual({
      allowed: false,
      reason: 'Unable to verify permissions'
    })
  })
})
