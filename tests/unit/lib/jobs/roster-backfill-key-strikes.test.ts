import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (
  payload: Record<string, unknown>,
  context: { jobId: number; workerId: string; attempts: number }
) => Promise<Record<string, unknown> | void>

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
  getPlayerResult: vi.fn(),
  persistRosterSnapshot: vi.fn(),
  rpc: vi.fn(),
  players: [] as Record<string, unknown>[]
}))

function thenableQuery() {
  const query: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: mocks.players, error: null }).then(resolve)
  }
  for (const method of ['select', 'eq', 'not', 'or']) {
    query[method] = vi.fn(() => query)
  }
  return query
}

vi.mock('@/app/lib/db', () => ({
  serviceDb: () => ({ from: vi.fn(() => thenableQuery()), rpc: mocks.rpc })
}))
vi.mock('@tacticus/app-core/api-key-helper', () => ({
  getPlayerApiKey: vi.fn().mockResolvedValue('decrypted-key')
}))
vi.mock('@/app/lib/api/tacticus-client', () => ({
  tacticusAPI: { getPlayerResult: mocks.getPlayerResult },
  resolveMachinesOfWar: () => []
}))
vi.mock('@/app/lib/player/roster-sync', () => ({
  persistRosterSnapshot: mocks.persistRosterSnapshot
}))
vi.mock('@/app/lib/monitoring/sentry', () => ({
  captureSentryException: vi.fn()
}))
vi.mock('@/app/lib/jobs/dispatcher', () => ({
  registerJobHandler: (name: string, handler: unknown) =>
    mocks.handlers.set(name, handler)
}))

import { registerRosterBackfillHandler } from '@/app/lib/jobs/roster-backfill'

registerRosterBackfillHandler()
const handler = mocks.handlers.get('roster-backfill') as Handler
const run = () => handler({}, { jobId: 1, workerId: 'w', attempts: 1 })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.players = [
    {
      id: 11,
      user_id: 'user-1',
      player_id: 'player-1',
      display_name: 'Player 1',
      guild_code: 'GUILD',
      tacticus_api_key_encrypted: 'ciphertext'
    }
  ]
  mocks.rpc.mockResolvedValue({
    data: [{ strikes: 1, flagged: false, counted: true }],
    error: null
  })
  mocks.persistRosterSnapshot.mockResolvedValue({ upserted: 1 })
})

describe('roster-backfill and rejected player keys', () => {
  it.each([401, 403])(
    'records a key strike when Tacticus answers %i',
    async (status) => {
      mocks.getPlayerResult.mockResolvedValue({ player: null, status })

      const result = await run()

      expect(mocks.rpc).toHaveBeenCalledWith(
        'record_player_api_key_auth_failure',
        {
          p_player_id: 'player-1',
          p_cooldown_seconds: 600,
          p_decay_seconds: 86_400,
          p_threshold: 3
        }
      )
      expect(result).toMatchObject({ processed: 0, failed: 1 })
    }
  )

  it.each([
    ['a server error', { player: null, status: 500 }],
    ['a timeout', { player: null, status: null }]
  ])('does not count %s against the key', async (_label, outcome) => {
    mocks.getPlayerResult.mockResolvedValue(outcome)

    const result = await run()

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(result).toMatchObject({ failed: 1 })
  })

  it('syncs the roster and records no strike when the key works', async () => {
    mocks.getPlayerResult.mockResolvedValue({
      player: { details: { powerLevel: 5 }, units: [] },
      status: 200
    })

    const result = await run()

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.persistRosterSnapshot).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ processed: 1, failed: 0 })
  })

  it('still finishes the run when recording the strike fails', async () => {
    mocks.getPlayerResult.mockResolvedValue({ player: null, status: 403 })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })

    const result = await run()

    expect(result).toMatchObject({ failed: 1 })
  })
})
