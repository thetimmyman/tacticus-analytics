import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/db', () => ({ db: vi.fn(), serviceDb: vi.fn() }))
vi.mock('@/app/lib/api/session-user', () => ({
  requireSessionUser: vi.fn().mockResolvedValue({ id: 'user-1' })
}))
vi.mock('@/app/lib/auth/guild-permissions', () => ({
  requireGuildMember: vi.fn().mockResolvedValue(undefined),
  requireGuildOfficerOrClusterLeader: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/app/lib/discord/role-reconciler', () => ({
  reconcileGuildRoles: vi.fn().mockResolvedValue({ assigned: 0 })
}))

import { POST as saveConfig } from '@/app/api/guild-roles/config/route'
import { POST as reconcile } from '@/app/api/guild-roles/reconcile/route'
import { db, serviceDb } from '@/app/lib/db'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import { reconcileGuildRoles } from '@/app/lib/discord/role-reconciler'

const sessionClient = { from: vi.fn() }
const upsert = vi.fn()
const serviceClient = { from: vi.fn(() => ({ upsert })) }

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body)
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db).mockResolvedValue(sessionClient as never)
  vi.mocked(serviceDb).mockReturnValue(serviceClient as never)
  upsert.mockReturnValue({
    select: () => ({
      single: () =>
        Promise.resolve({
          data: {
            auto_role_assign_enabled: true,
            auto_role_assign_tier: 'strong'
          },
          error: null
        })
    })
  })
})

describe('guild Role Reconciler routes write with the service client', () => {
  it('POST /api/guild-roles/config authorizes the session, then upserts as service', async () => {
    const res = await saveConfig(
      post('/api/guild-roles/config', {
        guild_code: 'TEST',
        auto_role_assign_enabled: true
      })
    )

    expect(res.status).toBe(200)
    expect(requireGuildOfficerOrClusterLeader).toHaveBeenCalledWith(
      sessionClient,
      'user-1',
      'TEST',
      '/api/guild-roles/config'
    )
    expect(serviceClient.from).toHaveBeenCalledWith(
      'guild_roster_scoring_config'
    )
    expect(sessionClient.from).not.toHaveBeenCalled()
  })

  it('POST /api/guild-roles/config does not write when authorization fails', async () => {
    vi.mocked(requireGuildOfficerOrClusterLeader).mockRejectedValueOnce(
      new Error('forbidden')
    )

    const res = await saveConfig(
      post('/api/guild-roles/config', { guild_code: 'TEST' })
    )

    expect(res.status).toBe(500)
    expect(serviceDb).not.toHaveBeenCalled()
  })

  it('POST /api/guild-roles/reconcile hands the reconciler the service client', async () => {
    const res = await reconcile(
      post('/api/guild-roles/reconcile', { guild_code: 'TEST' })
    )

    expect(res.status).toBe(200)
    expect(requireGuildOfficerOrClusterLeader).toHaveBeenCalledWith(
      sessionClient,
      'user-1',
      'TEST',
      '/api/guild-roles/reconcile'
    )
    expect(reconcileGuildRoles).toHaveBeenCalledWith(
      serviceClient,
      'TEST',
      expect.objectContaining({ trigger_source: 'manual_resync' })
    )
  })
})
