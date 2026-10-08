import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  service: vi.fn(),
  live: vi.fn(),
  snapshot: vi.fn(),
  progression: vi.fn()
}))
vi.mock('@tacticus/app-core/runtime-profile', () => ({
  getRuntimeProfile: () => 'desktop'
}))
vi.mock('@/app/lib/db', () => ({ serviceDb: m.service }))
vi.mock('@/app/lib/loki/rotation-cache', () => ({
  ensureRotationSnapshot: m.live
}))
vi.mock('@/app/lib/data/boss-hp', () => ({ getAllBossHp: async () => ({}) }))
vi.mock('@/app/lib/boss-assignments/season-planner/snapshot', () => ({
  buildPlanFromNowSnapshot: m.snapshot
}))
vi.mock('@/app/lib/boss-assignments/progression-config', () => ({
  getActiveProgressionConfig: m.progression
}))
vi.mock('@/app/lib/boss-assignments/resolve-officer-targets', () => ({
  loadPlanTargetSignalsForSeason: async () => ({
    skippedPrimes: new Map(),
    officerTargets: new Map()
  })
}))
vi.mock('@/app/lib/boss-assignments/season-sequence', () => ({
  computeRemainingBossSequence: () => []
}))
import { generateSeasonPlanForGuild } from '@/app/lib/boss-assignments/season-planner/generate-season-plan'
import { getSeasonConfigForSeasonNumber } from '@/app/lib/loki/season-configs'
import { resolveSavedPlanningRotation } from '@/app/lib/boss-assignments/season-planner/saved-season'
const season = Array.from({ length: 300 }, (_, i) => i + 1).find((i) =>
  getSeasonConfigForSeasonNumber(i)
)!
const query = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockResolvedValue({ data: [], error: null })
}
const signed = { from: vi.fn(() => query) }
beforeEach(() => {
  vi.clearAllMocks()
  m.service.mockImplementation(() => {
    throw new Error('unexpected service bypass')
  })
  m.live.mockImplementation(() => {
    throw new Error('unexpected live cache')
  })
  m.progression.mockResolvedValue({
    firstPassSequence: ['L1'],
    loopSequence: ['L1'],
    loopStartStage: 'L1'
  })
  m.snapshot.mockImplementation(
    async ({ snapshotAt }: { snapshotAt: string }) => ({
      snapshotAt,
      guildCode: 'TEST',
      season: String(season),
      seasonId: getSeasonConfigForSeasonNumber(season)!.id,
      stageCode: 'L1',
      loopIndex: 0,
      encounters: Object.fromEntries(
        ['main', 'prime1', 'prime2'].map((k) => [
          k,
          {
            stageCode: 'L1',
            loopIndex: 0,
            bossName: 'Boss',
            maxHp: 100,
            remainingHp: 100
          }
        ])
      )
    })
  )
})
it('executes canonical engine on signed saved inputs without service/live acquisition', async () => {
  const result = await generateSeasonPlanForGuild({
    guildCode: 'TEST',
    season: String(season),
    snapshotAt: '2026-07-01T00:00:00Z',
    lookbackDays: 30,
    sessionsPerDay: 1,
    timeZone: 'UTC',
    signedClient: signed as never
  })
  expect(m.service).not.toHaveBeenCalled()
  expect(m.live).not.toHaveBeenCalled()
  expect(m.progression).toHaveBeenCalledWith('TEST', season, signed)
  expect(m.snapshot).toHaveBeenCalledWith(
    expect.objectContaining({
      supabase: signed,
      preferAsOfStatus: true,
      rotationSnapshot: expect.objectContaining({
        source: 'saved-season',
        seasonNumber: season
      })
    })
  )
  expect(result.plan.metrics).toEqual({
    tokensSpent: 0,
    overkillDamage: 0,
    bossesDefeated: 0,
    loopAdvances: 0,
    wastedTokens: 0,
    wastedTicks: 0
  })
  expect(result.member_count).toBe(0)
})
it('fails closed without signed local context', async () => {
  await expect(
    generateSeasonPlanForGuild({
      guildCode: 'TEST',
      season: String(season),
      snapshotAt: '2026-07-01T00:00:00Z',
      lookbackDays: 30,
      sessionsPerDay: 1
    })
  ).rejects.toThrow('Signed saved-season context')
  expect(m.service).not.toHaveBeenCalled()
})
it('refuses mismatched or uncaptured season configuration', () => {
  expect(() =>
    resolveSavedPlanningRotation(
      String(season),
      '2026-07-01T00:00:00Z',
      'invented'
    )
  ).toThrow()
  expect(() =>
    resolveSavedPlanningRotation('999999', '2026-07-01T00:00:00Z')
  ).toThrow()
})

