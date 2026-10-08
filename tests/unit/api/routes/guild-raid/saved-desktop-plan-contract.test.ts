import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSeasonConfigForSeasonNumber } from '@/app/lib/loki/season-configs'
import { resolveSavedSeasonWindow } from '@/app/lib/boss-assignments/season-planner/saved-season'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  context: vi.fn(),
  readContext: vi.fn(),
  from: vi.fn(),
  desktop: true
}))
vi.mock('@tacticus/app-core/runtime-profile', () => ({
  getRuntimeProfile: () => (m.desktop ? 'desktop' : 'hosted')
}))
vi.mock('@/app/api/guild-raid/season-plan/_shared', async () => ({
  ...(await vi.importActual('@/app/api/guild-raid/season-plan/_shared')),
  requireSeasonPlanOfficerContext: m.context,
  requireSeasonPlanReadContext: m.readContext
}))
import { POST } from '@/app/api/guild-raid/season-plan/save/route'
import * as saved from '@/app/api/guild-raid/season-plan/route'
const season = String(
  Array.from({ length: 10000 }, (_, i) => i + 1).find((value) =>
    getSeasonConfigForSeasonNumber(value)
  )!
)
const config = getSeasonConfigForSeasonNumber(Number(season))!.id
const window = resolveSavedSeasonWindow(season)
const start = new Date(window.seasonStartMs).toISOString(),
  end = new Date(window.seasonEndMs).toISOString(),
  at = new Date(window.seasonStartMs + 86400000).toISOString()
const id = '11111111-1111-4111-8111-111111111111'
const user = '22222222-2222-4222-8222-222222222222'
const encounter = {
  encounterId: 0,
  stageCode: 'L1',
  loopIndex: 0,
  bossName: 'Boss',
  maxHp: 100,
  remainingHp: 80
}
const plan = () => ({
  season: season,
  season_id: config,
  season_start_at: start,
  season_end_at: end,
  snapshot_at: at,
  time_zone: 'UTC',
  lookback_days: 30,
  sessions_per_day: 1,
  snapshot: {
    guildCode: 'TEST',
    season: season,
    seasonId: config,
    snapshotAt: at
  },
  plan: {
    sessions: [],
    finalRaidState: {
      stageCode: 'L1',
      loopIndex: 0,
      encounters: {
        0: encounter,
        1: { ...encounter, encounterId: 1 },
        2: { ...encounter, encounterId: 2 }
      }
    },
    metrics: {
      tokensSpent: 0,
      overkillDamage: 0,
      bossesDefeated: 0,
      loopAdvances: 0,
      wastedTokens: 0,
      wastedTicks: 0
    },
    warnings: []
  }
})
const body = () => ({
  season_id: config,
  start_at: start,
  end_at: end,
  snapshot_at: at,
  plan: plan()
})
const request = (value: unknown) =>
  new NextRequest('http://localhost/api/guild-raid/season-plan/save', {
    method: 'POST',
    body: JSON.stringify(value),
    headers: { 'content-type': 'application/json' }
  })
