import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Errors } from '@/app/lib/errors/AppError'
const m = vi.hoisted(() => ({
  desktop: true,
  user: { id: '22222222-2222-4222-8222-222222222222' } as { id: string } | null,
  profile: {
    guild_code: 'TEST',
    role: 'officer',
    is_app_admin: false
  } as Record<string, unknown> | null,
  feature: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  eq: vi.fn()
}))
vi.mock('@tacticus/app-core/runtime-profile', () => ({
  getRuntimeProfile: () => (m.desktop ? 'desktop' : 'hosted')
}))
vi.mock('@/app/lib/db', () => ({ db: async () => client }))
vi.mock('@/app/lib/api/session-user', () => ({
  requireSessionUser: async () => {
    if (!m.user) throw Errors.authenticationRequired()
    return m.user
  },
  resolveCurrentMembership: async () => m.profile
}))
vi.mock('@/app/lib/services/feature-release-service', () => ({
  checkFeatureAccess: m.feature
}))
vi.mock('@/app/lib/utils/season', () => ({
  getLatestSeason: async () => '140'
}))
const client = { from: m.from, rpc: m.rpc }
import {
  requireSeasonPlanOfficerContext,
  requireSeasonPlanReadContext,
  resolveSeasonPlanSeason,
  validateDesktopPlanningParameters
} from '@/app/api/guild-raid/season-plan/_shared'
beforeEach(() => {
  vi.clearAllMocks()
  m.desktop = true
  m.user = { id: '22222222-2222-4222-8222-222222222222' }
  m.profile = { guild_code: 'TEST', role: 'officer', is_app_admin: false }
  m.feature.mockResolvedValue({ has_access: true })
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: m.eq,
    single: async () => ({ data: m.profile, error: null })
  }
  m.eq.mockReturnValue(q)
  m.from.mockReturnValue(q)
  m.rpc.mockResolvedValue({ data: ['139', '140'], error: null })
})
describe('signed saved planning admission', () => {
  it.each(['member', 'MEMBER'])(
    'permits canonical member read %s but refuses writes even app-admin',
    async (role) => {
      m.profile = { guild_code: 'TEST', role, is_app_admin: true }
      expect((await requireSeasonPlanReadContext()).profile.guild_code).toBe(
        'TEST'
      )
      await expect(
        requireSeasonPlanOfficerContext({ requireFeatureAccess: true })
      ).rejects.toMatchObject({ statusCode: 403 })
    }
  )
  it.each(['officer', 'OFFICER', 'leader', 'LEADER'])(
    'permits current scoped writer %s',
    async (role) => {
      m.profile = { guild_code: 'TEST', role, is_app_admin: false }
      await expect(
        requireSeasonPlanOfficerContext({ requireFeatureAccess: true })
      ).resolves.toHaveProperty('supabase', client)
      expect(m.eq).toHaveBeenCalledWith('is_current', true)
      expect(m.eq).toHaveBeenCalledWith('is_active', true)
    }
  )
  it('passes the signed client and actual subject to both canonical feature checks', async () => {
    await requireSeasonPlanReadContext()
    expect(m.feature).toHaveBeenCalledWith(
      m.user!.id,
      'boss_assignments',
      client
    )
    expect(m.feature).toHaveBeenCalledWith(
      m.user!.id,
      'boss_assignment_season_planner',
      client
    )
  })
  it('refuses missing feature admission', async () => {
    m.feature.mockResolvedValue({ has_access: false, reason: 'alpha_only' })
    await expect(requireSeasonPlanReadContext()).rejects.toMatchObject({
      statusCode: 403
    })
  })
  it('refuses absent/stale current membership', async () => {
    m.profile = null
    await expect(requireSeasonPlanReadContext()).rejects.toMatchObject({
      statusCode: 403
    })
  })
  it('refuses anonymous access', async () => {
    m.user = null
    await expect(requireSeasonPlanReadContext()).rejects.toMatchObject({
      statusCode: 401
    })
    expect(m.feature).not.toHaveBeenCalled()
  })
  it('rejects invented admin role locally', async () => {
    m.profile = { guild_code: 'TEST', role: 'admin', is_app_admin: true }
    await expect(requireSeasonPlanReadContext()).rejects.toMatchObject({
      statusCode: 403
    })
  })
  it('selects only saved guild seasons and rejects unimported requested seasons', async () => {
    expect(await resolveSeasonPlanSeason(null, client as never, 'TEST')).toBe(
      '140'
    )
    await expect(
      resolveSeasonPlanSeason('141', client as never, 'TEST')
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(m.rpc).toHaveBeenCalledWith('get_distinct_seasons_for_guild', {
      p_guild: 'TEST'
    })
  })
  it.each([
    'lookback_days=2x',
    'lookback_days=181',
    'sessions_per_day=0',
    'sessions_per_day=4',
    'snapshot_at=invalid',
    'time_zone=not-zone'
  ])('refuses malformed inputs %s', (query) => {
    expect(() =>
      validateDesktopPlanningParameters(new URLSearchParams(query))
    ).toThrow()
  })
})