it('matches a worked three-token saved-season schedule through unchanged engine', async () => {
  const { computeSeasonWindowMs } =
    await import('@/app/lib/boss-assignments/season-planner/season-window')
  const {
    GLOBAL_CONFIG,
    FIRST_SEASON_START_MS,
    SEASON_DURATION_SECONDS,
    SEASON_NUMBER_OFFSET
  } = await import('@/app/lib/loki/season-configs')
  const { seasonEndMs } = computeSeasonWindowMs(season, {
    firstSeasonStartMs: FIRST_SEASON_START_MS,
    seasonDurationSeconds: SEASON_DURATION_SECONDS,
    bufferAfterSeasonEndSeconds:
      GLOBAL_CONFIG.guildBoss.misc.bufferAfterSeasonEnd,
    seasonNumberOffset: SEASON_NUMBER_OFFSET
  })
  const at = new Date(seasonEndMs - 2 * 3600000).toISOString(),
    battleAt = new Date(seasonEndMs - 25 * 3600000).toISOString()
  const one = {
    player_id: 'synthetic-player',
    display_name: 'Synthetic Player'
  }
  const rows = {
    player_mapping: [one],
    EOT_GR_data: [
      {
        userId: one.player_id,
        displayName: one.display_name,
        damageType: 'Battle',
        startedOn: battleAt,
        damageDealt: 100,
        Name: 'Boss',
        encounterId: 0,
        rarity: 'Legendary',
        set: 1,
        Season: String(season)
      }
    ]
  }
  const db = {
    from: vi.fn((table: string) => ({
      ...query,
      order: vi.fn().mockResolvedValue({
        data: rows[table as keyof typeof rows] ?? [],
        error: null
      })
    }))
  }
  // Replenished cap3, exactly one future activity-hour session, main remains above300;
  // zero-HP primes cannot consume tokens or count as newly defeated bosses.
  m.snapshot.mockResolvedValue({
    snapshotAt: at,
    guildCode: 'TEST',
    season: String(season),
    seasonId: getSeasonConfigForSeasonNumber(season)!.id,
    stageCode: 'L1',
    loopIndex: 0,
    encounters: {
      main: {
        stageCode: 'L1',
        loopIndex: 0,
        bossName: 'Boss',
        maxHp: 10000,
        remainingHp: 10000
      },
      prime1: {
        stageCode: 'L1',
        loopIndex: 0,
        bossName: 'Prime1',
        maxHp: 0,
        remainingHp: 0
      },
      prime2: {
        stageCode: 'L1',
        loopIndex: 0,
        bossName: 'Prime2',
        maxHp: 0,
        remainingHp: 0
      }
    }
  })
  const result = await generateSeasonPlanForGuild({
    guildCode: 'TEST',
    season: String(season),
    snapshotAt: at,
    lookbackDays: 30,
    sessionsPerDay: 1,
    timeZone: 'UTC',
    signedClient: db as never
  })
  expect(result.plan.metrics).toEqual({
    tokensSpent: 3,
    overkillDamage: 0,
    bossesDefeated: 0,
    loopAdvances: 0,
    wastedTokens: 0,
    wastedTicks: 0
  })
  expect(result.plan.sessions).toHaveLength(1)
  expect(result.plan.sessions[0].tokensSpent).toBe(3)
  expect(
    result.plan.sessions[0].actions.reduce((sum, a) => sum + a.appliedDamage, 0)
  ).toBe(300)
})
