import { beforeEach, describe, expect, it, vi } from 'vitest'

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const mocks = vi.hoisted(() => ({
  findActivelyBannedAuthUserIds: vi.fn(),
  setPlayerAppAdminBulk: vi.fn(),
  withUserBanLocks: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({ error: vi.fn() })
}))
vi.mock('@/app/lib/auth/user-bans', () => ({
  credentialBanDuration: (rows: unknown[]) =>
    rows.length > 0 ? '3153600000s' : 'none',
  findActivelyBannedAuthUserIds: mocks.findActivelyBannedAuthUserIds
}))
vi.mock('@/app/lib/auth/player-authority-lifecycle', () => ({
  setPlayerAppAdminBulk: mocks.setPlayerAppAdminBulk
}))
vi.mock('@/app/lib/auth/user-ban-lock', () => ({
  canonicalizeUserBanAuthUserId: (userId: string) => userId.toLowerCase(),
  withUserBanLocks: mocks.withUserBanLocks
}))

describe('durable user-ban reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withUserBanLocks.mockImplementation(
      async (
        _supabase: unknown,
        userIds: string[],
        operation: (
          leases: Array<{ assertHeld: () => Promise<void> }>
        ) => unknown
      ) =>
        operation(
          userIds.map(() => ({
            assertHeld: vi.fn().mockResolvedValue(undefined)
          }))
        )
    )
  })

  it('persists canonical high-retry jobs per serialized identity', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null })
    const supabase = {
      rpc
    }
    const { enqueueUserBanReconciliation } =
      await import('@/app/lib/auth/user-ban-reconciliation')

    const key = await enqueueUserBanReconciliation(supabase as never, {
      lockUserIds: [USER_B, USER_A, USER_B],
      adminCandidateUserIds: [USER_B],
      credentialUserIds: [USER_A]
    })

    expect(key).toMatch(/^user-ban-reconcile:[0-9a-f]{64}$/)
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('enqueue_user_ban_reconciliation_jobs', {
      p_jobs: [
        expect.objectContaining({
          dedupeKey: expect.stringMatching(/^user-ban-reconcile:[0-9a-f]{64}$/),
          payload: {
            lockUserIds: [USER_A],
            adminCandidateUserIds: [],
            credentialUserIds: [USER_A]
          }
        }),
        expect.objectContaining({
          dedupeKey: expect.stringMatching(/^user-ban-reconcile:[0-9a-f]{64}$/),
          payload: {
            lockUserIds: [USER_B],
            adminCandidateUserIds: [USER_B],
            credentialUserIds: []
          }
        })
      ]
    })
    const jobs = rpc.mock.calls[0]?.[1].p_jobs as Array<{
      dedupeKey: string
      payload: unknown
    }>
    expect(jobs[0]?.dedupeKey).not.toBe(jobs[1]?.dedupeKey)
  })

  it('fails the handoff when the atomic enqueue RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'transaction rolled back' }
    })
    const { enqueueUserBanReconciliation } =
      await import('@/app/lib/auth/user-ban-reconciliation')

    await expect(
      enqueueUserBanReconciliation({ rpc } as never, {
        lockUserIds: [USER_A],
        adminCandidateUserIds: [],
        credentialUserIds: [USER_A]
      })
    ).rejects.toThrow('transaction rolled back')
    expect(rpc).toHaveBeenCalledOnce()
  })

  it('reconciles mapped admins and credentials under fresh user locks', async () => {
    mocks.findActivelyBannedAuthUserIds.mockResolvedValue([USER_B])
    mocks.setPlayerAppAdminBulk.mockResolvedValue({
      data: [{ user_id: USER_B }],
      error: null
    })
    const mappingLookup = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [{ user_id: USER_B }], error: null }).then(
          resolve
        )
      )
    }
    const banLookup = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({
        data: [{ expires_at: null }],
        error: null
      })
    }
    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    const supabase = {
      auth: { admin: { updateUserById } },
      from: vi.fn((table: string) =>
        table === 'player_mapping' ? mappingLookup : banLookup
      )
    }
    const { reconcileUserBanState } =
      await import('@/app/lib/auth/user-ban-reconciliation')

    await expect(
      reconcileUserBanState(supabase as never, {
        lockUserIds: [USER_A, USER_B],
        adminCandidateUserIds: [USER_B],
        credentialUserIds: [USER_A]
      })
    ).resolves.toEqual({ adminsRevoked: 1, credentialsReconciled: 1 })
    expect(mocks.setPlayerAppAdminBulk).toHaveBeenCalledWith(
      supabase,
      [USER_B],
      false
    )
    expect(updateUserById).toHaveBeenCalledWith(USER_A, {
      ban_duration: '3153600000s'
    })
  })

  it('supports credential-only reconciliation jobs', async () => {
    const banLookup = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data: [], error: null })
    }
    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    const supabase = {
      auth: { admin: { updateUserById } },
      from: vi.fn().mockReturnValue(banLookup)
    }
    const { reconcileUserBanState } =
      await import('@/app/lib/auth/user-ban-reconciliation')

    await reconcileUserBanState(supabase as never, {
      lockUserIds: [USER_A],
      adminCandidateUserIds: [],
      credentialUserIds: [USER_A]
    })

    expect(mocks.findActivelyBannedAuthUserIds).not.toHaveBeenCalled()
    expect(mocks.setPlayerAppAdminBulk).not.toHaveBeenCalled()
    expect(updateUserById).toHaveBeenCalledWith(USER_A, {
      ban_duration: 'none'
    })
  })
})
