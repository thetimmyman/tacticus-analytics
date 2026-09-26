import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ctx = { jobId: 9, workerId: 'test', attempts: 1 }
let invoke: ReturnType<typeof vi.fn>
let handler: (
  payload: Record<string, unknown>,
  ctx: typeof ctx
) => Promise<Record<string, unknown> | void>

async function loadHandler() {
  const mod = await import('@/app/lib/jobs/guild-historical-backfill')
  return mod.__internal.handler as typeof handler
}

describe('guild-historical-backfill handler', () => {
  beforeEach(() => {
    vi.resetModules()
    invoke = vi.fn().mockResolvedValue({
      data: {
        success: true,
        stats: { totalInserted: 12, seasonsSuccessful: 2 },
        results: [
          { season: 99, success: true },
          { season: 98, success: false }
        ]
      },
      error: null
    })
    vi.doMock('@/app/lib/network/direct-supabase', () => ({
      createDirectClient: () => ({ invoke })
    }))
    vi.doMock('@/app/lib/jobs/dispatcher', () => ({
      registerJobHandler: vi.fn()
    }))
    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      })
    }))
  })

  afterEach(() => vi.restoreAllMocks())

  it('forwards durable forced season requests and returns processed seasons', async () => {
    handler = await loadHandler()
    const result = await handler(
      { guild_code: 'EOT', force_seasons: [99, 98], max_seasons: 2 },
      ctx
    )
    expect(invoke).toHaveBeenCalledWith('historical-backfill-modular', {
      guild_code: 'EOT',
      force_seasons: [99, 98],
      max_seasons: 2
    })
    expect(result).toMatchObject({ totalInserted: 12, seasonsProcessed: [99] })
  })

  it('rejects malformed optional controls before invoking the edge function', async () => {
    handler = await loadHandler()
    await expect(
      handler({ guild_code: 'EOT', force_seasons: '99' }, ctx)
    ).rejects.toThrow('payload.force_seasons is invalid')
    await expect(
      handler({ guild_code: 'EOT', max_seasons: 0 }, ctx)
    ).rejects.toThrow('payload.max_seasons is invalid')
    expect(invoke).not.toHaveBeenCalled()
  })
})
