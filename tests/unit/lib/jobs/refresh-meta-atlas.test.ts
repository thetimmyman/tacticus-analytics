import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobHandler, JobHandlerContext } from '@/app/lib/jobs/types'

type RpcResponse = {
  data: unknown
  error: string | null
}

type RpcCall = {
  functionName: string
  args?: Record<string, unknown>
}

type SeasonResult = {
  season: string
  rows_inserted: number
  duration_ms: number
  error?: string
}

type RefreshResult = {
  status: string
  latestSeason: string
  seasonsProcessed: number
  successful: number
  failed: number
  totalRowsInserted: number
  durationMs: number
  skippedSeasons: string[]
  results: SeasonResult[]
}

type HandlerFactory = (now: () => Date) => JobHandler

const context: JobHandlerContext = {
  jobId: 279,
  workerId: 'vitest',
  attempts: 1
}

let registeredHandler: JobHandler | undefined
let latestResponse: RpcResponse
let refreshBehaviours: Array<() => Promise<RpcResponse>>
let rpcCalls: RpcCall[]
let rethrowIfAppErrorMock: ReturnType<typeof vi.fn>
let captureSentryExceptionMock: ReturnType<typeof vi.fn>

function mockDependencies(): void {
  registeredHandler = undefined
  latestResponse = { data: '110', error: null }
  refreshBehaviours = [
    async () => ({ data: [{ rows_affected: 9 }], error: null }),
    async () => ({ data: [{ rows_affected: 0 }], error: null }),
    async () => ({ data: [{ rows_affected: 0 }], error: null })
  ]
  rpcCalls = []

  const rpc = async (
    functionName: string,
    args?: Record<string, unknown>
  ): Promise<RpcResponse> => {
    rpcCalls.push({ functionName, args })

    if (functionName === 'get_latest_season') {
      return latestResponse
    }

    if (functionName === 'refresh_meta_atlas_season') {
      const behaviour = refreshBehaviours.shift()
      if (!behaviour) {
        throw new Error(`Unexpected extra RPC: ${functionName}`)
      }
      return behaviour()
    }

    throw new Error(`Unexpected RPC: ${functionName}`)
  }

  rethrowIfAppErrorMock = vi.fn()
  captureSentryExceptionMock = vi.fn()

  vi.doMock('@/app/lib/logging', () => ({
    createComponentLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }))
  vi.doMock('@/app/lib/errors/AppError', () => ({
    rethrowIfAppError: rethrowIfAppErrorMock
  }))
  vi.doMock('@/app/lib/monitoring/sentry', () => ({
    captureSentryException: captureSentryExceptionMock
  }))
  vi.doMock('@/app/lib/jobs/dispatcher', () => ({
    registerJobHandler: vi.fn((_jobType: string, handler: JobHandler): void => {
      registeredHandler = handler
    })
  }))
  vi.doMock('@/app/lib/network/direct-supabase', () => ({
    createDirectClient: () => ({ rpc })
  }))
}

async function loadHandlerAt(isoTimestamp: string): Promise<JobHandler> {
  const instant = new Date(isoTimestamp)
  vi.setSystemTime(instant)

  const module =
    (await import('@/app/lib/jobs/refresh-meta-atlas')) as unknown as {
      registerRefreshMetaAtlasHandler: () => void
      __internal?: { createRefreshMetaAtlasHandler?: HandlerFactory }
    }
  const factory = module.__internal?.createRefreshMetaAtlasHandler
  if (factory) {
    return factory(() => new Date(instant))
  }

  module.registerRefreshMetaAtlasHandler()
  if (!registeredHandler) {
    throw new Error('refresh-meta-atlas did not register its handler')
  }
  return registeredHandler
}

function refreshedSeasons(): string[] {
  return rpcCalls
    .filter(({ functionName }) => functionName === 'refresh_meta_atlas_season')
    .map(({ args }) => String(args?.p_season))
}

async function runHandler(isoTimestamp: string): Promise<RefreshResult> {
  const handler = await loadHandlerAt(isoTimestamp)
  return (await handler({}, context)) as RefreshResult
}

describe('refresh-meta-atlas handler cadence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    mockDependencies()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('refreshes the latest two historical seasons on the first UTC-hour run', async () => {
    const result = await runHandler('2026-09-25T12:05:00.000Z')

    expect(refreshedSeasons()).toEqual(['110', '109', '108'])
    expect(result).toMatchObject({
      latestSeason: '110',
      seasonsProcessed: 3,
      successful: 3,
      failed: 0
    })
    expect(result.results.map(({ season }) => season)).toEqual([
      '110',
      '109',
      '108'
    ])
  })

  it('refreshes only the latest season on later UTC-hour runs', async () => {
    const result = await runHandler('2026-09-25T12:20:00.000Z')

    expect(refreshedSeasons()).toEqual(['110'])
    expect(result).toMatchObject({
      latestSeason: '110',
      seasonsProcessed: 1,
      successful: 1,
      failed: 0,
      skippedSeasons: ['109', '108']
    })
    expect(result.results.map(({ season }) => season)).toEqual(['110'])
  })

  it('keeps top-level lookup error handling unchanged', async () => {
    latestResponse = { data: null, error: 'database unavailable' }
    const handler = await loadHandlerAt('2026-09-25T12:20:00.000Z')

    await expect(handler({}, context)).rejects.toThrow(
      'Failed to get latest season: database unavailable'
    )
    expect(refreshedSeasons()).toEqual([])
    expect(rethrowIfAppErrorMock).toHaveBeenCalledTimes(1)
    expect(captureSentryExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { handler: 'refresh-meta-atlas', jobId: String(context.jobId) }
    })
  })

  it('keeps per-season error isolation unchanged', async () => {
    refreshBehaviours = [
      async () => ({ data: [{ rows_affected: 12 }], error: null }),
      async () => ({ data: null, error: 'season refresh failed' }),
      async () => {
        throw new Error('season request timed out')
      }
    ]

    const result = await runHandler('2026-09-25T12:05:00.000Z')

    expect(result).toMatchObject({
      status: 'partial',
      seasonsProcessed: 3,
      successful: 1,
      failed: 2,
      totalRowsInserted: 12
    })
    expect(result.results).toMatchObject([
      { season: '110', rows_inserted: 12 },
      { season: '109', error: 'season refresh failed' },
      { season: '108', error: 'season request timed out' }
    ])
    expect(captureSentryExceptionMock).not.toHaveBeenCalled()
  })
})
