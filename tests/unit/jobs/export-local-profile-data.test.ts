import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobHandler } from '@/app/lib/jobs/types'

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  direct: vi.fn(),
  db: vi.fn()
}))
vi.mock('@/app/lib/jobs/dispatcher', () => ({
  registerJobHandler: mocks.register
}))
vi.mock('@/app/lib/network/direct-supabase', () => ({
  createDirectClient: mocks.direct
}))
vi.mock('@/app/lib/db', () => ({ serviceDb: mocks.db }))
import { registerLocalProfileExportHandler } from '@/app/lib/jobs/export-local-profile-data'

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllEnvs())
function handler(): JobHandler {
  registerLocalProfileExportHandler()
  expect(mocks.register).toHaveBeenCalledWith(
    'export-local-profile-data',
    expect.any(Function)
  )
  return mocks.register.mock.calls[0][1]
}
const context = { jobId: 1, workerId: 'synthetic-worker', attempts: 1 }

describe('local export capability boundary', () => {
  it('refuses hosted execution before constructing either privileged client', async () => {
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'hosted')
    await expect(
      handler()({ subjectUserId: 'synthetic-forged' }, context)
    ).rejects.toThrow('Local export requires a desktop workspace')
    expect(mocks.direct).not.toHaveBeenCalled()
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it('refuses a cancelled desktop job before querying or updating data', async () => {
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
    const controller = new AbortController()
    controller.abort(new Error('Synthetic cancellation'))
    await expect(
      handler()({}, { ...context, signal: controller.signal })
    ).rejects.toThrow('Synthetic cancellation')
    expect(mocks.direct).not.toHaveBeenCalled()
    expect(mocks.db).not.toHaveBeenCalled()
  })
})
