import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

const requireActiveMembershipForApi = vi.fn()
const db = vi.fn()

describe('POST /api/briefing/seen', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.doMock('@/app/lib/auth', () => ({
      AuthError,
      requireActiveMembershipForApi
    }))
    vi.doMock('@/app/lib/db', () => ({ db }))
    ;({ POST } = await import('@/app/api/briefing/seen/route'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves inactive-membership AuthError before body parsing or database writes', async () => {
    requireActiveMembershipForApi.mockRejectedValue(
      new AuthError('Current guild membership required', 'ONBOARDING_REQUIRED')
    )

    const response = await POST(
      new NextRequest('http://localhost/api/briefing/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json'
      })
    )

    expect(response.status).toBe(403)
    expect(db).not.toHaveBeenCalled()
  })

  it('writes the active caller and guild cutoff', async () => {
    requireActiveMembershipForApi.mockResolvedValue({
      user: { id: 'user-1' },
      profile: { guild_code: 'GUILD1', role: 'member' }
    })
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn(() => ({ upsert }))
    db.mockResolvedValue({ from })
    const snapshotAt = '2026-08-09T12:00:00.000Z'

    const response = await POST(
      new NextRequest('http://localhost/api/briefing/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotAt })
      })
    )

    expect(response.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        guild_code: 'GUILD1',
        previous_cutoff_at: snapshotAt
      }),
      { onConflict: 'user_id,guild_code' }
    )
  })
})
