import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAppAdminForApi: vi.fn(),
  serviceDb: vi.fn(),
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  },
  UserBanLockLostError: class extends Error {},
  findActivelyBannedAuthUserIds: vi.fn(),
  setPlayerAppAdminBulk: vi.fn(),
  enqueueUserBanReconciliation: vi.fn(),
  withUserBanLock: vi.fn(),
  withUserBanLocks: vi.fn(),
  withUserBanLocksAfterLeaseLoss: vi.fn()
}))

vi.mock('@/app/lib/auth/app-admin', () => ({
  requireAppAdminForApi: mocks.requireAppAdminForApi
}))
vi.mock('@/app/lib/db', () => ({ serviceDb: mocks.serviceDb }))
vi.mock('@/app/lib/auth/user-bans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/auth/user-bans')>()),
  findActivelyBannedAuthUserIds: mocks.findActivelyBannedAuthUserIds
}))
vi.mock('@/app/lib/auth/player-authority-lifecycle', () => ({
  setPlayerAppAdminBulk: mocks.setPlayerAppAdminBulk
}))
vi.mock('@/app/lib/auth/user-ban-reconciliation', () => ({
  enqueueUserBanReconciliation: mocks.enqueueUserBanReconciliation
}))
vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => mocks.logger,
  logger: mocks.logger,
  logError: vi.fn(),
  generateRequestId: () => '11111111-1111-4111-8111-111111111111'
}))
vi.mock('@/app/lib/auth/user-ban-lock', () => ({
  InvalidUserBanAuthUserIdError: class extends Error {},
  UserBanLockLostError: mocks.UserBanLockLostError,
  UserBanOperationInProgressError: class extends Error {},
  canonicalizeUserBanAuthUserId: (userId: string) =>
    userId.trim().toLowerCase(),
  withUserBanLock: mocks.withUserBanLock,
  withUserBanLocks: mocks.withUserBanLocks,
  withUserBanLocksAfterLeaseLoss: mocks.withUserBanLocksAfterLeaseLoss
}))

const ADMIN_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TARGET_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/users/bans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function mutationChain(result: { data?: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['eq', 'is', 'lt']) {
    chain[method] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve)
  )
  return chain
}

function listChain(result: { data: unknown[]; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue(result),
    limit: vi.fn().mockResolvedValue(result)
  }
}

