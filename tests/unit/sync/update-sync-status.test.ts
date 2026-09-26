import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Success must CLEAR error_message, or a recovered guild shows a stale error. */

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/app/lib/utils/error-handling', () => ({
  parseSupabaseError: vi.fn((error) => ({
    message: error?.message || 'Unknown error'
  }))
}))

function makeSupabase() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  return {
    supabase: { from: vi.fn().mockReturnValue({ upsert }) },
    upsert
  }
}

describe('updateSyncStatus clear-on-success', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("upserts error_message: null when status='completed' and no errorMessage given", async () => {
    const { updateSyncStatus } = await import('@/app/lib/sync/db-operations')
    const { supabase, upsert } = makeSupabase()

    await updateSyncStatus(supabase as never, 'TEST', 'completed', {
      recordsSynced: 42,
      memberCount: 10
    })

    expect(supabase.from).toHaveBeenCalledWith('guild_sync_status')
    const payload = upsert.mock.calls[0]![0] as Record<string, unknown>
    expect('error_message' in payload).toBe(true)
    expect(payload.error_message).toBeNull()
    expect(payload.status).toBe('completed')
    expect(payload.full_sync_success).toBe(true)
    expect(payload.records_synced).toBe(42)
  })

  it('clears a previously-set error when a completed sync omits errorMessage', async () => {
    const { updateSyncStatus } = await import('@/app/lib/sync/db-operations')
    const { upsert } = makeSupabase()
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) }

    await updateSyncStatus(supabase as never, 'TEST', 'completed', {
      recordsSynced: 5,
      errorMessage: null
    })

    const payload = upsert.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.error_message).toBeNull()
    expect(payload.full_sync_success).toBe(true)
  })

  it("preserves the error message and marks failure when status='error'", async () => {
    const { updateSyncStatus } = await import('@/app/lib/sync/db-operations')
    const { upsert } = makeSupabase()
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) }

    await updateSyncStatus(supabase as never, 'TEST', 'error', {
      errorMessage: 'LOKI 502'
    })

    const payload = upsert.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.status).toBe('error')
    expect(payload.full_sync_success).toBe(false)
    expect(payload.error_message).toBe('LOKI 502')
  })

  it('defaults numeric fields and upserts on guild_code conflict', async () => {
    const { updateSyncStatus } = await import('@/app/lib/sync/db-operations')
    const { upsert } = makeSupabase()
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) }

    await updateSyncStatus(supabase as never, 'GUILDX', 'completed', {})

    const [payload, options] = upsert.mock.calls[0]! as [
      Record<string, unknown>,
      Record<string, unknown>
    ]
    expect(payload.guild_code).toBe('GUILDX')
    expect(payload.records_synced).toBe(0)
    expect(payload.battle_count).toBe(0)
    expect(payload.member_count).toBe(0)
    expect(payload.error_message).toBeNull()
    expect(options).toMatchObject({ onConflict: 'guild_code' })
  })
})
