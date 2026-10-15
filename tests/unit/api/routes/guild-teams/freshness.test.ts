import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  serviceDb: vi.fn(),
  summary: vi.fn(),
  desktop: false
}))
vi.mock('@/app/lib/auth', () => ({ requireRoleForApi: mocks.auth }))
vi.mock('@/app/lib/db', () => ({ serviceDb: mocks.serviceDb }))
vi.mock('@tacticus/app-core/runtime-profile', () => ({
  getRuntimeProfile: () => (mocks.desktop ? 'desktop' : 'hosted')
}))
vi.mock('@/app/lib/player/roster-snapshot-store', () => ({
  readRosterVerificationSummary: mocks.summary
}))
vi.mock('@/app/lib/middleware/errorHandler', () => ({
  withErrorHandler: (fn: unknown) => fn
}))
import { GET } from '@/app/api/guild-teams/freshness/route'
const request = () =>
  new NextRequest('http://localhost/api/guild-teams/freshness')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.desktop = false
  mocks.auth.mockResolvedValue({
    profile: { guild_code: 'SYNTHETIC', role: 'officer' }
  })
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    abortSignal: async () => ({ data: [{ id: 7 }, { id: 9 }], error: null })
  }
  mocks.serviceDb.mockReturnValue({ from: vi.fn(() => query) })
  mocks.summary.mockResolvedValue({
    total: 2,
    verified: 2,
    fresh: 1,
    oldestVerifiedAt: '2026-01-01T00:00:00.000Z'
  })
})
it('returns only verification coverage for the authorized own-guild cohort', async () => {
  const response = await GET(request())
  expect(await response.json()).toEqual({
    available: true,
    total: 2,
    verified: 2,
    fresh: 1,
    oldestVerifiedAt: '2026-01-01T00:00:00.000Z'
  })
  const db = mocks.serviceDb.mock.results[0].value
  expect(db.from).toHaveBeenCalledWith('player_mapping')
  const query = db.from.mock.results[0].value
  expect(query.eq.mock.calls).toEqual([
    ['guild_code', 'SYNTHETIC'],
    ['is_current', true]
  ])
  expect(mocks.summary).toHaveBeenCalledWith([7, 9], 21600000, db)
})
it('requires officer authorization before creating privileged database access', async () => {
  mocks.auth.mockRejectedValue(new Error('denied'))
  await expect(GET(request())).rejects.toThrow('denied')
  expect(mocks.serviceDb).not.toHaveBeenCalled()
})
it('keeps desktop on its local imported roster without hosted metadata access', async () => {
  mocks.desktop = true
  expect(await (await GET(request())).json()).toEqual({ available: false })
  expect(mocks.serviceDb).not.toHaveBeenCalled()
})
