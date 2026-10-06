import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  tick: vi.fn(),
  register: vi.fn(),
  registerAchievements: vi.fn(),
  registerExports: vi.fn(),
  handler: vi.fn()
}))
vi.mock('@/app/lib/jobs/worker-tick', () => ({ runWorkerTick: mocks.tick }))
vi.mock('@/app/lib/jobs/dispatcher', () => ({ getJobHandler: mocks.handler }))
vi.mock('@/app/lib/jobs/refresh-explore-snapshots', () => ({
  registerRefreshExploreSnapshotsHandler: mocks.register
}))
vi.mock('@/app/lib/jobs/refresh-local-achievements', () => ({
  registerLocalAchievementsHandler: mocks.registerAchievements
}))
vi.mock('@/app/lib/jobs/export-local-profile-data', () => ({
  registerLocalProfileExportHandler: mocks.registerExports
}))
import { POST } from '@/app/api/desktop/jobs/route'
let secret: string
beforeEach(() => {
  vi.clearAllMocks()
  secret = randomBytes(32).toString('hex')
  vi.stubEnv('CRON_SECRET', secret)
  vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
  mocks.handler.mockReturnValue(undefined)
  mocks.tick.mockResolvedValue({
    jobsProcessed: 1,
    jobsSucceeded: 1,
    jobsFailed: 0,
    workerId: 'synthetic-worker',
    details: []
  })
})
afterEach(() => vi.unstubAllEnvs())
const request = (authorization?: string) =>
  new NextRequest('http://127.0.0.1:1234/api/desktop/jobs', {
    method: 'POST',
    headers: authorization ? { authorization } : {}
  })
describe('desktop worker boundary', () => {
  it('stays inactive in the hosted profile', async () => {
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'hosted')
    expect((await POST(request(`Bearer ${secret}`))).status).toBe(404)
    expect(mocks.register).not.toHaveBeenCalled()
    expect(mocks.registerAchievements).not.toHaveBeenCalled()
    expect(mocks.registerExports).not.toHaveBeenCalled()
    expect(mocks.tick).not.toHaveBeenCalled()
  })
  it.each([undefined, 'Bearer invalid', 'Bearer é'])(
    'rejects an unauthorized scheduler before registering or claiming work',
    async (header) => {
      expect((await POST(request(header))).status).toBe(401)
      expect(mocks.register).not.toHaveBeenCalled()
      expect(mocks.registerAchievements).not.toHaveBeenCalled()
      expect(mocks.registerExports).not.toHaveBeenCalled()
      expect(mocks.tick).not.toHaveBeenCalled()
    }
  )
  it('passes cancellation to the canonical worker and returns only aggregate status', async () => {
    const req = request(`Bearer ${secret}`)
    const response = await POST(req)
    expect(response.status).toBe(200)
    expect(mocks.registerAchievements).toHaveBeenCalledOnce()
    expect(mocks.registerExports).toHaveBeenCalledOnce()
    expect(mocks.tick).toHaveBeenCalledWith({
      classes: ['hook'],
      deadlineMs: 15000,
      signal: req.signal,
      reapStuckJobs: true
    })
    expect(await response.json()).toEqual({
      status: 'completed',
      jobsProcessed: 1,
      jobsSucceeded: 1,
      jobsFailed: 0
    })
  })
  it('reports failed work without exposing stored error or worker identity', async () => {
    mocks.tick.mockResolvedValue({
      jobsProcessed: 1,
      jobsSucceeded: 0,
      jobsFailed: 1,
      error: 'synthetic private detail',
      workerId: 'synthetic-worker'
    })
    const response = await POST(request(`Bearer ${secret}`))
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error.metadata).toEqual({
      status: 'failed',
      jobsProcessed: 1,
      jobsSucceeded: 0,
      jobsFailed: 1
    })
    expect(JSON.stringify(body)).not.toContain('synthetic private detail')
    expect(JSON.stringify(body)).not.toContain('synthetic-worker')
  })
})
