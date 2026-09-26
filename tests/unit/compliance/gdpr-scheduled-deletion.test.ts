import { beforeEach, describe, expect, it, vi } from 'vitest'

// Battle-row anonymisation is one atomic RPC; its failure point is modelled here.
const anonymize = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('@/app/lib/compliance/anonymize-subject-battle-rows', () => ({
  anonymizeSubjectBattleRows: anonymize.fn
}))

const mocks = vi.hoisted(() => ({
  serviceDb: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('@/app/lib/db', () => ({
  db: vi.fn(),
  serviceDb: mocks.serviceDb
}))
vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => mocks.logger
}))

type FailurePoint =
  'anonymize' | 'prepare' | 'auth_delete' | 'complete_status' | null

function createDeletionClient(
  failure: FailurePoint = null,
  requestType: 'complete' | 'partial' = 'complete',
  dataCategories: string[] = requestType === 'complete' ? ['all'] : []
) {
  let activeFailure = failure
  let preparationCount = 0
  let authUserPresent = true
  let mappingPresent = true
  const statuses: string[] = []
  const mappingDelete = vi.fn()
  const pending = {
    request_id: '33333333-3333-4333-8333-333333333333',
    user_id: '11111111-1111-4111-8111-111111111111',
    request_type: requestType,
    requested_at: '2026-08-01T00:00:00.000Z',
    scheduled_for: '2026-08-02T00:00:00.000Z',
    status: 'scheduled',
    data_categories: dataCategories,
    completed_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z'
  }

  const from = vi.fn((table: string) => {
    if (table === 'gdpr_deletion_requests') {
      return {
        select: vi.fn(() => {
          const chain = {
            eq: vi.fn(() => chain),
            lte: vi.fn(() => chain),
            returns: vi.fn(async () => ({ data: [pending], error: null }))
          }
          return chain
        }),
        update: vi.fn((payload: { status: string }) => ({
          eq: vi.fn(async () => {
            statuses.push(payload.status)
            const shouldFail =
              payload.status === 'completed' &&
              activeFailure === 'complete_status'
            return {
              error: shouldFail ? { message: `${payload.status} failed` } : null
            }
          })
        }))
      }
    }
    if (table === 'webhook_config' || table === 'guild_themes') {
      return {
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null }))
        }))
      }
    }
    if (table === 'player_mapping') {
      return { delete: mappingDelete }
    }
    if (table === 'sim_director_thread') {
      return {
        delete: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null }))
        }))
      }
    }
    throw new Error(`Unexpected table ${table}`)
  })

  anonymize.fn.mockImplementation(async () => {
    if (activeFailure === 'anonymize') {
      throw new Error('Failed to anonymize battle data: anonymization failed')
    }
    return mappingPresent ? 1 : 0
  })

  const client = {
    from,
    rpc: vi.fn(async () => {
      if (activeFailure === 'prepare') {
        return { data: null, error: { message: 'prepare failed' } }
      }
      const isFirstPreparation = preparationCount === 0
      preparationCount += 1
      mappingPresent = false
      return {
        data: {
          success: true,
          cleared_mapping_count: isFirstPreparation ? 1 : 0,
          deleted_mapping_count: isFirstPreparation ? 1 : 0,
          subject_authority_blocked: true,
          revoked_attestations: isFirstPreparation ? 1 : 0,
          purged_loki_credential_count: isFirstPreparation ? 1 : 0,
          purged_loki_guild_codes: isFirstPreparation ? ['GUILD'] : [],
          binding_restorable: false
        },
        error: null
      }
    }),
    auth: {
      admin: {
        // An already-absent subject closes the record instead of failing forever.
        getUserById: vi.fn(async (userId: string) =>
          authUserPresent
            ? { data: { user: { id: userId } }, error: null }
            : {
                data: { user: null },
                error: {
                  message: 'User not found',
                  code: 'user_not_found',
                  status: 404
                }
              }
        ),
        deleteUser: vi.fn(async () => {
          if (activeFailure === 'auth_delete') {
            return { error: { message: 'auth deletion failed' } }
          }
          if (!authUserPresent) {
            return {
              error: {
                message: 'User not found',
                code: 'user_not_found',
                status: 404
              }
            }
          }
          authUserPresent = false
          return { error: null }
        })
      }
    }
  }

  return {
    client,
    statuses,
    mappingDelete,
    setFailure(nextFailure: FailurePoint) {
      activeFailure = nextFailure
    }
  }
}