describe('admin user bans', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withUserBanLock.mockImplementation(
      async (
        _supabase: unknown,
        _userId: string,
        operation: (lease: { assertHeld: () => Promise<void> }) => unknown
      ) => operation({ assertHeld: vi.fn().mockResolvedValue(undefined) })
    )
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
    mocks.withUserBanLocksAfterLeaseLoss.mockImplementation(
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
    mocks.requireAppAdminForApi.mockResolvedValue({
      profile: { user_id: ADMIN_USER_ID, is_app_admin: true }
    })
    mocks.findActivelyBannedAuthUserIds.mockResolvedValue([])
    mocks.setPlayerAppAdminBulk.mockResolvedValue({ data: [], error: null })
    mocks.enqueueUserBanReconciliation.mockResolvedValue(
      'user-ban-reconcile:test'
    )
  })

  it('returns every active ban and paginates non-active history', async () => {
    const activePageOne = Array.from({ length: 500 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      banned_at: '2026-08-24T14:00:00Z'
    }))
    const activePageTwo = [
      {
        id: '00000000-0000-4000-8000-000000000500',
        banned_at: '2026-08-24T13:00:00Z'
      }
    ]
    const historyPage = [
      {
        id: '00000000-0000-4000-8000-000000000001',
        banned_at: '2026-08-24T12:00:00Z'
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        banned_at: '2026-08-24T11:00:00Z'
      }
    ]
    const from = vi
      .fn()
      .mockReturnValueOnce(listChain({ data: activePageOne, error: null }))
      .mockReturnValueOnce(listChain({ data: activePageTwo, error: null }))
      .mockReturnValueOnce(listChain({ data: historyPage, error: null }))
    mocks.serviceDb.mockReturnValue({ from })

    const { GET } = await import('@/app/api/admin/users/bans/route')
    const response = await GET(
      new NextRequest('http://localhost/api/admin/users/bans?history_limit=1')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.activeBans).toHaveLength(501)
    expect(body.historyBans).toEqual([historyPage[0]])
    expect(body.historyHasMore).toBe(true)
    expect(body.nextHistoryCursor).toEqual(expect.any(String))
  })

  it('applies the stable banned-at and id history cursor', async () => {
    const activeChain = listChain({ data: [], error: null })
    const historyChain = listChain({ data: [], error: null })
    mocks.serviceDb.mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(activeChain)
        .mockReturnValueOnce(historyChain)
    })
    const cursor = Buffer.from(
      JSON.stringify([
        '2026-08-24T12:00:00Z',
        '00000000-0000-4000-8000-000000000001'
      ])
    ).toString('base64url')

    const { GET } = await import('@/app/api/admin/users/bans/route')
    const response = await GET(
      new NextRequest(
        `http://localhost/api/admin/users/bans?history_limit=1&history_cursor=${cursor}`
      )
    )

    expect(response.status).toBe(200)
    expect(historyChain.or).toHaveBeenNthCalledWith(
      2,
      'banned_at.lt.2026-08-24T12:00:00Z,and(banned_at.eq.2026-08-24T12:00:00Z,id.gt.00000000-0000-4000-8000-000000000001)'
    )
  })

  it('requires an audit reason', async () => {
    const { POST } = await import('@/app/api/admin/users/bans/route')
    const response = await POST(
      request({
        user_id: TARGET_USER_ID,
        subject_types: ['user_id'],
        reason: '  '
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { message: 'A reason is required for the audit trail' }
    })
  })

  it('writes only selected identifiers and disables the auth credential', async () => {
    const insertedRows: unknown[] = []
    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    const expiredClose = mutationChain({ data: [], error: null })
    const userBans = {
      update: vi.fn().mockReturnValue(expiredClose),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({
          data: [{ expires_at: null }],
          error: null
        })
      }),
      insert: vi.fn((rows: unknown[]) => {
        insertedRows.push(...rows)
        return {
          select: vi.fn().mockResolvedValue({ data: rows, error: null })
        }
      })
    }
    const supabase = {
      auth: {
        admin: {
          updateUserById,
          getUserById: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: TARGET_USER_ID,
                identities: [
                  {
                    provider: 'discord',
                    identity_data: {
                      provider_id: '987654321098765432',
                      name: 'provider-user#0'
                    }
                  }
                ]
              }
            },
            error: null
          })
        }
      },
      from: vi.fn((table: string) => {
        if (table === 'player_mapping') {
          const adminOwnerLookup = {
            in: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: (value: unknown) => unknown) =>
              Promise.resolve({ data: [], error: null }).then(resolve)
            )
          }
          const mappingLookup = {
            select: vi.fn(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                discord_user_id: '123456789012345678',
                player_id: 'PLAYER-9',
                is_app_admin: false,
                display_name: 'Target'
              },
              error: null
            })
          }
          mappingLookup.select.mockImplementation((columns: string) =>
            columns === 'user_id' || columns === 'user_id,is_app_admin'
              ? adminOwnerLookup
              : mappingLookup
          )
          return mappingLookup
        }
        if (table === 'auth_user_emails') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { email: 'target@example.com' },
              error: null
            })
          }
        }
        return userBans
      })
    }
    mocks.serviceDb.mockReturnValue(supabase)

    const { POST } = await import('@/app/api/admin/users/bans/route')
    const response = await POST(
      request({
        user_id: TARGET_USER_ID.toUpperCase(),
        subject_types: ['player_id', 'discord_user_id'],
        reason: 'Repeated abuse'
      })
    )

    expect(response.status).toBe(200)
    expect(insertedRows).toHaveLength(3)
    expect(
      insertedRows.map((row) => (row as { subject_type: string }).subject_type)
    ).toEqual(['discord_user_id', 'discord_user_id', 'player_id'])
    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          auth_user_id: TARGET_USER_ID,
          subject_type: 'player_id',
          subject_value: 'player-9'
        }),
        expect.objectContaining({
          auth_user_id: TARGET_USER_ID,
          subject_type: 'discord_user_id',
          subject_value: '123456789012345678'
        }),
        expect.objectContaining({
          auth_user_id: TARGET_USER_ID,
          subject_type: 'discord_user_id',
          subject_value: '987654321098765432'
        })
      ])
    )
    expect(updateUserById).toHaveBeenCalledWith(TARGET_USER_ID, {
      ban_duration: expect.stringMatching(/s$/)
    })
  })

  it('rejects a Discord subject currently owned by another app admin', async () => {
    const updateUserById = vi.fn()
    const adminOwnerLookup = {
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: [
            {
              user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              is_app_admin: true
            }
          ],
          error: null
        }).then(resolve)
      )
    }
    const supabase = {
      auth: {
        admin: {
          updateUserById,
          getUserById: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: TARGET_USER_ID,
                identities: [
                  {
                    provider: 'discord',
                    identity_data: {
                      provider_id: '987654321098765432'
                    }
                  }
                ]
              }
            },
            error: null
          })
        }
      },
      from: vi.fn((table: string) => {
        if (table === 'player_mapping') {
          const mappingLookup = {
            select: vi.fn(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                discord_user_id: '123456789012345678',
                player_id: 'PLAYER-9',
                is_app_admin: false,
                display_name: 'Target'
              },
              error: null
            })
          }
          mappingLookup.select.mockImplementation((columns: string) =>
            columns === 'user_id' || columns === 'user_id,is_app_admin'
              ? adminOwnerLookup
              : mappingLookup
          )
          return mappingLookup
        }
        if (table === 'auth_user_emails') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { email: 'target@example.com' },
              error: null
            })
          }
        }
        throw new Error(`Unexpected table ${table}`)
      })
    }
    mocks.serviceDb.mockReturnValue(supabase)

    const { POST } = await import('@/app/api/admin/users/bans/route')
    const response = await POST(
      request({
        user_id: TARGET_USER_ID,
        subject_types: ['discord_user_id'],
        reason: 'Repeated abuse'
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.withUserBanLocks).toHaveBeenCalledWith(
      supabase,
      expect.arrayContaining([
        TARGET_USER_ID,
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      ]),
      expect.any(Function)
    )
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message:
          'Remove the app admin role from every matched identity owner before banning'
      }
    })
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('aborts when a Discord subject owner changes after lock preflight', async () => {
    const originalOwnerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const replacementOwnerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const ownerResults = [
      {
        data: [{ user_id: originalOwnerId, is_app_admin: false }],
        error: null
      },
      {
        data: [{ user_id: replacementOwnerId, is_app_admin: false }],
        error: null
      }
    ]
    const ownerLookup = {
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (value: unknown) => unknown) =>
        Promise.resolve(ownerResults.shift()).then(resolve)
      )
    }
    const supabase = {
      auth: {
        admin: {
          updateUserById: vi.fn(),
          getUserById: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: TARGET_USER_ID,
                identities: [
                  {
                    provider: 'discord',
                    identity_data: { provider_id: '987654321098765432' }
                  }
                ]
              }
            },
            error: null
          })
        }
      },
      from: vi.fn((table: string) => {
        if (table === 'player_mapping') {
          const mappingLookup = {
            select: vi.fn(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                discord_user_id: '123456789012345678',
                player_id: 'PLAYER-9',
                is_app_admin: false,
                display_name: 'Target'
              },
              error: null
            })
          }
          mappingLookup.select.mockImplementation((columns: string) =>
            columns === 'user_id' || columns === 'user_id,is_app_admin'
              ? ownerLookup
              : mappingLookup
          )
          return mappingLookup
        }
        if (table === 'auth_user_emails') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { email: 'target@example.com' },
              error: null
            })
          }
        }
        throw new Error(`Unexpected table ${table}`)
      })
    }
    mocks.serviceDb.mockReturnValue(supabase)

    const { POST } = await import('@/app/api/admin/users/bans/route')
    const response = await POST(
      request({
        user_id: TARGET_USER_ID,
        subject_types: ['discord_user_id'],
        reason: 'Repeated abuse'
      })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { message: 'A ban subject owner changed; refresh and retry' }
    })
    expect(mocks.withUserBanLocks).toHaveBeenCalledWith(
      supabase,
      expect.arrayContaining([TARGET_USER_ID, originalOwnerId]),
      expect.any(Function)
    )
    expect(supabase.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('keeps the durable ledger active when credential disablement fails', async () => {
    const expiredClose = mutationChain({ data: [], error: null })
    const userBans = {
      update: vi.fn().mockReturnValue(expiredClose),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({
          data: [{ expires_at: null }],
          error: null
        })
      }),
      insert: vi.fn((rows: unknown[]) => ({
        select: vi.fn().mockResolvedValue({ data: rows, error: null })
      }))
    }
    mocks.serviceDb.mockReturnValue({
      auth: {
        admin: {
          updateUserById: vi
            .fn()
            .mockResolvedValue({ error: { message: 'GoTrue unavailable' } })
        }
      },
      from: vi.fn((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { player_id: null, is_app_admin: false },
              error: null
            })
          }
        }
        if (table === 'auth_user_emails') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { email: 'target@example.com' },
              error: null
            })
          }
        }
        return userBans
      })
    })

    const { POST } = await import('@/app/api/admin/users/bans/route')
    const response = await POST(
      request({
        user_id: TARGET_USER_ID,
        subject_types: ['user_id'],
        reason: 'Credential compromise'
      })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message:
          'Application access is blocked, but the login credential could not be disabled'
      }
    })
    expect(userBans.insert).toHaveBeenCalledOnce()
  })

  it('reconciles the credential from the ledger when the lease is lost in flight', async () => {
    let originalScopeReleased = false
    const assertHeld = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new mocks.UserBanLockLostError())
    mocks.withUserBanLocks.mockImplementation(
      async (
        _supabase: unknown,
        userIds: string[],
        operation: (
          leases: Array<{ assertHeld: () => Promise<void> }>
        ) => unknown
      ) => {
        try {
          return await operation(userIds.map(() => ({ assertHeld })))
        } finally {
          originalScopeReleased = true
        }
      }
    )
    mocks.withUserBanLocksAfterLeaseLoss.mockImplementation(
      async (
        _supabase: unknown,
        userIds: string[],
        operation: (
          leases: Array<{ assertHeld: () => Promise<void> }>
        ) => unknown
      ) => {
        expect(originalScopeReleased).toBe(true)
        return operation(
          userIds.map(() => ({
            assertHeld: vi.fn().mockResolvedValue(undefined)
          }))
        )
      }
    )

    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    const expiredClose = mutationChain({ data: [], error: null })
    const activeLookup = (data: Array<{ expires_at: string | null }>) => ({
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({
        data,
        error: null
      })
    })
    const userBans = {
      update: vi.fn().mockReturnValue(expiredClose),
      select: vi
        .fn()
        .mockReturnValueOnce(activeLookup([{ expires_at: null }]))
        .mockReturnValueOnce(activeLookup([])),
      insert: vi.fn((rows: unknown[]) => ({
        select: vi.fn().mockResolvedValue({ data: rows, error: null })
      }))
    }
    mocks.serviceDb.mockReturnValue({
      auth: { admin: { updateUserById } },
      from: vi.fn((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { player_id: null, is_app_admin: false },
              error: null
            })
          }
        }
        if (table === 'auth_user_emails') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { email: 'target@example.com' },
              error: null
            })
          }
        }
        return userBans
      })
    })

    const { POST } = await import('@/app/api/admin/users/bans/route')
    const response = await POST(
      request({
        user_id: TARGET_USER_ID,
        subject_types: ['user_id'],
        reason: 'Credential compromise'
      })
    )

    expect(response.status).toBe(500)
    expect(updateUserById).toHaveBeenNthCalledWith(1, TARGET_USER_ID, {
      ban_duration: expect.stringMatching(/s$/)
    })
    expect(updateUserById).toHaveBeenNthCalledWith(2, TARGET_USER_ID, {
      ban_duration: 'none'
    })
    expect(mocks.enqueueUserBanReconciliation).toHaveBeenCalledWith(
      expect.anything(),
      {
        lockUserIds: [TARGET_USER_ID],
        adminCandidateUserIds: [TARGET_USER_ID],
        credentialUserIds: [TARGET_USER_ID]
      }
    )
    expect(
      mocks.enqueueUserBanReconciliation.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocks.withUserBanLocksAfterLeaseLoss.mock.invocationCallOrder[0]!
    )
    expect(mocks.withUserBanLocksAfterLeaseLoss).toHaveBeenCalledOnce()
  })

  it('skips admin revocation for an unmapped pre-onboarding user after lease loss', async () => {
    const assertHeld = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new mocks.UserBanLockLostError())
    mocks.withUserBanLocks.mockImplementation(
      async (
        _supabase: unknown,
        userIds: string[],
        operation: (
          leases: Array<{ assertHeld: () => Promise<void> }>
        ) => unknown
      ) => operation(userIds.map(() => ({ assertHeld })))
    )
    mocks.findActivelyBannedAuthUserIds.mockResolvedValue([TARGET_USER_ID])

    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    const expiredClose = mutationChain({ data: [], error: null })
    const activeLookup = (data: Array<{ expires_at: string | null }>) => ({
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data, error: null })
    })
    const compensationAdminLookup = {
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve)
      )
    }
    const initialMappingLookup = {
      select: vi.fn(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
    }
    initialMappingLookup.select.mockImplementation((columns: string) =>
      columns === 'user_id' ? compensationAdminLookup : initialMappingLookup
    )
    const userBans = {
      update: vi.fn().mockReturnValue(expiredClose),
      select: vi
        .fn()
        .mockReturnValueOnce(activeLookup([{ expires_at: null }]))
        .mockReturnValueOnce(activeLookup([])),
      insert: vi.fn((rows: unknown[]) => ({
        select: vi.fn().mockResolvedValue({ data: rows, error: null })
      }))
    }
    mocks.serviceDb.mockReturnValue({
      auth: { admin: { updateUserById } },
      from: vi.fn((table: string) => {
        if (table === 'player_mapping') return initialMappingLookup
        if (table === 'auth_user_emails') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { email: 'new-user@example.com' },
              error: null
            })
          }
        }
        return userBans
      })
    })

    const { POST } = await import('@/app/api/admin/users/bans/route')
    const response = await POST(
      request({
        user_id: TARGET_USER_ID,
        subject_types: ['user_id'],
        reason: 'Pre-onboarding credential compromise'
      })
    )

    expect(response.status).toBe(500)
    expect(mocks.setPlayerAppAdminBulk).not.toHaveBeenCalled()
    expect(updateUserById).toHaveBeenNthCalledWith(1, TARGET_USER_ID, {
      ban_duration: expect.stringMatching(/s$/)
    })
    expect(updateUserById).toHaveBeenNthCalledWith(2, TARGET_USER_ID, {
      ban_duration: 'none'
    })
    expect(mocks.withUserBanLocksAfterLeaseLoss).toHaveBeenCalledOnce()
  })

  it('reconciles every locked Discord owner after a ban lease is lost', async () => {
    const ownerUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    let originalScopeReleased = false
    const targetAssertHeld = vi.fn().mockResolvedValue(undefined)
    const ownerAssertHeld = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new mocks.UserBanLockLostError())
    mocks.withUserBanLocks.mockImplementation(
      async (
        _supabase: unknown,
        userIds: string[],
        operation: (
          leases: Array<{ assertHeld: () => Promise<void> }>
        ) => unknown
      ) => {
        expect(userIds).toEqual(
          expect.arrayContaining([TARGET_USER_ID, ownerUserId])
        )
        try {
          return await operation([
            { assertHeld: targetAssertHeld },
            { assertHeld: ownerAssertHeld }
          ])
        } finally {
          originalScopeReleased = true
        }
      }
    )
    mocks.withUserBanLocksAfterLeaseLoss.mockImplementation(
      async (
        _supabase: unknown,
        userIds: string[],
        operation: (
          leases: Array<{ assertHeld: () => Promise<void> }>
        ) => unknown
      ) => {
        expect(originalScopeReleased).toBe(true)
        expect(userIds).toEqual(
          expect.arrayContaining([TARGET_USER_ID, ownerUserId])
        )
        return operation(
          userIds.map(() => ({
            assertHeld: vi.fn().mockResolvedValue(undefined)
          }))
        )
      }
    )
    mocks.findActivelyBannedAuthUserIds.mockResolvedValue([ownerUserId])
    mocks.setPlayerAppAdminBulk.mockResolvedValue({
      data: [{ user_id: ownerUserId }],
      error: null
    })

    const ownerLookup = {
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: [{ user_id: ownerUserId, is_app_admin: false }],
          error: null
        }).then(resolve)
      )
    }
    const mappingLookup = {
      select: vi.fn(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          discord_user_id: '123456789012345678',
          player_id: null,
          is_app_admin: false,
          display_name: 'Target'
        },
        error: null
      })
    }
    mappingLookup.select.mockImplementation((columns: string) =>
      columns === 'user_id' || columns === 'user_id,is_app_admin'
        ? ownerLookup
        : mappingLookup
    )

    const activeLookup = (data: Array<{ expires_at: string | null }>) => ({
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data, error: null })
    })
    const userBans = {
      update: vi.fn().mockReturnValue(mutationChain({ data: [], error: null })),
      select: vi
        .fn()
        .mockReturnValueOnce(activeLookup([{ expires_at: null }]))
        .mockReturnValueOnce(activeLookup([{ expires_at: null }])),
      insert: vi.fn((rows: unknown[]) => ({
        select: vi.fn().mockResolvedValue({ data: rows, error: null })
      }))
    }
    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    const getUserById = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: TARGET_USER_ID,
          identities: [
            {
              provider: 'discord',
              identity_data: { provider_id: '123456789012345678' }
            }
          ]
        }
      },
      error: null
    })
    const supabase = {
      auth: { admin: { updateUserById, getUserById } },
      from: vi.fn((table: string) => {
        if (table === 'player_mapping') return mappingLookup
        if (table === 'auth_user_emails') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { email: 'target@example.com' },
              error: null
            })
          }
        }
        return userBans
      })
    }
    mocks.serviceDb.mockReturnValue(supabase)

    const { POST } = await import('@/app/api/admin/users/bans/route')
    const response = await POST(
      request({
        user_id: TARGET_USER_ID,
        subject_types: ['discord_user_id'],
        reason: 'Credential compromise'
      })
    )

    expect(response.status).toBe(500)
    expect(mocks.findActivelyBannedAuthUserIds).toHaveBeenCalledWith(
      expect.arrayContaining([TARGET_USER_ID, ownerUserId]),
      supabase
    )
    expect(mocks.setPlayerAppAdminBulk).toHaveBeenCalledWith(
      supabase,
      [ownerUserId],
      false
    )
    expect(updateUserById).toHaveBeenCalledTimes(2)
  })
})

