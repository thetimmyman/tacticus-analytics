import { describe, expect, it, vi } from 'vitest'
import { __testing } from '@/app/lib/boss-assignments/season-planner/roster-strategy'
import type { PlannerResult } from '@/app/lib/boss-assignments/season-planner/planner-engine'

vi.mock('server-only', () => ({}))

type StrategyBattleRow = Parameters<
  typeof __testing.filterBattleRowsForProjection
>[0][number]

const battleRow = (
  overrides: Partial<StrategyBattleRow> = {}
): StrategyBattleRow => ({
  userId: 'p1',
  displayName: 'Player One',
  Guild: 'G1',
  damageType: 'Battle',
  startedOn: '2026-07-08T12:00:00.000Z',
  damageDealt: 1000,
  Name: 'Boss',
  encounterId: 0,
  rarity: 'Legendary',
  set: 1,
  Season: '42',
  ...overrides
})

const plannerResult = (
  playerId: string,
  appliedDamage: number
): PlannerResult => ({
  sessions: [
    {
      at: '2026-07-08T12:00:00.000Z',
      playerId,
      playerDisplayName: playerId,
      tokensAvailable: 3,
      tokensSpent: 1,
      tokensHeld: 2,
      actions: [
        {
          type: 'token_attack',
          at: '2026-07-08T12:00:00.000Z',
          playerId,
          stageCode: 'L1',
          loopIndex: 0,
          encounterId: 0,
          bossName: 'Boss',
          expectedDamage: appliedDamage,
          appliedDamage,
          overkillDamage: 0
        }
      ]
    }
  ],
  finalRaidState: {
    stageCode: 'L1',
    loopIndex: 0,
    encounters: {
      0: {
        encounterId: 0,
        stageCode: 'L1',
        loopIndex: 0,
        bossName: 'Boss',
        maxHp: 1000,
        remainingHp: 0
      }
    }
  },
  metrics: {
    tokensSpent: 1,
    overkillDamage: 0,
    bossesDefeated: 1,
    loopAdvances: 0,
    wastedTokens: 0,
    wastedTicks: 0
  },
  warnings: []
})

type GuildServiceRow = Record<string, string | null>

const makeGuildService = (args: {
  target: GuildServiceRow | null
  rows: GuildServiceRow[]
}) => {
  const targetQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: args.target, error: null })
  }
  const listQuery = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn()
  }
  listQuery.eq.mockImplementation((column: string) =>
    column === 'enabled'
      ? listQuery
      : Promise.resolve({ data: args.rows, error: null })
  )
  let fromCount = 0
  const service = {
    from: vi.fn().mockImplementation(() => {
      fromCount += 1
      return fromCount === 1 ? targetQuery : listQuery
    })
  }

  return {
    service: service as Parameters<typeof __testing.loadGuilds>[0],
    listQuery
  }
}

