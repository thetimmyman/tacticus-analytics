import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

const requireActiveOfficerCommandAccess = vi.fn()
const serviceDb = vi.fn()
const getLatestSeason = vi.fn()
const analyzeMember = vi.fn()

describe('GET /api/officer/member-detail auth boundary', () => {
  let GET: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.doMock('@/app/lib/auth', () => ({ AuthError }))
    vi.doMock('@/app/api/officer/_shared/access', () => ({
      requireActiveOfficerCommandAccess
    }))
    vi.doMock('@/app/lib/db', () => ({ serviceDb }))
    vi.doMock('@/app/lib/utils/season', () => ({ getLatestSeason }))
    vi.doMock('@/app/lib/officer-briefing/analyze-member', () => ({
      analyzeMember
    }))
    ;({ GET } = await import('@/app/api/officer/member-detail/route'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves inactive-member AuthError before season or service-role work', async () => {
    requireActiveOfficerCommandAccess.mockRejectedValue(
      new AuthError('Current guild membership required', 'ONBOARDING_REQUIRED')
    )

    const response = await GET(
      new NextRequest(
        'http://localhost/api/officer/member-detail?display_name=Player'
      )
    )

    expect(response.status).toBe(403)
    expect(getLatestSeason).not.toHaveBeenCalled()
    expect(serviceDb).not.toHaveBeenCalled()
    expect(analyzeMember).not.toHaveBeenCalled()
  })
})
