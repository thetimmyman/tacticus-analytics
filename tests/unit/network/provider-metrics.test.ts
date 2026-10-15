import { afterEach, expect, it, vi } from 'vitest'
import {
  captureProviderMetrics,
  providerFetch
} from '@/app/lib/network/provider-metrics'
import type {
  ServiceSupabaseClient,
  WorkerResult
} from '@/app/lib/sync/worker-types'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('passes physical measurements to the existing job-completion database contract', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 }))
  )
  const rpc = vi.fn(async () => ({ data: true, error: null }))
  const database = { rpc } as unknown as ServiceSupabaseClient
  const job = {
    id: '00000000-0000-4000-8000-000000000001',
    guild_code: 'synthetic',
    job_type: 'player_sync' as const
  }
  const result: WorkerResult = {
    jobId: job.id,
    success: false,
    recordsProcessed: 2,
    playersUpdated: 1,
    errors: [],
    upsertFailures: 0,
    duration: 0
  }
  const { completeSyncJob } = await import('@/app/lib/sync/sync-job-lifecycle')
  await captureProviderMetrics(async () => {
    await providerFetch('https://api.tacticusgame.com/api/v1/player')
    await completeSyncJob(job, database, 'synthetic-worker', result)
  })
  expect(rpc).toHaveBeenCalledWith(
    'complete_job',
    expect.objectContaining({
      p_metrics: {
        records_processed: 2,
        players_updated: 1,
        api_calls: 1,
        api_errors: 1,
        api_retry_count: 0
      }
    })
  )
})

it('retains physical measurements when the job fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 }))
  )
  const rpc = vi.fn(async () => ({ data: true, error: null }))
  const database = { rpc } as unknown as ServiceSupabaseClient
  const job = {
    id: '00000000-0000-4000-8000-000000000002',
    guild_code: 'synthetic',
    job_type: 'player_sync' as const
  }
  const result: WorkerResult = {
    jobId: job.id,
    success: false,
    recordsProcessed: 0,
    playersUpdated: 0,
    errors: [],
    upsertFailures: 0,
    duration: 0
  }
  const { failSyncJob } = await import('@/app/lib/sync/sync-job-lifecycle')
  await captureProviderMetrics(async () => {
    await providerFetch('https://api.tacticusgame.com/api/v1/player', {}, true)
    await failSyncJob(
      new Error('synthetic job failure'),
      job,
      database,
      'synthetic-worker',
      result
    )
  })
  expect(rpc).toHaveBeenCalledWith(
    'fail_job',
    expect.objectContaining({
      p_progress: expect.objectContaining({
        api_calls: 1,
        api_errors: 1,
        api_retry_count: 1
      })
    })
  )
})

it('does not report completion when the database refuses the worker claim', async () => {
  const rpc = vi.fn(async () => ({ data: false, error: null }))
  const database = { rpc } as unknown as ServiceSupabaseClient
  const job = {
    id: '00000000-0000-4000-8000-000000000003',
    guild_code: 'synthetic',
    job_type: 'player_sync' as const
  }
  const result: WorkerResult = {
    jobId: job.id,
    success: false,
    recordsProcessed: 0,
    playersUpdated: 0,
    errors: [],
    upsertFailures: 0,
    duration: 0
  }
  const { completeSyncJob } = await import('@/app/lib/sync/sync-job-lifecycle')
  await expect(
    completeSyncJob(job, database, 'synthetic-worker', result)
  ).rejects.toThrow('claim')
  expect(result.success).toBe(false)
})

it('updates the same physical attempt when response decoding fails', async () => {
  const wire = vi.fn(
    async () => new Response('synthetic invalid JSON', { status: 200 })
  )
  vi.stubGlobal('fetch', wire)
  const observed = await captureProviderMetrics(async () => {
    const response = await providerFetch(
      'https://api.tacticusgame.com/api/v1/player'
    )
    await expect(response.json()).rejects.toThrow()
    return 'decode failed'
  })
  expect(observed).toEqual({
    result: 'decode failed',
    metrics: { api_calls: 1, api_errors: 1, api_retry_count: 0 }
  })
  expect(wire).toHaveBeenCalledTimes(1)
})

it('refuses automatic redirects that would create unobserved provider requests', async () => {
  const wire = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', wire)
  await captureProviderMetrics(() =>
    providerFetch('https://api.tacticusgame.com/api/v1/player', {
      redirect: 'follow'
    })
  )
  expect(wire).toHaveBeenCalledWith(
    'https://api.tacticusgame.com/api/v1/player',
    expect.objectContaining({ redirect: 'error' })
  )
})

it('observes the shared raid transport used by sync jobs', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ entries: [] }))
  )
  const { fetchGuildRaidData } = await import('@/app/lib/sync/tacticus-api')
  const measured = await captureProviderMetrics(async () => {
    const response = await fetchGuildRaidData(
      'synthetic-credential',
      'synthetic'
    )
    return response.json()
  })
  expect(measured).toEqual({
    result: { entries: [] },
    metrics: { api_calls: 1, api_errors: 0, api_retry_count: 0 }
  })
})

