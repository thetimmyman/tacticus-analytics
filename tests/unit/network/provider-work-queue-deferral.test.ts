import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ database: vi.fn(), rpc: vi.fn() }))
vi.mock('@/app/lib/db', () => ({ serviceDb: mocks.database }))
vi.mock('@/app/lib/sync/worker-utils', () => ({ callRpc: mocks.rpc }))
import { ProviderAdmissionError } from '@/supabase/functions/_shared/provider-admission'
import { registerJobHandler } from '@/app/lib/jobs/dispatcher'
import { runWorkerTick } from '@/app/lib/jobs/worker-tick'

afterEach(() => vi.useRealTimers())

it.each([true, false])(
  'defers only a still-owned work claim, ownership present=%s',
  async (owned) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const kind = `synthetic-admission-${owned}`
    registerJobHandler(kind, async () => {
      throw new ProviderAdmissionError(1e100)
    })
    const update = vi.fn(() => chain)
    const eq = vi.fn(() => chain)
    const chain = {
      update,
      eq,
      select: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({
        data: owned ? { id: 1 } : null,
        error: null
      }))
    }
    const from = vi.fn(() => chain)
    mocks.database.mockReturnValue({ from })
    let claimed = false
    mocks.rpc
      .mockReset()
      .mockImplementation(async (_db: unknown, operation: string) => {
        if (operation !== 'claim_next_work_job')
          return { data: true, error: null }
        if (claimed) return { data: null, error: null }
        claimed = true
        return {
          data: {
            id: 1,
            job_type: kind,
            payload: { synthetic: true },
            attempts: 3
          },
          error: null
        }
      })
    const pending = runWorkerTick({ classes: ['batch'], deadlineMs: 240000 })
    await vi.runAllTimersAsync()
    const result = await pending
    expect(
      mocks.rpc.mock.calls.every(
        ([, operation]) => operation === 'claim_next_work_job'
      )
    ).toBe(true)
    expect(from).toHaveBeenCalledWith('work_queue')
    expect(eq).toHaveBeenCalledWith('id', 1)
    expect(eq).toHaveBeenCalledWith('status', 'processing')
    expect(eq).toHaveBeenCalledWith('claimed_by', result.workerId)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        attempts: 2,
        claimed_by: null,
        scheduled_for: '2026-01-01T00:05:00.000Z',
        payload: {
          synthetic: true,
          provider_admission: expect.objectContaining({
            retry_after_seconds: 1e100
          })
        }
      })
    )
    expect(result.jobsFailed).toBe(owned ? 0 : 1)
    expect(result.jobsDeferred ?? 0).toBe(owned ? 1 : 0)
    expect(result.details[0].status).toBe(owned ? 'deferred' : 'failed')
  }
)
