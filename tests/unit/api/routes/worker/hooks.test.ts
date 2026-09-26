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

describe('/api/worker/hooks', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let GET: (request: NextRequest) => Promise<Response>
  let runWorkerTick: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    runWorkerTick = vi.fn().mockResolvedValue(workerResult)

    vi.doMock('@/app/lib/scheduler/require-cron-secret', () => ({
      requireCronSecret: vi.fn()
    }))
    vi.doMock('@/app/lib/middleware/errorHandler', () => ({
      withErrorHandler: <Handler>(handler: Handler) => handler
    }))
    vi.doMock('@/app/lib/logging', () => ({
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

  it('runs the hook worker queue', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/worker/hooks', { method: 'POST' })
    )

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
    const tick = (succeeded: number, failed: number) => ({
      workerId: 'w',
      jobsProcessed: succeeded + failed,
      jobsSucceeded: succeeded,
      jobsFailed: failed,
      durationMs: 1
    })
    const post = () =>
      POST(
        new NextRequest('http://localhost/api/worker/hooks', { method: 'POST' })
      )

    runWorkerTick.mockResolvedValueOnce(tick(0, 3))
    expect((await post()).status).toBe(500)

    runWorkerTick.mockResolvedValueOnce(tick(1, 2))
    expect((await post()).status).toBe(200)

    runWorkerTick.mockResolvedValueOnce(tick(0, 0))
    expect((await post()).status).toBe(200)
  })
})