describe('roster strategy service helpers', () => {
  it('loads battle history in guild, season, and player chunks', async () => {
    type RequestShape = {
      eq: Array<{ column: string; value: string }>
      in: Array<{ column: string; values: string[] }>
      range: { from: number; to: number } | null
    }
    const requests: RequestShape[] = []
    const service = {
      from: vi.fn(() => {
        const request: RequestShape = { eq: [], in: [], range: null }
        requests.push(request)
        const query = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((column: string, value: string) => {
            request.eq.push({ column, value })
            return query
          }),
          in: vi.fn((column: string, values: string[]) => {
            request.in.push({ column, values })
            return query
          }),
          order: vi.fn().mockReturnThis(),
          range: vi.fn((from: number, to: number) => {
            request.range = { from, to }
            return Promise.resolve({ data: [battleRow()], error: null })
          })
        }
        return query
      })
    }

    await __testing.loadBattleRows({
      service: service as Parameters<
        typeof __testing.loadBattleRows
      >[0]['service'],
      guildCodes: ['G1', 'G2'],
      playerIds: Array.from({ length: 41 }, (_, index) => `p${index}`),
      seasons: ['104', '105']
    })

    expect(requests).toHaveLength(8)
    for (const request of requests) {
      expect(request.eq.map((filter) => filter.column)).toEqual([
        'Guild',
        'Season'
      ])
      expect(
        request.in.find((filter) => filter.column === 'Guild')
      ).toBeUndefined()
      expect(
        request.in.find((filter) => filter.column === 'Season')
      ).toBeUndefined()
      expect(
        request.in.find((filter) => filter.column === 'userId')?.values.length
      ).toBeLessThanOrEqual(40)
      expect(request.range).toEqual({ from: 0, to: 999 })
    }
  })

  it('bounds season battle rows to the effective projection snapshot', () => {
    const rows = [
      battleRow({ startedOn: '2026-07-08T11:00:00.000Z' }),
      battleRow({ startedOn: '2026-07-08T13:00:00.000Z' }),
      battleRow({ startedOn: '2026-07-07T23:00:00.000Z' }),
      battleRow({ Season: '41', startedOn: '2026-07-08T11:00:00.000Z' }),
      battleRow({ startedOn: 'not-a-date' })
    ]

    const scoped = __testing.filterBattleRowsForProjection(rows, {
      season: '42',
      seasonStartMs: new Date('2026-07-08T00:00:00.000Z').getTime(),
      snapshotMs: new Date('2026-07-08T12:00:00.000Z').getTime()
    })

    expect(scoped.map((row) => row.startedOn)).toEqual([
      '2026-07-08T11:00:00.000Z'
    ])
  })

  it('excludes signal rows after the projection reference timestamp', () => {
    const scoped = __testing.filterSignalRowsForProjection(
      [
        battleRow({ startedOn: '2026-07-08T11:59:59.000Z' }),
        battleRow({ startedOn: '2026-07-08T12:00:01.000Z' }),
        battleRow({ startedOn: 'not-a-date' })
      ],
      new Date('2026-07-08T12:00:00.000Z').getTime()
    )

    expect(scoped.map((row) => row.startedOn)).toEqual([
      '2026-07-08T11:59:59.000Z'
    ])
  })

  it('scopes token rows to the projected season window', () => {
    const scoped = __testing.filterTokenRowsForProjection(
      [
        battleRow({ Season: '41', startedOn: '2026-07-07T23:00:00.000Z' }),
        battleRow({ Season: '42', startedOn: '2026-07-08T11:59:59.000Z' }),
        battleRow({ Season: '42', startedOn: '2026-07-08T12:00:01.000Z' }),
        battleRow({ Season: '42', startedOn: '2026-07-07T23:59:59.000Z' }),
        battleRow({ Season: '41', startedOn: 'not-a-date' })
      ],
      {
        season: '42',
        seasonStartMs: new Date('2026-07-08T00:00:00.000Z').getTime(),
        snapshotMs: new Date('2026-07-08T12:00:00.000Z').getTime()
      }
    )

    expect(scoped.map((row) => `${row.Season}:${row.startedOn}`)).toEqual([
      '42:2026-07-08T11:59:59.000Z'
    ])
  })

  it('uses MoW ability recommendations instead of impossible rank targets', () => {
    const demand = {
      heroName: 'Biovore',
      unitId: 'biovore',
      bossName: 'Avatar',
      raritySet: 'L5',
      damageP90: 1_000_000,
      attackCount: 50
    }
    const hero = {
      heroName: 'Biovore',
      unitId: 'biovore',
      category: 'MOW',
      rankName: null,
      rankIndex: null,
      activeAbility: 20,
      passiveAbility: 20,
      progressionIndex: 12,
      stars: null
    }

    expect(__testing.stateForHeroDemand(hero, demand)).toBe('Weak')
    expect(__testing.describeInvestmentStep(hero, 'Weak', demand)).toBe(
      'Raise Biovore abilities toward 30 for L5 teams.'
    )
    expect(
      __testing.describeInvestmentStep(hero, 'Weak', demand)
    ).not.toContain('Diamond')
  })

  it('anchors signal history to the requested snapshot, capped at now', () => {
    const nowMs = new Date('2026-07-09T12:00:00.000Z').getTime()

    expect(
      __testing.resolveSignalReferenceMs(
        new Date('2026-07-01T12:00:00.000Z').getTime(),
        nowMs
      )
    ).toBe(new Date('2026-07-01T12:00:00.000Z').getTime())
    expect(
      __testing.resolveSignalReferenceMs(
        new Date('2026-07-12T12:00:00.000Z').getTime(),
        nowMs
      )
    ).toBe(nowMs)
    expect(__testing.resolveSignalReferenceMs(Number.NaN, nowMs)).toBe(nowMs)
  })

  it('keeps the current selection on the live rotation path when config_id is omitted', () => {
    expect(
      __testing.buildSeasonWindowSpecs({
        baseSeason: '107',
        baseConfigId: null,
        liveSeason: '107',
        seasonCount: 1
      })
    ).toEqual([
      {
        season: '107',
        configId: null,
        label: 'Current selection'
      }
    ])

    const multiSeason = __testing.buildSeasonWindowSpecs({
      baseSeason: '107',
      baseConfigId: null,
      liveSeason: '107',
      seasonCount: 2
    })
    expect(multiSeason[0]?.configId).toBeNull()
    expect(multiSeason[1]?.season).toBe('108')
  })

  it('uses the season overlay for an explicit non-live current selection', () => {
    const seasonSpecs = __testing.buildSeasonWindowSpecs({
      baseSeason: '107',
      baseConfigId: null,
      liveSeason: '106',
      seasonCount: 1
    })

    expect(seasonSpecs[0]?.season).toBe('107')
    expect(seasonSpecs[0]?.configId).toBeTruthy()
  })

  it('rejects optimizer deltas that improve score by regressing output', () => {
    const positiveEfficiencyRegression = {
      tokensSpent: -1,
      wastedTokens: 0,
      bossesDefeated: 0,
      loopAdvances: 0,
      appliedDamage: -500,
      expectedDamage: -500,
      overkillDamage: 0,
      tokenEfficiency: 10_000,
      score: 1
    }
    const noMaterialProgress = {
      ...positiveEfficiencyRegression,
      tokensSpent: 0,
      appliedDamage: 0,
      expectedDamage: 0,
      tokenEfficiency: 10_000,
      score: 1
    }
    const realImprovement = {
      ...positiveEfficiencyRegression,
      tokensSpent: 0,
      appliedDamage: 10,
      expectedDamage: 10,
      tokenEfficiency: 0,
      score: 1
    }

    expect(
      __testing.isOptimizerDeltaBeneficial(positiveEfficiencyRegression)
    ).toBe(false)
    expect(__testing.isOptimizerDeltaBeneficial(noMaterialProgress)).toBe(false)
    expect(__testing.isOptimizerDeltaBeneficial(realImprovement)).toBe(true)
  })

  it('caps optimizer evaluation work above the returned recommendation count', () => {
    expect(__testing.optimizerEvaluationBudget(5)).toBe(60)
    expect(__testing.optimizerEvaluationBudget(0)).toBe(12)
  })

  it('summarizes contribution rows across every projected season', () => {
    const contributions = __testing.summarizeProjectionContributions([
      plannerResult('p1', 100),
      plannerResult('p2', 200)
    ])

    expect(contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: 'p1', appliedDamage: 100 }),
        expect.objectContaining({ playerId: 'p2', appliedDamage: 200 })
      ])
    )
  })

  it('loads cluster guilds by canonical cluster_id, not display cluster_code', async () => {
    const { service, listQuery } = makeGuildService({
      target: {
        guild_code: 'G1',
        display_name: 'Guild One',
        cluster_code: 'shared-name',
        cluster_id: 'cluster-uuid-1',
        timezone: 'UTC'
      },
      rows: [
        {
          guild_code: 'G1',
          display_name: 'Guild One',
          cluster_code: 'shared-name',
          timezone: 'UTC'
        },
        {
          guild_code: 'G2',
          display_name: 'Guild Two',
          cluster_code: 'renamed-display',
          timezone: 'UTC'
        }
      ]
    })

    const result = await __testing.loadGuilds(service, 'G1')

    expect(listQuery.eq).toHaveBeenCalledWith('enabled', true)
    expect(listQuery.eq).toHaveBeenCalledWith('cluster_id', 'cluster-uuid-1')
    expect(listQuery.eq).not.toHaveBeenCalledWith('cluster_code', 'shared-name')
    expect(result.clusterCode).toBe('shared-name')
    expect(result.guilds.map((guild) => guild.guildCode)).toEqual(['G1', 'G2'])
  })

  it('falls back to the target guild only when canonical cluster_id is absent', async () => {
    const { service, listQuery } = makeGuildService({
      target: {
        guild_code: 'G1',
        display_name: 'Guild One',
        cluster_code: 'shared-name',
        cluster_id: null,
        timezone: 'UTC'
      },
      rows: [
        {
          guild_code: 'G1',
          display_name: 'Guild One',
          cluster_code: 'shared-name',
          timezone: 'UTC'
        }
      ]
    })

    const result = await __testing.loadGuilds(service, 'G1')

    expect(listQuery.eq).toHaveBeenCalledWith('enabled', true)
    expect(listQuery.eq).toHaveBeenCalledWith('guild_code', 'G1')
    expect(listQuery.eq).not.toHaveBeenCalledWith('cluster_code', 'shared-name')
    expect(result.clusterCode).toBeNull()
    expect(result.guilds.map((guild) => guild.guildCode)).toEqual(['G1'])
  })

  it('does not fall back to a disabled or missing target guild', async () => {
    const { service } = makeGuildService({
      target: null,
      rows: []
    })

    await expect(__testing.loadGuilds(service, 'G1')).rejects.toThrow(
      'Target guild is not enabled for roster strategy.'
    )
  })
})
