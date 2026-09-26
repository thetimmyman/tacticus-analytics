import { acquireLock } from '../../../supabase/functions/_shared/sync-modules/db-locking.ts'

const config = { table: 'execution_locks', lockTimeoutMs: 300000 }
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
function deps(result: unknown) {
  return {
    logger,
    supabase: {
      from: () => ({
        delete: () => ({ lt: async () => ({ error: null }) }),
        insert: () => ({ select: async () => result })
      })
    }
  }
}
describe('sync lock acquisition', () => {
  it('fails a cleanup error instead of reporting contention', async () => {
    const from = vi.fn(() => ({
      delete: () => ({
        lt: async () => ({ error: { message: 'unavailable' } })
      })
    }))
    await expect(
      acquireLock({ logger, supabase: { from } }, config, 'guild', null)
    ).rejects.toThrow('Execution lock cleanup failed')
    expect(from).toHaveBeenCalledTimes(1)
  })
  it('returns a contention skip only for a uniqueness conflict', async () => {
    expect(
      await acquireLock(
        deps({ error: { code: '23505' } }),
        config,
        'guild',
        null
      )
    ).toBeNull()
  })
  it.each([
    { error: { code: '42501' } },
    { error: { code: '08006' } },
    { data: null, error: null }
  ])(
    'fails a database error instead of treating it as a successful skip',
    async (result) => {
      await expect(
        acquireLock(deps(result), config, 'guild', null)
      ).rejects.toThrow('Execution lock acquisition failed')
    }
  )
})