let q: Record<string, ReturnType<typeof vi.fn>>
beforeEach(() => {
  vi.clearAllMocks()
  m.desktop = true
  q = Object.fromEntries(
    ['select', 'eq', 'order', 'limit', 'insert', 'update', 'delete'].map(
      (k) => [k, vi.fn().mockReturnThis()]
    )
  )
  q.single = vi.fn().mockResolvedValue({ data: { id }, error: null })
  q.maybeSingle = vi.fn().mockResolvedValue({
    data: { id, season_id: config, plan: { season: season } },
    error: null
  })
  q.then = vi.fn((resolve) =>
    Promise.resolve({ data: [], error: null }).then(resolve)
  )
  m.from.mockReturnValue(q)
  const context = {
    supabase: {
      from: m.from,
      rpc: vi.fn().mockResolvedValue({ data: [season], error: null })
    },
    user: { id: user },
    profile: { guild_code: 'TEST', role: 'officer' }
  }
  m.context.mockResolvedValue(context)
  m.readContext.mockResolvedValue(context)
})
describe('saved desktop plan public contract', () => {
  it.each([
    null,
    [],
    'bad',
    { ...body(), guild_code: 'OTHER' },
    { ...body(), created_by: id },
    { ...body(), kind: 'invented' },
    { ...body(), start_at: 'no-date' },
    { ...body(), end_at: body().start_at },
    { ...body(), plan: { arbitrary: true } },
    { ...body(), baseline_plan_id: 'not-uuid' },
    {
      ...body(),
      plan: { ...plan(), snapshot: { ...plan().snapshot, guildCode: 'OTHER' } }
    },
    { ...body(), plan: { ...plan(), season_id: 'different' } }
  ])(
    'refuses malformed or foreign identity before a write: %j',
    async (value) => {
      const res = await POST(request(value))
      expect(res.status).toBe(400)
      expect(q.insert).not.toHaveBeenCalled()
      expect(q.update).not.toHaveBeenCalled()
    }
  )
  it('stamps caller and preserves generated numeric results on create', async () => {
    const res = await POST(request(body()))
    expect(res.status).toBe(200)
    expect(q.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        guild_code: 'TEST',
        created_by: user,
        plan: plan()
      })
    )
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
  it('requires own-guild same-season baseline before mutation', async () => {
    q.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(
      (await POST(request({ ...body(), baseline_plan_id: id }))).status
    ).toBe(400)
    expect(q.eq).toHaveBeenCalledWith('guild_code', 'TEST')
    expect(q.insert).not.toHaveBeenCalled()
  })
  it('updates an existing scoped plan rather than creating another plan', async () => {
    const res = await POST(request({ ...body(), id }))
    expect(res.status).toBe(200)
    expect(q.update).toHaveBeenCalled()
    expect(q.insert).not.toHaveBeenCalled()
    expect(q.eq).toHaveBeenCalledWith('id', id)
    expect(q.eq).toHaveBeenCalledWith('guild_code', 'TEST')
    expect(q.update.mock.calls[0][0]).not.toHaveProperty('created_by')
  })
  it('keeps RLS denial truthful on save', async () => {
    q.single.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'denied' }
    })
    expect((await POST(request(body()))).status).toBe(403)
  })
  it('member reads use the read context and filter guild and saved season', async () => {
    const res = await saved.GET(
      new NextRequest(
        'http://localhost/api/guild-raid/season-plan?season_id=' +
          config +
          '&season=' +
          season
      )
    )
    expect(res.status).toBe(200)
    expect(m.readContext).toHaveBeenCalled()
    expect(m.context).not.toHaveBeenCalled()
    expect(q.eq).toHaveBeenCalledWith('guild_code', 'TEST')
    expect(q.eq).toHaveBeenCalledWith('plan->>season', season)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
  it.each(['bad', '', id + 'x'])(
    'rejects invalid plan UUID %j',
    async (value) => {
      const res = await saved.GET(
        new NextRequest(
          'http://localhost/api/guild-raid/season-plan?id=' + value
        )
      )
      expect(res.status).toBe(400)
    }
  )
  it('deletes exactly one scoped saved plan with readback', async () => {
    expect(saved.DELETE).toBeTypeOf('function')
    const res = await saved.DELETE!(
      new NextRequest('http://localhost/api/guild-raid/season-plan?id=' + id, {
        method: 'DELETE'
      })
    )
    expect(res.status).toBe(200)
    expect(q.delete).toHaveBeenCalled()
    expect(q.eq).toHaveBeenCalledWith('guild_code', 'TEST')
    expect(q.eq).toHaveBeenCalledWith('id', id)
  })
})

it('does not add hosted DELETE capability', async () => {
  m.desktop = false
  const res = await saved.DELETE!(
    new NextRequest('http://localhost/api/guild-raid/season-plan?id=' + id, {
      method: 'DELETE'
    })
  )
  expect(res.status).toBe(405)
  expect(m.context).not.toHaveBeenCalled()
  expect(q.delete).not.toHaveBeenCalled()
})

it('refuses unimported numerical season or arbitrary captured configuration on save', async () => {
  const p = plan()
  p.season = '999999'
  p.snapshot.season = '999999'
  expect((await POST(request({ ...body(), plan: p }))).status).toBe(404)
  expect(q.insert).not.toHaveBeenCalled()
  const arbitrary = {
    ...body(),
    season_id: 'made-up',
    plan: {
      ...plan(),
      season_id: 'made-up',
      snapshot: { ...plan().snapshot, seasonId: 'made-up' }
    }
  }
  expect((await POST(request(arbitrary))).status).toBe(422)
  expect(q.insert).not.toHaveBeenCalled()
})
it('refuses internally matching dates outside the canonical selected season', async () => {
  const differentStart = new Date(window.seasonStartMs + 3600000).toISOString()
  const value = {
    ...body(),
    start_at: differentStart,
    plan: { ...plan(), season_start_at: differentStart }
  }
  expect((await POST(request(value))).status).toBe(400)
  expect(q.insert).not.toHaveBeenCalled()
})
