import { describe, expect, it, vi } from 'vitest'
import { anonymizeSubjectBattleRows } from '@/app/lib/compliance/anonymize-subject-battle-rows'

describe('anonymizeSubjectBattleRows', () => {
  const client = (result: { data: unknown; error: unknown }) => ({
    rpc: vi.fn(async () => result)
  })

  it('calls the atomic RPC for the subject and returns the anonymised row count', async () => {
    const c = client({ data: 3, error: null })
    await expect(anonymizeSubjectBattleRows(c, 'user-1')).resolves.toBe(3)
    expect(c.rpc).toHaveBeenCalledWith('anonymize_subject_battle_rows', {
      p_user_id: 'user-1'
    })
  })

  it('accepts zero rows (a subject with no players)', async () => {
    const c = client({ data: 0, error: null })
    await expect(anonymizeSubjectBattleRows(c, 'user-1')).resolves.toBe(0)
  })

  it('fails closed on an RPC error', async () => {
    const c = client({ data: null, error: { message: 'permission denied' } })
    await expect(anonymizeSubjectBattleRows(c, 'user-1')).rejects.toThrow(
      'Failed to anonymize battle data: permission denied'
    )
  })

  it.each([[null], ['3'], [-1], [1.5], [[{ player_id: 'p' }]]])(
    'fails closed on a malformed response %j',
    async (data) => {
      const c = client({ data, error: null })
      await expect(anonymizeSubjectBattleRows(c, 'user-1')).rejects.toThrow(
        'Failed to anonymize battle data: invalid response'
      )
    }
  )
})
