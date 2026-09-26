/** Never throws, even on a synchronous client fault; api_key_added_at is stamped only once. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { persistPlayerApiKey } from '@/app/lib/profile/persist-player-api-key'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

vi.mock('@tacticus/app-core/encryption', () => ({
  encryptApiKey: vi.fn()
}))

import { encryptApiKey } from '@tacticus/app-core/encryption'

interface CapturedUpdate {
  payload: Record<string, unknown> | null
  filters: Array<[string, unknown]>
  readFilters: Array<[string, unknown]>
}

function makeClient(options?: {
  existingAddedAt?: string | null
  readError?: { message: string } | null
  updateError?: { message: string } | null
  updateThrows?: boolean
}): { client: TypedSupabaseClient; captured: CapturedUpdate } {
  const captured: CapturedUpdate = {
    payload: null,
    filters: [],
    readFilters: []
  }

  const readChain = {
    select: vi.fn(() => readChain),
    eq: vi.fn((column: string, value: string | boolean) => {
      captured.readFilters.push([column, value])
      return readChain
    }),
    maybeSingle: vi.fn(async () => ({
      data:
        options?.readError != null
          ? null
          : { api_key_added_at: options?.existingAddedAt ?? null },
      error: options?.readError ?? null
    }))
  }

  const updateChain = {
    update: vi.fn((payload: Record<string, unknown>) => {
      if (options?.updateThrows) {
        throw new Error('synchronous client fault')
      }
      captured.payload = payload
      return updateChain
    }),
    eq: vi.fn((column: string, value: string | boolean) => {
      captured.filters.push([column, value])
      return updateChain
    }),
    then: (resolve: (value: { error: { message: string } | null }) => void) =>
      Promise.resolve({ error: options?.updateError ?? null }).then(resolve)
  }

  let fromCalls = 0
  const client = {
    from: vi.fn(() => {
      fromCalls += 1
      return fromCalls === 1 ? readChain : updateChain
    })
  } as unknown as TypedSupabaseClient
  return { client, captured }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(encryptApiKey).mockResolvedValue('encrypted-blob')
})

describe('persistPlayerApiKey', () => {
  it('writes ALL FOUR credential columns when api_key_added_at is null (transfer path), scoped to user_id/is_current', async () => {
    const { client, captured } = makeClient({ existingAddedAt: null })
    const result = await persistPlayerApiKey(client, 'user-1', '  raw-key  ')

    expect(result).toEqual({ ok: true })
    expect(encryptApiKey).toHaveBeenCalledWith('raw-key')
    expect(captured.payload).toMatchObject({
      tacticus_api_key_encrypted: 'encrypted-blob',
      api_key_is_valid: true
    })
    expect(captured.payload?.api_key_last_verified).toEqual(expect.any(String))
    expect(captured.payload?.api_key_added_at).toEqual(expect.any(String))
    expect(captured.filters).toEqual([
      ['user_id', 'user-1'],
      ['is_current', true]
    ])
    expect(captured.readFilters).toEqual([
      ['user_id', 'user-1'],
      ['is_current', true]
    ])
  })

  it("does NOT restamp api_key_added_at when the row already carries one ('first added' semantics)", async () => {
    const { client, captured } = makeClient({
      existingAddedAt: '2026-01-01T00:00:00Z'
    })
    const result = await persistPlayerApiKey(client, 'user-1', 'key')
    expect(result).toEqual({ ok: true })
    expect(captured.payload).not.toHaveProperty('api_key_added_at')
    expect(captured.payload).toMatchObject({
      tacticus_api_key_encrypted: 'encrypted-blob',
      api_key_is_valid: true
    })
    expect(captured.payload?.api_key_last_verified).toEqual(expect.any(String))
  })

  it('a failed added_at read falls toward stamping (keyless transferred row must not stay unstamped)', async () => {
    const { client, captured } = makeClient({
      readError: { message: 'read blip' }
    })
    const result = await persistPlayerApiKey(client, 'user-1', 'key')
    expect(result).toEqual({ ok: true })
    expect(captured.payload?.api_key_added_at).toEqual(expect.any(String))
  })

  it('includes player_power only when provided', async () => {
    const { client, captured } = makeClient()
    await persistPlayerApiKey(client, 'user-1', 'key', { playerPower: 123 })
    expect(captured.payload?.player_power).toBe(123)

    const second = makeClient()
    await persistPlayerApiKey(second.client, 'user-1', 'key')
    expect(second.captured.payload).not.toHaveProperty('player_power')
  })

  it('reports encrypt_failed without throwing and without touching the DB', async () => {
    vi.mocked(encryptApiKey).mockRejectedValue(new Error('kms down'))
    const { client } = makeClient()
    const result = await persistPlayerApiKey(client, 'user-1', 'key')
    expect(result).toEqual({ ok: false, reason: 'encrypt_failed' })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('reports update_failed with the DB detail', async () => {
    const { client } = makeClient({ updateError: { message: 'row locked' } })
    const result = await persistPlayerApiKey(client, 'user-1', 'key')
    expect(result).toEqual({
      ok: false,
      reason: 'update_failed',
      detail: 'row locked'
    })
  })

  it('NEVER throws: a synchronous client fault becomes update_failed (sec 1 / M4)', async () => {
    const { client } = makeClient({ updateThrows: true })
    const result = await persistPlayerApiKey(client, 'user-1', 'key')
    expect(result).toEqual({
      ok: false,
      reason: 'update_failed',
      detail: 'synchronous client fault'
    })
  })
})
