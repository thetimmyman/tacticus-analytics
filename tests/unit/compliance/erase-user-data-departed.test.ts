// Erasure reaches departed players through one atomic RPC; split, a concurrent claim gets tombstoned.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  anonymizeSubjectBattleRows: vi.fn(async (): Promise<number> => 0),
  preparePlayerAccountDeletion: vi.fn(async () => ({ data: {}, error: null })),
  parseAccountDeletionPreparation: vi.fn(() => ({
    purgedLokiCredentialCount: 0
  }))
}))

vi.mock('@/app/lib/compliance/anonymize-subject-battle-rows', () => ({
  anonymizeSubjectBattleRows: mocks.anonymizeSubjectBattleRows
}))
vi.mock('@/app/lib/auth/player-authority-lifecycle', () => ({
  preparePlayerAccountDeletion: mocks.preparePlayerAccountDeletion,
  parseAccountDeletionPreparation: mocks.parseAccountDeletionPreparation
}))
vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  })
}))

import {
  ErasureStepError,
  eraseAllUserData
} from '@/app/lib/compliance/erase-user-data'

function client() {
  const deleteUser = vi.fn(async () => ({ error: null }))
  const from = vi.fn((table: string) => {
    if (table === 'webhook_config' || table === 'guild_themes') {
      return { update: () => ({ eq: async () => ({ error: null }) }) }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return {
    supabase: { from, auth: { admin: { deleteUser } } },
    from,
    deleteUser
  }
}

describe('eraseAllUserData departed members (PS-670)', () => {
  beforeEach(() => {
    mocks.anonymizeSubjectBattleRows.mockReset()
    mocks.anonymizeSubjectBattleRows.mockResolvedValue(3)
    mocks.preparePlayerAccountDeletion.mockClear()
  })

  it('anonymises through the single atomic RPC, before the owner procedure', async () => {
    const c = client()

    await eraseAllUserData(c.supabase as never, 'user-1', 'gdpr_erasure')

    expect(mocks.anonymizeSubjectBattleRows).toHaveBeenCalledTimes(1)
    expect(mocks.anonymizeSubjectBattleRows).toHaveBeenCalledWith(
      c.supabase,
      'user-1'
    )
    // The owner procedure clears the user_id links resolution reads, so anonymisation runs first.
    expect(
      mocks.anonymizeSubjectBattleRows.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocks.preparePlayerAccountDeletion.mock.invocationCallOrder[0]
    )
    expect(c.from).not.toHaveBeenCalledWith('player_mapping')
    expect(c.from).not.toHaveBeenCalledWith('EOT_GR_data')
    expect(c.deleteUser).toHaveBeenCalledWith('user-1')
  })

  it('completes when the subject has no erasable players (0 rows)', async () => {
    mocks.anonymizeSubjectBattleRows.mockResolvedValue(0)
    const c = client()

    await eraseAllUserData(c.supabase as never, 'user-1', 'account_delete')

    expect(mocks.preparePlayerAccountDeletion).toHaveBeenCalledTimes(1)
    expect(c.deleteUser).toHaveBeenCalledWith('user-1')
  })

  it('fails closed at battle_data_anonymization before anything else is destroyed', async () => {
    mocks.anonymizeSubjectBattleRows.mockRejectedValue(
      new Error('Failed to anonymize battle data: boom')
    )
    const c = client()

    const error = await eraseAllUserData(
      c.supabase as never,
      'user-1',
      'gdpr_erasure'
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ErasureStepError)
    expect((error as ErasureStepError).step).toBe('battle_data_anonymization')
    expect(mocks.preparePlayerAccountDeletion).not.toHaveBeenCalled()
    expect(c.deleteUser).not.toHaveBeenCalled()
  })
})
