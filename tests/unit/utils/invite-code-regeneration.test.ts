import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Regeneration must move `invite_expires_at` with the code, or an expired cluster gets a dead code. */

const CLUSTER_ID = 'cluster-uuid-1'
const OWNER_ID = 'user-1'

let clusterRow: Record<string, unknown>
let updates: Array<Record<string, unknown>>

function clustersChain() {
  let mode: 'row' | 'owner' | 'unique' | 'update' = 'row'
  const filters: Record<string, unknown> = {}
  const chain: Record<string, unknown> = {}

  chain.select = vi.fn((columns: string) => {
    mode = columns.includes('invite_expires_at')
      ? 'row'
      : columns.includes('created_by')
        ? 'owner'
        : 'unique'
    return chain
  })
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    updates.push(payload)
    clusterRow = { ...clusterRow, ...payload }
    mode = 'update'
    return chain
  })
  chain.eq = vi.fn((column: string, value: unknown) => {
    filters[column] = value
    return mode === 'update' ? Promise.resolve({ error: null }) : chain
  })
  chain.single = vi.fn(async () => {
    if (mode === 'owner') {
      return { data: { created_by: clusterRow.created_by }, error: null }
    }
    if (mode === 'unique') {
      return { data: null, error: null }
    }
    if (filters.invite_code && filters.invite_code !== clusterRow.invite_code) {
      return { data: null, error: { message: 'No rows found' } }
    }
    return { data: clusterRow, error: null }
  })

  return chain
}

const mockSupabase = {
  from: vi.fn((table: string) => {
    if (table === 'clusters') return clustersChain()
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

describe('regenerateClusterInviteCode — the expiry moves with the code', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updates = []
    clusterRow = {
      id: CLUSTER_ID,
      cluster_code: 'CLU',
      display_name: 'Test Cluster',
      invite_code: 'OLDCODE',
      max_guilds: 5,
      created_by: OWNER_ID,
      invite_expires_at: null
    }
  })

  it('mints a code that validates when the cluster expiry has already passed', async () => {
    clusterRow.invite_expires_at = new Date(Date.now() - 60_000).toISOString()
    const { regenerateClusterInviteCode, validateInviteCode } =
      await import('@/app/lib/utils/invite-codes')

    const result = await regenerateClusterInviteCode(CLUSTER_ID, OWNER_ID)
    expect(result.success).toBe(true)
    expect(result.inviteCode).toBeTruthy()

    await expect(
      validateInviteCode(result.inviteCode as string)
    ).resolves.toMatchObject({ valid: true })
  })

  it('clears the stale timestamp rather than leaving it next to a new code', async () => {
    clusterRow.invite_expires_at = new Date(Date.now() - 60_000).toISOString()
    const { regenerateClusterInviteCode } =
      await import('@/app/lib/utils/invite-codes')

    await regenerateClusterInviteCode(CLUSTER_ID, OWNER_ID)

    expect(updates).toHaveLength(1)
    expect(updates[0]).toHaveProperty('invite_expires_at', null)
  })

  it('writes an expiry it was given, so rotation can time-box the new code', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000)
    const { regenerateClusterInviteCode, validateInviteCode } =
      await import('@/app/lib/utils/invite-codes')

    const result = await regenerateClusterInviteCode(
      CLUSTER_ID,
      OWNER_ID,
      expiresAt
    )

    expect(updates[0]).toHaveProperty(
      'invite_expires_at',
      expiresAt.toISOString()
    )
    await expect(
      validateInviteCode(result.inviteCode as string)
    ).resolves.toMatchObject({ valid: true })
  })

  it('still refuses to regenerate for a caller who does not own the cluster', async () => {
    const { regenerateClusterInviteCode } =
      await import('@/app/lib/utils/invite-codes')

    await expect(
      regenerateClusterInviteCode(CLUSTER_ID, 'someone-else')
    ).resolves.toEqual({
      success: false,
      error: 'Unauthorized - you do not own this cluster'
    })
    expect(updates).toHaveLength(0)
  })
})
