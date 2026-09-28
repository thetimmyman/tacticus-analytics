import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Fails closed: any failed discovery or invoke is a failure and last_tracked_season does not advance. */

type Handler = (
  payload: Record<string, unknown>,
  context: {
    jobId: number
    workerId: string
    attempts: number
    softDeadlineAt?: number
  }
) => Promise<Record<string, unknown> | void>

interface QueryResult {
  data: unknown
  error: string | null
}

interface InvokeResult {
  data: unknown
  error: string | null
}

type InvokeBehaviour = (
  guildCode: string,
  season: number | undefined
) => InvokeResult | Promise<InvokeResult>

interface DbOptions {
  tracking?: Array<{
    id: number
    last_tracked_season: number
    last_check_date: string
  }>
  trackingError?: string
  guilds?: Array<{ guild_code: string }>
  guildsError?: string
  invoke?: InvokeBehaviour
  mutateError?: string
}

interface MutateCall {
  path: string
  method: string
  body: Record<string, unknown>
}

type HandlerResult = {
  transitionDetected: boolean
  currentSeason: number
  previousSeason: number
  seasonsBackfilled: number[]
  totalEntriesAdded: number
  backfillResults: Array<{
    season: number
    success: boolean
    guildsProcessed: number
    entriesAdded: number
    failures: string[]
  }>
}

const context = { jobId: 902, workerId: 'vitest', attempts: 1 }

const CURRENT_SEASON = 100
const LAST_TRACKED_SEASON = 98
const ENDED_SEASON = 99

let query: ReturnType<typeof vi.fn>
let invoke: ReturnType<typeof vi.fn>
let mutate: ReturnType<typeof vi.fn>
let mutateCalls: MutateCall[]
let getSeasonTiming: ReturnType<typeof vi.fn>

let seasonTiming: { current: number; ended: number[] } = {
  current: CURRENT_SEASON,
  ended: [ENDED_SEASON]
}

function buildDb(opts: DbOptions): void {
  mutateCalls = []
  let trackingRows = opts.tracking ?? []
  query = vi.fn(async (path: string): Promise<QueryResult> => {
    if (path.startsWith('season_tracking')) {
      if (opts.trackingError) return { data: null, error: opts.trackingError }
      return { data: trackingRows, error: null }
    }
    if (path.startsWith('guild_config')) {
      if (opts.guildsError) return { data: null, error: opts.guildsError }
      return { data: opts.guilds ?? [], error: null }
    }
    return { data: null, error: null }
  })
  invoke = vi.fn(
    async (
      _fn: string,
      body: Record<string, unknown>
    ): Promise<InvokeResult> => {
      if (!opts.invoke) {
        return {
          data: { success: true, stats: { totalInserted: 0 } },
          error: null
        }
      }
      const seasons = body.force_seasons as number[] | undefined
      return opts.invoke(String(body.guild_code), seasons?.[0])
    }
  )
  mutate = vi.fn(
    async (
      path: string,
      method: string,
      body?: Record<string, unknown>
    ): Promise<QueryResult> => {
      mutateCalls.push({ path, method, body: body ?? {} })
      if (opts.mutateError) return { data: null, error: opts.mutateError }
      if (method === 'PATCH') {
        trackingRows = trackingRows.map((row) => ({
          ...row,
          last_tracked_season: Number(body?.last_tracked_season),
          last_check_date: String(body?.last_check_date)
        }))
      } else if (method === 'POST') {
        trackingRows = [
          {
            id: 8,
            last_tracked_season: Number(body?.last_tracked_season),
            last_check_date: String(body?.last_check_date)
          }
        ]
      }
      return { data: null, error: null }
    }
  )
}