describe('admin user ban lifting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withUserBanLock.mockImplementation(
      async (
        _supabase: unknown,
        _userId: string,
        operation: (lease: { assertHeld: () => Promise<void> }) => unknown
      ) => operation({ assertHeld: vi.fn().mockResolvedValue(undefined) })
    )
    mocks.withUserBanLocksAfterLeaseLoss.mockImplementation(
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
    mocks.requireAppAdminForApi.mockResolvedValue({
      profile: { user_id: ADMIN_USER_ID, is_app_admin: true }
    })
    mocks.enqueueUserBanReconciliation.mockResolvedValue(
      'user-ban-reconcile:test'
    )
  })

  it('re-enables the credential and closes every row in the group', async () => {
    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    const selectChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [
          { auth_user_id: TARGET_USER_ID },
          { auth_user_id: TARGET_USER_ID }
        ],
        error: null
      })
    }
    const closeChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: [{ id: 'ban-1' }, { id: 'ban-2' }],
        error: null
      })
    }
    const remainingChain = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data: [], error: null })
    }
    const userBans = {
      select: vi
        .fn()
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(remainingChain),
      update: vi.fn().mockReturnValue(closeChain)
    }
    mocks.serviceDb.mockReturnValue({
      auth: { admin: { updateUserById } },
      from: vi.fn().mockReturnValue(userBans)
    })

    const { POST } = await import('@/app/api/admin/users/bans/lift/route')
    const response = await POST(
      new NextRequest('http://localhost/api/admin/users/bans/lift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ban_group_id: 'group-1',
          lift_reason: 'Appeal accepted'
        })
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ liftedCount: 2 })
    expect(updateUserById).toHaveBeenCalledWith(TARGET_USER_ID, {
      ban_duration: 'none'
    })
    expect(userBans.update).toHaveBeenCalledWith(
      expect.objectContaining({
        lifted_by: ADMIN_USER_ID,
        lift_reason: 'Appeal accepted'
      })
    )
    expect(updateUserById.mock.invocationCallOrder[0]).toBeLessThan(
      userBans.update.mock.invocationCallOrder[0]!
    )
  })

  it('keeps the ledger group active when credential re-enable fails', async () => {
    const updateUserById = vi.fn().mockResolvedValue({
      error: { message: 'GoTrue unavailable' }
    })
    const groupLookup = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [{ auth_user_id: TARGET_USER_ID }],
        error: null
      })
    }
    const remainingLookup = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data: [], error: null })
    }
    const userBans = {
      select: vi
        .fn()
        .mockReturnValueOnce(groupLookup)
        .mockReturnValueOnce(groupLookup)
        .mockReturnValueOnce(remainingLookup),
      update: vi.fn()
    }
    mocks.serviceDb.mockReturnValue({
      auth: { admin: { updateUserById } },
      from: vi.fn().mockReturnValue(userBans)
    })

    const { POST } = await import('@/app/api/admin/users/bans/lift/route')
    const response = await POST(
      new NextRequest('http://localhost/api/admin/users/bans/lift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban_group_id: 'group-1' })
      })
    )

    expect(response.status).toBe(500)
    expect(userBans.update).not.toHaveBeenCalled()
  })

  it('leaves the ledger active when the final close fails', async () => {
    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    const groupLookup = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [{ auth_user_id: TARGET_USER_ID }],
        error: null
      })
    }
    const remainingLookup = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data: [], error: null })
    }
    const closeChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'ledger unavailable' }
      })
    }
    const userBans = {
      select: vi
        .fn()
        .mockReturnValueOnce(groupLookup)
        .mockReturnValueOnce(groupLookup)
        .mockReturnValueOnce(remainingLookup),
      update: vi.fn().mockReturnValue(closeChain)
    }
    mocks.serviceDb.mockReturnValue({
      auth: { admin: { updateUserById } },
      from: vi.fn().mockReturnValue(userBans)
    })

    const { POST } = await import('@/app/api/admin/users/bans/lift/route')
    const response = await POST(
      new NextRequest('http://localhost/api/admin/users/bans/lift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban_group_id: 'group-1' })
      })
    )

    expect(response.status).toBe(500)
    expect(updateUserById).toHaveBeenCalledWith(TARGET_USER_ID, {
      ban_duration: 'none'
    })
    expect(userBans.update).toHaveBeenCalledOnce()
  })

  it('reconciles the credential again when the lease is lost after ledger close', async () => {
    let originalScopeReleased = false
    const assertHeld = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new mocks.UserBanLockLostError('lease lost'))
    mocks.withUserBanLock.mockImplementation(
      async (
        _supabase: unknown,
        _userId: string,
        operation: (lease: { assertHeld: () => Promise<void> }) => unknown
      ) => {
        try {
          return await operation({ assertHeld })
        } finally {
          originalScopeReleased = true
        }
      }
    )
    mocks.withUserBanLocksAfterLeaseLoss.mockImplementation(
      async (
        _supabase: unknown,
        userIds: string[],
        operation: (
          leases: Array<{ assertHeld: () => Promise<void> }>
        ) => unknown
      ) => {
        expect(originalScopeReleased).toBe(true)
        return operation(
          userIds.map(() => ({
            assertHeld: vi.fn().mockResolvedValue(undefined)
          }))
        )
      }
    )
    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    const groupLookup = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [{ auth_user_id: TARGET_USER_ID }],
        error: null
      })
    }
    const remainingLookup = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data: [], error: null })
    }
    const compensationLookup = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({
        data: [{ expires_at: null }],
        error: null
      })
    }
    const closeChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: [{ id: 'ban-1' }],
        error: null
      })
    }
    const userBans = {
      select: vi
        .fn()
        .mockReturnValueOnce(groupLookup)
        .mockReturnValueOnce(groupLookup)
        .mockReturnValueOnce(remainingLookup)
        .mockReturnValueOnce(compensationLookup),
      update: vi.fn().mockReturnValue(closeChain)
    }
    mocks.serviceDb.mockReturnValue({
      auth: { admin: { updateUserById } },
      from: vi.fn().mockReturnValue(userBans)
    })

    const { POST } = await import('@/app/api/admin/users/bans/lift/route')
    const response = await POST(
      new NextRequest('http://localhost/api/admin/users/bans/lift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban_group_id: 'group-1' })
      })
    )

    expect(response.status).toBe(500)
    expect(updateUserById).toHaveBeenNthCalledWith(1, TARGET_USER_ID, {
      ban_duration: 'none'
    })
    expect(updateUserById).toHaveBeenNthCalledWith(2, TARGET_USER_ID, {
      ban_duration: expect.stringMatching(/s$/)
    })
    expect(mocks.enqueueUserBanReconciliation).toHaveBeenCalledWith(
      expect.anything(),
      {
        lockUserIds: [TARGET_USER_ID],
        credentialUserIds: [TARGET_USER_ID]
      }
    )
    expect(mocks.withUserBanLocksAfterLeaseLoss).toHaveBeenCalledOnce()
  })

  it('reconciles an ambiguous credential write when its response and lease are lost', async () => {
    let originalScopeReleased = false
    const assertHeld = vi.fn().mockResolvedValue(undefined)
    mocks.withUserBanLock.mockImplementation(
      async (
        _supabase: unknown,
        _userId: string,
        operation: (lease: { assertHeld: () => Promise<void> }) => unknown
      ) => {
        try {
          return await operation({ assertHeld })
        } catch {
          throw new mocks.UserBanLockLostError('lease lost')
        } finally {
          originalScopeReleased = true
        }
      }
    )
    mocks.withUserBanLocksAfterLeaseLoss.mockImplementation(
      async (
        _supabase: unknown,
        userIds: string[],
        operation: (
          leases: Array<{ assertHeld: () => Promise<void> }>
        ) => unknown
      ) => {
        expect(originalScopeReleased).toBe(true)
        return operation(
          userIds.map(() => ({
            assertHeld: vi.fn().mockResolvedValue(undefined)
          }))
        )
      }
    )
    const updateUserById = vi
      .fn()
      .mockRejectedValueOnce(new Error('credential response was lost'))
      .mockResolvedValueOnce({ error: null })
    const groupLookup = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [{ auth_user_id: TARGET_USER_ID }],
        error: null
      })
    }
    const remainingLookup = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data: [], error: null })
    }
    const compensationLookup = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({
        data: [{ expires_at: null }],
        error: null
      })
    }
    const userBans = {
      select: vi
        .fn()
        .mockReturnValueOnce(groupLookup)
        .mockReturnValueOnce(groupLookup)
        .mockReturnValueOnce(remainingLookup)
        .mockReturnValueOnce(compensationLookup),
      update: vi.fn()
    }
    mocks.serviceDb.mockReturnValue({
      auth: { admin: { updateUserById } },
      from: vi.fn().mockReturnValue(userBans)
    })

    const { POST } = await import('@/app/api/admin/users/bans/lift/route')
    const response = await POST(
      new NextRequest('http://localhost/api/admin/users/bans/lift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban_group_id: 'group-1' })
      })
    )

    expect(response.status).toBe(500)
    expect(userBans.update).not.toHaveBeenCalled()
    expect(updateUserById).toHaveBeenNthCalledWith(1, TARGET_USER_ID, {
      ban_duration: 'none'
    })
    expect(updateUserById).toHaveBeenNthCalledWith(2, TARGET_USER_ID, {
      ban_duration: expect.stringMatching(/s$/)
    })
    expect(mocks.withUserBanLocksAfterLeaseLoss).toHaveBeenCalledOnce()
  })

  it('recomputes GoTrue duration from a shorter remaining ban', async () => {
    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    const groupLookup = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [{ auth_user_id: TARGET_USER_ID }],
        error: null
      })
    }
    const closeChain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: [{ id: 'ban-1' }],
        error: null
      })
    }
    const remainingLookup = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({
        data: [{ expires_at: new Date(Date.now() + 3_600_000).toISOString() }],
        error: null
      })
    }
    const userBans = {
      select: vi
        .fn()
        .mockReturnValueOnce(groupLookup)
        .mockReturnValueOnce(groupLookup)
        .mockReturnValueOnce(remainingLookup),
      update: vi.fn().mockReturnValue(closeChain)
    }
    mocks.serviceDb.mockReturnValue({
      auth: { admin: { updateUserById } },
      from: vi.fn().mockReturnValue(userBans)
    })

    const { POST } = await import('@/app/api/admin/users/bans/lift/route')
    const response = await POST(
      new NextRequest('http://localhost/api/admin/users/bans/lift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban_group_id: 'group-1' })
      })
    )

    expect(response.status).toBe(200)
    expect(updateUserById).toHaveBeenCalledWith(TARGET_USER_ID, {
      ban_duration: expect.stringMatching(/^3\d{3}s$/)
    })
  })
})
