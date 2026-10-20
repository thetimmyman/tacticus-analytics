import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const serviceDb = vi.fn()
vi.mock('@/app/lib/db', () => ({
  serviceDb: (...args: unknown[]) => serviceDb(...args)
}))

function client(rows: unknown[] | null, error: unknown = null) {
  const calls: Record<string, unknown[]> = {}
  const chain = {
    from: (table: string) => ((calls.from = [table]), chain),
    select: (columns: string) => ((calls.select = [columns]), chain),
    eq: (column: string, value: string) => (
      (calls.eq = [column, value]),
      chain
    ),
    limit: async () => ({ data: rows, error })
  }
  return { chain, calls }
}

beforeEach(() => {
  vi.resetModules()
  serviceDb.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

it('reads the stop row through the bounded service client', async () => {
  const { chain, calls } = client([{ release_stage: 'coming_soon' }])
  serviceDb.mockReturnValue(chain)
  const { outboundHalted } =
    await import('@/app/lib/network/outbound-kill-switch')

  expect(await outboundHalted()).toBe(true)
  expect(calls.from).toEqual(['feature_releases'])
  expect(calls.eq).toEqual(['feature_key', 'upstream_outbound'])
  expect(serviceDb.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal)
})

it('stays open when the row is absent or the query fails', async () => {
  serviceDb.mockReturnValue(client([]).chain)
  const first = await import('@/app/lib/network/outbound-kill-switch')
  expect(await first.outboundHalted()).toBe(false)

  vi.resetModules()
  serviceDb.mockReturnValue(client(null, new Error('down')).chain)
  const second = await import('@/app/lib/network/outbound-kill-switch')
  expect(await second.outboundHalted()).toBe(false)
})

it('does not consult a central database on a desktop install', async () => {
  vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
  serviceDb.mockReturnValue(client([{ release_stage: 'coming_soon' }]).chain)
  const { outboundHalted } =
    await import('@/app/lib/network/outbound-kill-switch')

  expect(await outboundHalted()).toBe(false)
  expect(serviceDb).not.toHaveBeenCalled()
})
