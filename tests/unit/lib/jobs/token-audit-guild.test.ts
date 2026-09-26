import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ctx = { jobId: 1, workerId: 'w', attempts: 1 }

type AuditSummary = {
  held: boolean
  season: string | null
  guild_code: string
  skipped: boolean
  reason: string | null
  result: {
    guild_code: string
    mode: string
    live_eligible: number
    live_fetched: number
    rows_inserted: number
  } | null
}

const runTokenAuditForGuild =
  vi.fn<(args: { guildCode: string }) => Promise<AuditSummary>>()

function mockDeps() {
  vi.doMock('@/app/lib/logging', () => ({
    createComponentLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }))
  vi.doMock('@/app/lib/jobs/dispatcher', () => ({
    registerJobHandler: vi.fn()
  }))
  vi.doMock('@/app/lib/token-audit/run-token-audit', () => ({
    runTokenAuditForGuild
  }))
}

describe('token-audit-guild handler', () => {
  let handler: (
    payload: Record<string, unknown>,
    context: typeof ctx
  ) => Promise<Record<string, unknown> | void>

  beforeEach(async () => {
    vi.resetModules()
    runTokenAuditForGuild.mockReset()
    mockDeps()
    const mod = await import('@/app/lib/jobs/token-audit-guild')
    handler = mod.__internal.tokenAuditGuildHandler
  })

  afterEach(() => vi.restoreAllMocks())

  it('throws on a missing guild_code so the queue records a failure', async () => {
    await expect(handler({}, ctx)).rejects.toThrow(/guild_code/)
    await expect(handler({ guild_code: '  ' }, ctx)).rejects.toThrow(
      /guild_code/
    )
    await expect(handler({ guild_code: 7 }, ctx)).rejects.toThrow(/guild_code/)
    expect(runTokenAuditForGuild).not.toHaveBeenCalled()
  })

  it('trims the guild code and returns the audit summary as job result', async () => {
    runTokenAuditForGuild.mockResolvedValue({
      held: false,
      season: '106',
      guild_code: 'ABC',
      skipped: false,
      reason: null,
      result: {
        guild_code: 'ABC',
        mode: 'rollover',
        live_eligible: 10,
        live_fetched: 9,
        rows_inserted: 9
      }
    })

    const result = await handler({ guild_code: ' ABC ' }, ctx)

    expect(runTokenAuditForGuild).toHaveBeenCalledWith({ guildCode: 'ABC' })
    expect(result).toMatchObject({
      held: false,
      season: '106',
      guild_code: 'ABC',
      skipped: false,
      mode: 'rollover',
      rows_inserted: 9
    })
  })

  it('propagates skip outcomes without throwing (daily spacing is not a failure)', async () => {
    runTokenAuditForGuild.mockResolvedValue({
      held: false,
      season: '106',
      guild_code: 'DEF',
      skipped: true,
      reason: 'daily_spacing',
      result: null
    })

    const result = await handler({ guild_code: 'DEF' }, ctx)
    expect(result).toMatchObject({ skipped: true, reason: 'daily_spacing' })
  })

  it('lets audit errors escape so the worker fail/backoff path retries', async () => {
    runTokenAuditForGuild.mockRejectedValue(
      new Error('key-holder query failed')
    )
    await expect(handler({ guild_code: 'GHI' }, ctx)).rejects.toThrow(
      'key-holder query failed'
    )
  })
})