function mockDeps(): void {
  vi.doMock('@/app/lib/logging', () => ({
    createComponentLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }))
  vi.doMock('@/app/lib/errors/AppError', () => ({
    rethrowIfAppError: vi.fn()
  }))
  vi.doMock('@/app/lib/jobs/dispatcher', () => ({
    registerJobHandler: vi.fn()
  }))
  vi.doMock('@/app/lib/network/direct-supabase', () => ({
    createDirectClient: () => ({ query, invoke, mutate })
  }))
  getSeasonTiming = vi.fn(async (season?: number) => {
    if (season === undefined) {
      return { seasonNumber: seasonTiming.current, hasEnded: false }
    }
    return {
      seasonNumber: season,
      hasEnded: seasonTiming.ended.includes(season)
    }
  })
  vi.doMock('@/app/lib/services/season-timing-service', () => ({
    getSeasonTiming
  }))
}

async function loadHandler(): Promise<Handler> {
  const mod = await import('@/app/lib/jobs/season-transition-monitor')
  return mod.__internal.seasonTransitionMonitorHandler as Handler
}

function trackingRow(lastTrackedSeason: number) {
  return [
    {
      id: 7,
      last_tracked_season: lastTrackedSeason,
      last_check_date: '2026-01-01'
    }
  ]
}

function lastCursorWrite(): unknown {
  return mutateCalls.at(-1)?.body.last_tracked_season
}

