import { beforeEach, describe, expect, it, vi } from 'vitest'

// NULL invite_expires_at means "never expires"; a past timestamp binds.

const clusterRow = {
  id: 'cluster-uuid-1',
  cluster_code: 'CLU',
  display_name: 'Test Cluster',
  invite_code: 'ABCDEF',
  max_guilds: 5,
  created_by: 'user-1'
}

let clusterResult: { data: unknown; error: unknown }

const mockSupabase = {
  from: vi.fn((table: string) => {
    if (table === 'clusters') {
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq']) {
        chain[method] = vi.fn(() => chain)
      }
      chain.single = vi.fn(async () => clusterResult)
      return chain
    }
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(async () => ({ data: [], error: null }))
    return chain
  })
}

vi.mock('@/app/lib/db', () => ({
  db: vi.fn(async () => mockSupabase)
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

describe('validateInviteCode — cluster invite expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a code whose cluster has no expiry set (every live code today)', async () => {
    clusterResult = {
      data: { ...clusterRow, invite_expires_at: null },
      error: null
    }
    const { validateInviteCode } = await import('@/app/lib/utils/invite-codes')

    await expect(validateInviteCode('ABCDEF')).resolves.toMatchObject({
      valid: true
    })
  })

  it('REFUSES a code whose cluster expiry has passed', async () => {
    clusterResult = {
      data: {
        ...clusterRow,
        invite_expires_at: new Date(Date.now() - 60_000).toISOString()
      },
      error: null
    }
    const { validateInviteCode } = await import('@/app/lib/utils/invite-codes')

    await expect(validateInviteCode('ABCDEF')).resolves.toEqual({
      valid: false,
      error: 'Invalid or expired invite code'
    })
  })

  it('accepts a code whose cluster expiry is still in the future', async () => {
    clusterResult = {
      data: {
        ...clusterRow,
        invite_expires_at: new Date(Date.now() + 60_000).toISOString()
      },
      error: null
    }
    const { validateInviteCode } = await import('@/app/lib/utils/invite-codes')

    await expect(validateInviteCode('ABCDEF')).resolves.toMatchObject({
      valid: true
    })
  })

  it('asks the database for the expiry column at all', async () => {
    clusterResult = {
      data: { ...clusterRow, invite_expires_at: null },
      error: null
    }
    const { validateInviteCode } = await import('@/app/lib/utils/invite-codes')
    await validateInviteCode('ABCDEF')

    const clustersChain = mockSupabase.from.mock.results[0]?.value as {
      select: ReturnType<typeof vi.fn>
    }
    expect(clustersChain.select).toHaveBeenCalledWith(
      expect.stringContaining('invite_expires_at')
    )
  })
})