it('keeps concurrent job measurements separate', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      await Promise.resolve()
      return new Response(null, {
        status: String(input).endsWith('/player') ? 503 : 200
      })
    })
  )
  const results = await Promise.all([
    captureProviderMetrics(
      async () =>
        (await providerFetch('https://api.tacticusgame.com/api/v1/player'))
          .status
    ),
    captureProviderMetrics(
      async () =>
        (await providerFetch('https://api.tacticusgame.com/api/v1/guild'))
          .status
    )
  ])
  expect(results).toEqual([
    {
      result: 503,
      metrics: { api_calls: 1, api_errors: 1, api_retry_count: 0 }
    },
    {
      result: 200,
      metrics: { api_calls: 1, api_errors: 0, api_retry_count: 0 }
    }
  ])
})

it('preserves caller cancellation through the shared sync helper', async () => {
  const wire = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', wire)
  const controller = new AbortController()
  controller.abort()
  const { fetchWithAbortTimeout } = await import('@/app/lib/sync/api-client')
  await expect(
    fetchWithAbortTimeout(
      'https://api.tacticusgame.com/api/v1/player',
      { signal: controller.signal },
      1000,
      'synthetic'
    )
  ).rejects.toThrow()
  expect(wire).not.toHaveBeenCalled()
})

it('counts provider fetches and failures while excluding internal calls and pre-dispatch cancellation', async () => {
  const wire = vi.fn(async () => new Response(null, { status: 503 }))
  vi.stubGlobal('fetch', wire)
  const observed = await captureProviderMetrics(async () => {
    await providerFetch('https://api.tacticusgame.com/api/v1/player')
    await providerFetch('https://api.tacticusgame.com/api/v1/player', {}, true)
    await providerFetch('https://synthetic.invalid/internal')
    const controller = new AbortController()
    controller.abort()
    await expect(
      providerFetch('https://api.tacticusgame.com/api/v1/player', {
        signal: controller.signal
      })
    ).rejects.toThrow()
    return 'finished'
  })
  expect(observed).toEqual({
    result: 'finished',
    metrics: { api_calls: 2, api_errors: 2, api_retry_count: 1 }
  })
  expect(wire).toHaveBeenCalledTimes(3)
})

it('measures worker retries at the wire boundary and releases rejected responses before retrying', async () => {
  vi.useFakeTimers()
  let cancelled = false
  let cancelledBeforeRetry = false
  const wire = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          cancel: () => {
            cancelled = true
          }
        }),
        { status: 503 }
      )
    )
    .mockImplementationOnce(async () => {
      cancelledBeforeRetry = cancelled
      return Response.json({ guild: { name: 'Synthetic guild' } })
    })
  vi.stubGlobal('fetch', wire)
  const { fetchTacticusApi } =
    await import('@/app/lib/sync/tacticus-api-client')
  const pending = captureProviderMetrics(async () => {
    const response = await fetchTacticusApi(
      '/guild',
      'synthetic-credential',
      'synthetic-scope'
    )
    return response.json()
  })
  await vi.advanceTimersByTimeAsync(10_000)
  expect(cancelledBeforeRetry).toBe(true)
  expect(await pending).toEqual({
    result: { guild: { name: 'Synthetic guild' } },
    metrics: { api_calls: 2, api_errors: 1, api_retry_count: 1 }
  })
  expect(wire).toHaveBeenCalledTimes(2)
})

it('measures documented guild retries while reused roster evidence makes no request', async () => {
  vi.useFakeTimers()
  const payload = {
    guild: {
      guildId: 'synthetic-target',
      members: [{ userId: 'synthetic-a' }]
    }
  }
  const cancel = vi.fn()
  const wire = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel }), { status: 503 })
    )
    .mockResolvedValueOnce(Response.json(payload))
  vi.stubGlobal('fetch', wire)
  const { fetchGuildMembersViaTacticus } =
    await import('@/app/lib/sync/tacticus-api')
  const pending = captureProviderMetrics(async () => {
    const fetched = await fetchGuildMembersViaTacticus(
      'synthetic-key',
      'synthetic-target',
      'SYNTHETIC'
    )
    const reused = await fetchGuildMembersViaTacticus(
      'synthetic-key',
      'synthetic-target',
      'SYNTHETIC',
      payload
    )
    return { fetched, reused }
  })
  await vi.advanceTimersByTimeAsync(10_000)
  const expected = { success: true, memberIds: ['synthetic-a'] }
  expect(await pending).toEqual({
    result: { fetched: expected, reused: expected },
    metrics: { api_calls: 2, api_errors: 1, api_retry_count: 1 }
  })
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(wire).toHaveBeenCalledTimes(2)
  expect(wire.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(
    ['/api/v1/guild', '/api/v1/guild']
  )
})
