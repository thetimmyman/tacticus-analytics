import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

describe('/api/worker/batch', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let runWorkerTick: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    runWorkerTick = vi.fn().mockResolvedValue({
      workerId: 'batch-worker',
      jobsProcessed: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      durationMs: 1
    })

    vi.doMock('@/app/lib/scheduler/require-cron-secret', () => ({
      requireCronSecret: vi.fn()
    }))
    vi.doMock('@/app/lib/middleware/errorHandler', () => ({
      withErrorHandler: <Handler>(handler: Handler) => handler
    }))
    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: () => ({ info: vi.fn() })
    }))
    vi.doMock('@/app/lib/jobs/worker-tick', () => ({ runWorkerTick }))
    vi.doMock('@/app/lib/jobs/dispatcher', () => ({
      listRegisteredJobTypes: () => []
    }))
    vi.doMock('@/app/lib/jobs/register-batch-handlers', () => ({}))

    POST = (await import('@/app/api/worker/batch/route')).POST
  })

  it('runs the batch worker queue', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/worker/batch', { method: 'POST' })
    )

    expect(response.status).toBe(200)
    expect(runWorkerTick).toHaveBeenCalledOnce()
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
        new NextRequest('http://localhost/api/worker/batch', { method: 'POST' })
      )

    runWorkerTick.mockResolvedValueOnce(tick(0, 3))
    expect((await post()).status).toBe(500)

    runWorkerTick.mockResolvedValueOnce(tick(1, 2))
    expect((await post()).status).toBe(200)

    runWorkerTick.mockResolvedValueOnce(tick(0, 0))
    expect((await post()).status).toBe(200)
  })
})