describe('scheduled GDPR deletion fail-closed lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function run(
    failure: FailurePoint = null,
    requestType: 'complete' | 'partial' = 'complete',
    dataCategories?: string[]
  ) {
    const harness = createDeletionClient(failure, requestType, dataCategories)
    mocks.serviceDb.mockReturnValue(harness.client)
    const { gdprManager } = await import('@/app/lib/compliance/gdpr-manager')
    const audit = vi
      .spyOn(gdprManager, 'recordDataProcessing')
      .mockResolvedValue(undefined)
    await gdprManager.executeScheduledDeletions()
    return { ...harness, audit, gdprManager }
  }

  it.each(['anonymize', 'prepare'] as const)(
    'leaves the request scheduled without deleting Auth when %s fails',
    async (failure) => {
      const { client, statuses } = await run(failure)

      expect(statuses).toEqual([])
      expect(client.auth.admin.deleteUser).not.toHaveBeenCalled()
    }
  )

  it.each([[], ['analytics']])(
    'rejects a partial request before creating a scheduled row: %j',
    async (categories) => {
      const from = vi.fn()
      mocks.serviceDb.mockReturnValue({ from })
      const { gdprManager } = await import('@/app/lib/compliance/gdpr-manager')

      await expect(
        gdprManager.handleDataDeletionRequest(
          '11111111-1111-4111-8111-111111111111',
          'partial',
          categories
        )
      ).rejects.toThrow('Failed to process data deletion request')
      expect(from).not.toHaveBeenCalled()
    }
  )

  it.each([[], ['analytics']])(
    'keeps a directly inserted partial request scheduled: %j',
    async (categories) => {
      const { client, statuses } = await run(null, 'partial', categories)

      expect(statuses).toEqual([])
      expect(client.rpc).not.toHaveBeenCalled()
      expect(client.auth.admin.deleteUser).not.toHaveBeenCalled()
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'gdpr.deletion.execution_failed',
          requestType: 'partial'
        }),
        'gdpr.deletion.execution_failed'
      )
    }
  )

  it('treats a resolved Auth deletion error as retryable failure, never completion', async () => {
    const { statuses, audit } = await run('auth_delete')

    expect(statuses).toEqual([])
    expect(audit).not.toHaveBeenCalledWith(
      expect.objectContaining({ dataType: 'deletion_completed' })
    )
  })

  it('retries after completion-state failure and accepts an already-absent Auth user', async () => {
    const { client, statuses, audit, setFailure, gdprManager } =
      await run('complete_status')

    expect(statuses).toEqual(['completed', 'completed'])
    expect(audit).not.toHaveBeenCalledWith(
      expect.objectContaining({ dataType: 'deletion_completed' })
    )

    setFailure(null)
    await gdprManager.executeScheduledDeletions()

    // The retry closes via the already-absent path; erasure is not re-run.
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(client.auth.admin.deleteUser).toHaveBeenCalledTimes(1)
    expect(statuses).toEqual(['completed', 'completed', 'completed'])
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ dataType: 'deletion_completed' })
    )
  })

  it('delegates mapping deletion to the owner transaction before deleting Auth', async () => {
    const { client, statuses, audit, mappingDelete } = await run()

    expect(client.rpc).toHaveBeenCalledWith('prepare_player_account_deletion', {
      p_user_id: '11111111-1111-4111-8111-111111111111',
      p_reason: 'gdpr_erasure'
    })
    expect(mappingDelete).not.toHaveBeenCalled()
    expect(client.auth.admin.deleteUser).toHaveBeenCalledTimes(1)
    expect(statuses).toEqual(['completed'])
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ dataType: 'loki_credential_erasure' })
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ dataType: 'deletion_completed' })
    )
  })
})
