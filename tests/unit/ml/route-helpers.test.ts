import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/app/lib/db'

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  requireMlScope: vi.fn(),
  requireSessionUser: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({ db: mocks.db }))
vi.mock('@/app/lib/api/session-user', () => ({
  requireSessionUser: mocks.requireSessionUser
}))
vi.mock('@/app/lib/ml/require-ml-scope', () => ({
  requireMlScope: mocks.requireMlScope
}))

import {
  authorizeMlRouteScope,
  callUntypedMlRpc
} from '@/app/lib/ml/route-helpers'

describe('ML route helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a missing guild before opening a database client', async () => {
    await expect(authorizeMlRouteScope(undefined, null)).rejects.toMatchObject({
      statusCode: 400
    })
    expect(mocks.db).not.toHaveBeenCalled()
  })

  it('authenticates and authorizes the requested scope once', async () => {
    const supabase = {} as Database
    mocks.db.mockResolvedValue(supabase)
    mocks.requireSessionUser.mockResolvedValue({ id: 'user-1' })
    mocks.requireMlScope.mockResolvedValue(undefined)

    await expect(authorizeMlRouteScope('EOT', 'CLUSTER')).resolves.toEqual({
      guildCode: 'EOT',
      supabase
    })
    expect(mocks.requireSessionUser).toHaveBeenCalledWith(
      supabase,
      expect.any(Function)
    )
    expect(mocks.requireMlScope).toHaveBeenCalledWith(
      supabase,
      'user-1',
      'EOT',
      'CLUSTER'
    )
  })

  it('binds and calls RPC methods outside the generated type surface', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ value: 1 }], error: null })
    const supabase = { rpc } as unknown as Database

    await expect(
      callUntypedMlRpc(supabase, 'new_rpc', { p_value: 1 })
    ).resolves.toEqual({ data: [{ value: 1 }], error: null })
    expect(rpc).toHaveBeenCalledWith('new_rpc', { p_value: 1 })
  })
})
