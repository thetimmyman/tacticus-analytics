import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const workerResult = {
  workerId: 'worker-1',
  classes: ['hook'],
  jobsProcessed: 0,
  jobsSucceeded: 0,
  jobsFailed: 0,
  durationMs: 1,
  details: []
}

type TickDetail = { job_type: string; status: 'completed' | 'failed' }

const tickOf = (
  details: TickDetail[],
  extra: Record<string, unknown> = {}
) => ({
  workerId: 'w',
  classes: ['hook'],
  jobsProcessed: details.length,
  jobsSucceeded: details.filter((d) => d.status === 'completed').length,
  jobsFailed: details.filter((d) => d.status === 'failed').length,
  durationMs: 1,
  details: details.map((d, i) => ({ id: i + 1, ...d })),
  ...extra
})

const failed = (job_type: string): TickDetail => ({
  job_type,
  status: 'failed'
})
const completed = (job_type: string): TickDetail => ({
  job_type,
  status: 'completed'
})

describe('/api/worker/hooks', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let GET: (request: NextRequest) => Promise<Response>
  let runWorkerTick: ReturnType<typeof vi.fn>
  let middlewareCapture: ReturnType<typeof vi.fn>
  let routeCapture: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    runWorkerTick = vi.fn().mockResolvedValue(workerResult)
    middlewareCapture = vi.fn()
    routeCapture = vi.fn()

    vi.doMock('@/app/lib/scheduler/require-cron-secret', () => ({
      requireCronSecret: vi.fn()
    }))
    // The real withErrorHandler: its generic 5xx capture is what is under test.
    vi.doMock('@sentry/nextjs', () => ({
      captureException: middlewareCapture,
      setTag: vi.fn()
    }))
    vi.doMock('@/app/lib/monitoring/sentry', () => ({
      captureSentryException: routeCapture
    }))
    vi.doMock('@/app/lib/logging', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/app/lib/logging')>()),
      createComponentLogger: () => ({ info: vi.fn(), error: vi.fn() })
    }))
    vi.doMock('@/app/lib/jobs/worker-tick', () => ({ runWorkerTick }))
    vi.doMock('@/app/lib/jobs/dispatcher', () => ({
      listRegisteredJobTypes: () => ['existing-handler']
    }))
    vi.doMock('@/app/lib/jobs/register-hooks-handlers', () => ({}))

    const route = await import('@/app/api/worker/hooks/route')
    POST = route.POST
    GET = route.GET
  })

  const post = () =>
    POST(
      new NextRequest('http://localhost/api/worker/hooks', { method: 'POST' })
    )

  it('runs the hook worker queue', async () => {
    const response = await post()

    expect(response.status).toBe(200)
    expect(runWorkerTick).toHaveBeenCalledWith({
      classes: ['webhook', 'alert', 'notification', 'hook'],
      deadlineMs: 50_000
    })
    await expect(response.json()).resolves.toEqual(workerResult)
  })

  it('reports registered hook handlers', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/worker/hooks')
    )

    await expect(response.json()).resolves.toEqual({
      classes: ['webhook', 'alert', 'notification', 'hook'],
      registeredJobTypes: ['existing-handler'],
      verifyScheduler: {
        running: false,
        startedAt: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        timedOutAt: null,
        drainingAfterTimeout: false,
        lastError: null
      }
    })
  })

  it('isolates durable security repairs from the legacy hook classes', async () => {
    await POST(
      new NextRequest('http://localhost/api/worker/hooks?class=verify', {
        method: 'POST'
      })
    )

    expect(runWorkerTick).toHaveBeenCalledWith({
      classes: ['verify'],
      deadlineMs: 50_000
    })
  })

  it('returns 500 when every claimed job failed, 200 on partial success', async () => {
    runWorkerTick.mockResolvedValueOnce(
      tickOf([failed('job-a'), failed('job-a'), failed('job-b')])
    )
    expect((await post()).status).toBe(500)

    runWorkerTick.mockResolvedValueOnce(
      tickOf([completed('job-a'), failed('job-a'), failed('job-b')])
    )
    expect((await post()).status).toBe(200)

    runWorkerTick.mockResolvedValueOnce(tickOf([]))
    expect((await post()).status).toBe(200)
  })

  describe('Sentry capture for an all-failed tick', () => {
    it('captures once under its own error code instead of the generic 500 bucket', async () => {
      runWorkerTick.mockResolvedValueOnce(
        tickOf([failed('test-hook-a'), failed('test-hook-a')])
      )

      const response = await post()

      expect(response.status).toBe(500)
      expect(middlewareCapture).not.toHaveBeenCalled()
      expect(routeCapture).toHaveBeenCalledOnce()
      const [error, context] = routeCapture.mock.calls[0]
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).name).toBe('WorkerTickAllFailedError')
      expect(context).toEqual({
        tags: {
          operation: 'POST:api.worker.hooks',
          status_code: '500',
          error_code: 'WORKER_TICK_ALL_FAILED',
          job_type: 'test-hook-a'
        }
      })
    })

    it('tags a tick whose failures span several job types as mixed', async () => {
      runWorkerTick.mockResolvedValueOnce(
        tickOf([failed('test-hook-a'), failed('test-hook-b')])
      )

      await post()

      expect(routeCapture).toHaveBeenCalledOnce()
      expect(routeCapture.mock.calls[0][1].tags.job_type).toBe('mixed')
    })

    it('keeps the tick counters in the 500 body beside a standard error envelope', async () => {
      runWorkerTick.mockResolvedValueOnce(
        tickOf([failed('test-hook-a')], { error: 'claim failed' })
      )

      const body = await (await post()).json()

      expect(body).toMatchObject({
        workerId: 'w',
        jobsProcessed: 1,
        jobsSucceeded: 0,
        jobsFailed: 1,
        details: [{ id: 1, job_type: 'test-hook-a', status: 'failed' }],
        error: {
          code: 'WORKER_TICK_ALL_FAILED',
          message: expect.any(String),
          retryable: true,
          claimError: 'claim failed'
        }
      })
    })

    it('does not capture a partially successful or idle tick', async () => {
      runWorkerTick.mockResolvedValueOnce(
        tickOf([completed('test-hook-a'), failed('test-hook-a')])
      )
      await post()
      runWorkerTick.mockResolvedValueOnce(tickOf([]))
      await post()

      expect(routeCapture).not.toHaveBeenCalled()
      expect(middlewareCapture).not.toHaveBeenCalled()
    })

    it('leaves an unexpected tick crash to the generic 500 capture', async () => {
      runWorkerTick.mockRejectedValueOnce(new Error('tick crashed'))

      const response = await post()

      expect(response.status).toBe(500)
      expect(routeCapture).not.toHaveBeenCalled()
      expect(middlewareCapture).toHaveBeenCalledOnce()
      expect(middlewareCapture.mock.calls[0][1]).toEqual({
        tags: { operation: 'POST:api.worker.hooks', status_code: '500' }
      })
    })
  })
})