describe('season-transition-monitor: fail-closed retry/cursor', () => {
  beforeEach(() => {
    vi.resetModules()
    seasonTiming = { current: CURRENT_SEASON, ended: [ENDED_SEASON] }
    mockDeps()
  })

  afterEach(() => vi.restoreAllMocks())

  it('fails the job when the active-guild discovery query errors (not an empty run)', async () => {
    buildDb({
      tracking: trackingRow(LAST_TRACKED_SEASON),
      guildsError: 'HTTP 500: discovery boom'
    })
    const handler = await loadHandler()

    await expect(handler({}, context)).rejects.toThrow(/active guilds/)
    expect(invoke).not.toHaveBeenCalled()
    expect(mutateCalls).toHaveLength(0)
  })

  it('treats a fulfilled HTTP 200 success:false as a per-guild failure and holds the cursor', async () => {
    buildDb({
      tracking: trackingRow(LAST_TRACKED_SEASON),
      guilds: [{ guild_code: 'G1' }],
      invoke: () => ({
        data: {
          success: false,
          stats: { totalInserted: 0 },
          results: [
            {
              season: ENDED_SEASON,
              success: false,
              error: 'forced season failed'
            }
          ]
        },
        error: null
      })
    })
    const handler = await loadHandler()
    const result = (await handler({}, context)) as HandlerResult

    expect(result.backfillResults[0]).toMatchObject({
      season: ENDED_SEASON,
      success: false
    })
    expect(result.backfillResults[0].failures).toEqual([
      `G1: season ${ENDED_SEASON}: forced season failed`
    ])
    expect(result.totalEntriesAdded).toBe(0)
    expect(lastCursorWrite()).toBe(LAST_TRACKED_SEASON)
  })

  it('counts a bare success:false (no detail) as a failure instead of dropping it', async () => {
    buildDb({
      tracking: trackingRow(LAST_TRACKED_SEASON),
      guilds: [{ guild_code: 'G1' }],
      invoke: () => ({
        data: { success: false, stats: { totalInserted: 0 } },
        error: null
      })
    })
    const handler = await loadHandler()
    const result = (await handler({}, context)) as HandlerResult

    expect(result.backfillResults[0].success).toBe(false)
    expect(result.backfillResults[0].failures).toEqual([
      'G1: reported failure without detail'
    ])
    expect(lastCursorWrite()).toBe(LAST_TRACKED_SEASON)
  })

  it('treats a rejected invoke as a per-guild failure and holds the cursor', async () => {
    buildDb({
      tracking: trackingRow(LAST_TRACKED_SEASON),
      guilds: [{ guild_code: 'G1' }],
      invoke: () => {
        throw new Error('network down')
      }
    })
    const handler = await loadHandler()
    const result = (await handler({}, context)) as HandlerResult

    expect(result.backfillResults[0].success).toBe(false)
    expect(result.backfillResults[0].failures).toEqual(['G1: network down'])
    expect(lastCursorWrite()).toBe(LAST_TRACKED_SEASON)
  })

  it('holds the cursor on a mixed guild outcome while preserving successful inserted totals', async () => {
    buildDb({
      tracking: trackingRow(LAST_TRACKED_SEASON),
      guilds: [
        { guild_code: 'G1' },
        { guild_code: 'G2' },
        { guild_code: 'G3' }
      ],
      invoke: (code) => {
        if (code === 'G2') {
          return {
            data: {
              success: false,
              stats: { totalInserted: 0 },
              results: [
                {
                  season: ENDED_SEASON,
                  success: false,
                  error: 'partial failure'
                }
              ]
            },
            error: null
          }
        }
        return {
          data: {
            success: true,
            stats: { totalInserted: code === 'G1' ? 5 : 7 }
          },
          error: null
        }
      }
    })
    const handler = await loadHandler()
    const result = (await handler({}, context)) as HandlerResult

    expect(result.backfillResults[0].success).toBe(false)
    expect(result.backfillResults[0].guildsProcessed).toBe(3)
    expect(result.totalEntriesAdded).toBe(12)
    expect(result.backfillResults[0].failures).toEqual([
      `G2: season ${ENDED_SEASON}: partial failure`
    ])
    expect(lastCursorWrite()).toBe(LAST_TRACKED_SEASON)
  })

  it('advances the cursor to currentSeason only when every guild succeeded', async () => {
    buildDb({
      tracking: trackingRow(LAST_TRACKED_SEASON),
      guilds: [{ guild_code: 'G1' }, { guild_code: 'G2' }],
      invoke: (code) => ({
        data: {
          success: true,
          stats: { totalInserted: code === 'G1' ? 3 : 4 }
        },
        error: null
      })
    })
    const handler = await loadHandler()
    const result = (await handler({}, context)) as HandlerResult

    expect(result.backfillResults[0].success).toBe(true)
    expect(result.backfillResults[0].failures).toEqual([])
    expect(result.totalEntriesAdded).toBe(7)
    expect(lastCursorWrite()).toBe(CURRENT_SEASON)
  })

  it('advances the cursor on a legitimate empty active-guild set (no discovery error)', async () => {
    buildDb({
      tracking: trackingRow(LAST_TRACKED_SEASON),
      guilds: []
    })
    const handler = await loadHandler()
    const result = (await handler({}, context)) as HandlerResult

    expect(invoke).not.toHaveBeenCalled()
    expect(result.backfillResults[0]).toMatchObject({
      season: ENDED_SEASON,
      success: true,
      guildsProcessed: 0,
      entriesAdded: 0
    })
    expect(lastCursorWrite()).toBe(CURRENT_SEASON)
  })

  it('replays the stored current season 106 when currentSeason is 107', async () => {
    seasonTiming = { current: 107, ended: [106] }
    buildDb({
      tracking: trackingRow(106),
      guilds: [{ guild_code: 'G1' }],
      invoke: () => ({
        data: { success: true, stats: { totalInserted: 2 } },
        error: null
      })
    })
    const handler = await loadHandler()
    const result = (await handler({}, context)) as HandlerResult

    expect(result.seasonsBackfilled).toEqual([106])
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('historical-backfill-modular', {
      guild_code: 'G1',
      force_seasons: [106]
    })
    expect(result.totalEntriesAdded).toBe(2)
    expect(lastCursorWrite()).toBe(107)
  })

  it('replays the currentSeason - 1 fallback when no tracking row exists', async () => {
    seasonTiming = { current: 100, ended: [99] }
    buildDb({
      tracking: [],
      guilds: [{ guild_code: 'G1' }],
      invoke: () => ({
        data: { success: true, stats: { totalInserted: 1 } },
        error: null
      })
    })
    const handler = await loadHandler()
    const result = (await handler({}, context)) as HandlerResult

    expect(result.seasonsBackfilled).toEqual([99])
    expect(invoke).toHaveBeenCalledWith('historical-backfill-modular', {
      guild_code: 'G1',
      force_seasons: [99]
    })
    expect(mutateCalls[0].method).toBe('POST')
    expect(lastCursorWrite()).toBe(100)
  })

  it('counts a top-level success:true with a nested failed season as a guild failure', async () => {
    buildDb({
      tracking: trackingRow(LAST_TRACKED_SEASON),
      guilds: [{ guild_code: 'G1' }],
      invoke: () => ({
        data: {
          success: true,
          stats: { totalInserted: 0 },
          results: [
            {
              season: ENDED_SEASON,
              success: false,
              error: 'nested forced season failed'
            }
          ]
        },
        error: null
      })
    })
    const handler = await loadHandler()
    const result = (await handler({}, context)) as HandlerResult

    expect(result.backfillResults[0].success).toBe(false)
    expect(result.backfillResults[0].failures).toEqual([
      `G1: season ${ENDED_SEASON}: nested forced season failed`
    ])
    expect(lastCursorWrite()).toBe(LAST_TRACKED_SEASON)
  })

  it('does not let an empty top-level error mask a nested season failure', async () => {
    buildDb({
      tracking: trackingRow(LAST_TRACKED_SEASON),
      guilds: [{ guild_code: 'G1' }],
      invoke: () => ({
        data: {
          success: true,
          error: '',
          stats: { totalInserted: 0 },
          results: [
            {
              season: ENDED_SEASON,
              success: false,
              error: 'nested failure survives empty top-level error'
            }
          ]
        },
        error: null
      })
    })
    const handler = await loadHandler()
    const result = (await handler({}, context)) as HandlerResult

    expect(result.backfillResults[0].success).toBe(false)
    expect(result.backfillResults[0].failures).toEqual([
      `G1: season ${ENDED_SEASON}: nested failure survives empty top-level error`
    ])
    expect(lastCursorWrite()).toBe(LAST_TRACKED_SEASON)
  })

  it('retries every pending season after a partial catch-up and advances only when all retry', async () => {
    seasonTiming = { current: 100, ended: [98, 99] }
    const calls: number[] = []
    buildDb({
      tracking: trackingRow(98),
      guilds: [{ guild_code: 'G1' }],
      invoke: (_code, season) => {
        calls.push(Number(season))
        if (
          season === 99 &&
          calls.filter((called) => called === 99).length === 1
        ) {
          return {
            data: {
              success: false,
              results: [{ season: 99, success: false, error: 'retry me' }]
            },
            error: null
          }
        }
        return {
          data: { success: true, stats: { totalInserted: 1 } },
          error: null
        }
      }
    })
    const handler = await loadHandler()

    const first = (await handler({}, context)) as HandlerResult
    expect(first.seasonsBackfilled).toEqual([98, 99])
    expect(first.backfillResults.map((result) => result.success)).toEqual([
      true,
      false
    ])
    expect(lastCursorWrite()).toBe(98)

    const second = (await handler({}, context)) as HandlerResult
    expect(second.seasonsBackfilled).toEqual([98, 99])
    expect(second.backfillResults.map((result) => result.success)).toEqual([
      true,
      true
    ])
    expect(calls).toEqual([98, 99, 98, 99])
    expect(lastCursorWrite()).toBe(100)
  })

  it('rejects when the cursor PATCH returns an error (no silent success)', async () => {
    buildDb({
      tracking: trackingRow(LAST_TRACKED_SEASON),
      guilds: [{ guild_code: 'G1' }],
      invoke: () => ({
        data: { success: true, stats: { totalInserted: 1 } },
        error: null
      }),
      mutateError: 'HTTP 500: cursor patch boom'
    })
    const handler = await loadHandler()

    await expect(handler({}, context)).rejects.toThrow(/cursor/)
    expect(mutateCalls).toHaveLength(1)
    expect(mutateCalls[0].method).toBe('PATCH')
  })

  it('rejects when the cursor POST returns an error (no silent success)', async () => {
    buildDb({
      tracking: [],
      guilds: [{ guild_code: 'G1' }],
      invoke: () => ({
        data: { success: true, stats: { totalInserted: 1 } },
        error: null
      }),
      mutateError: 'HTTP 500: cursor post boom'
    })
    const handler = await loadHandler()

    await expect(handler({}, context)).rejects.toThrow(/cursor/)
    expect(mutateCalls[0].method).toBe('POST')
  })
})
