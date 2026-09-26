import { describe, expect, it, vi } from 'vitest'
import { buildPlanFromNowSnapshot } from '@/app/lib/boss-assignments/season-planner/snapshot'
import {
  computeStageFromMainEncounter,
  deriveRarityAndSetFromStageCode,
  deriveStageCodeFromSetAndRarity
} from '@/app/lib/boss-assignments/season-planner/snapshot-logic'

vi.mock('server-only', () => ({}))

const S107_CONFIG = {
  firstPassSequence: ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2', 'M3'],
  loopSequence: ['L4', 'L5', 'M1', 'M2', 'M3'],
  loopStartStage: 'L4',
  gameVersion: 'test-s107'
}

describe('plan-from-now snapshot stage logic', () => {
  type QueryValue = string | number | boolean | null

  it('derives stage codes from rarity/set', () => {
    expect(deriveStageCodeFromSetAndRarity(0, 'Legendary')).toBe('L1')
    expect(deriveStageCodeFromSetAndRarity(4, 'Legendary')).toBe('L5')
    expect(deriveStageCodeFromSetAndRarity(0, 'Mythic')).toBe('M1')
  })

  it('derives rarity/set from stage codes', () => {
    expect(deriveRarityAndSetFromStageCode('L1')).toEqual({
      rarity: 'Legendary',
      set: 0
    })
    expect(deriveRarityAndSetFromStageCode('L5')).toEqual({
      rarity: 'Legendary',
      set: 4
    })
    expect(deriveRarityAndSetFromStageCode('M1')).toEqual({
      rarity: 'Mythic',
      set: 0
    })
    expect(deriveRarityAndSetFromStageCode('bad')).toBeNull()
  })

  it('fails instead of guessing when an untyped caller omits the config', () => {
    expect(() =>
      computeStageFromMainEncounter(
        {
          rarity: 'Mythic',
          set: 2,
          loopIndex: 1,
          remainingHp: 0
        },
        undefined as never
      )
    ).toThrow()
  })

  it("WITH the season's config, clearing M3 wraps to L4 at loop+1", () => {
    expect(
      computeStageFromMainEncounter(
        { rarity: 'Mythic', set: 2, loopIndex: 1, remainingHp: 0 },
        S107_CONFIG
      )
    ).toEqual({ stageCode: 'L4', loopIndex: 2, advancedStage: true })
  })

  it("WITH the season's config, L3 is never re-entered after the first pass", () => {
    // L5 -> M1 mid-loop, and the loop tail never revisits L1-L3.
    expect(
      computeStageFromMainEncounter(
        { rarity: 'Legendary', set: 4, loopIndex: 2, remainingHp: 0 },
        S107_CONFIG
      )
    ).toEqual({ stageCode: 'M1', loopIndex: 2, advancedStage: true })
  })

  it('advances the stage when main remainingHp is zero', () => {
    expect(
      computeStageFromMainEncounter(
        {
          rarity: 'Legendary',
          set: 3,
          loopIndex: 2,
          remainingHp: 0
        },
        S107_CONFIG
      )
    ).toEqual({ stageCode: 'L5', loopIndex: 2, advancedStage: true })
  })

  it('advances from M1 to M2 without wrapping the loop index', () => {
    expect(
      computeStageFromMainEncounter(
        {
          rarity: 'Mythic',
          set: 0,
          loopIndex: 3,
          remainingHp: 0
        },
        S107_CONFIG
      )
    ).toEqual({ stageCode: 'M2', loopIndex: 3, advancedStage: true })
  })

  it('advances from M2 to M3 without wrapping the loop index', () => {
    expect(
      computeStageFromMainEncounter(
        {
          rarity: 'Mythic',
          set: 1,
          loopIndex: 3,
          remainingHp: 0
        },
        S107_CONFIG
      )
    ).toEqual({ stageCode: 'M3', loopIndex: 3, advancedStage: true })
  })

  it('does not advance when main remainingHp is positive', () => {
    expect(
      computeStageFromMainEncounter(
        {
          rarity: 'Legendary',
          set: 0,
          loopIndex: 3,
          remainingHp: 123
        },
        S107_CONFIG
      )
    ).toEqual({ stageCode: 'L1', loopIndex: 3, advancedStage: false })
  })

  it('defaults to L1 when no main encounter exists', () => {
    expect(computeStageFromMainEncounter(null, S107_CONFIG)).toEqual({
      stageCode: 'L1',
      loopIndex: 0,
      advancedStage: false
    })
  })
})

describe('buildPlanFromNowSnapshot', () => {
  type QueryRow = Record<string, string | number | null>
  type QueryResult = { data: QueryRow | null; error: null }

  const bossHpData = {
    legendary: { L1: 1000 },
    mythic: {},
    primes: {
      Avatar_L1: 100,
      Avatar_prime2_L1: 200
    },
    byBossName: { Avatar_L1: 1000 }
  }

  const makeQuery = (result: QueryResult) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: result.data ? [result.data] : [],
      error: result.error
    }),
    maybeSingle: vi.fn().mockResolvedValue(result)
  })

  const makeFilteringQuery = (rows: QueryRow[]) => {
    const filters: Array<(row: QueryRow) => boolean> = []
    const orders: Array<{
      column: string
      ascending?: boolean
      nullsFirst?: boolean
    }> = []
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((column: string, value: QueryValue) => {
        filters.push((row) => row[column] === value)
        return query
      }),
      in: vi.fn((column: string, values: QueryValue[]) => {
        filters.push((row) => values.includes(row[column]))
        return query
      }),
      lte: vi.fn((column: string, value: string) => {
        filters.push((row) => {
          const current = row[column]
          return typeof current === 'string' && current <= value
        })
        return query
      }),
      order: vi.fn(
        (
          column: string,
          options: { ascending?: boolean; nullsFirst?: boolean } = {}
        ) => {
          orders.push({ column, ...options })
          return query
        }
      ),
      limit: vi.fn().mockImplementation(async () => {
        const filtered = rows.filter((row) =>
          filters.every((filter) => filter(row))
        )
        filtered.sort((a, b) => {
          for (const order of orders) {
            const av = a[order.column]
            const bv = b[order.column]
            if (av === bv) continue
            if (av == null || bv == null) {
              if (av == null && bv == null) continue
              const nullFirst = order.nullsFirst === true
              const cmp = av == null ? (nullFirst ? -1 : 1) : nullFirst ? 1 : -1
              return order.ascending ? cmp : -cmp
            }
            const cmp =
              typeof av === 'number' && typeof bv === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv))
            if (cmp !== 0) return order.ascending ? cmp : -cmp
          }
          return 0
        })
        return { data: filtered, error: null }
      })
    }
    return query
  }

  it('uses an as-of EOT_GR_data status query for historical snapshots', async () => {
    const snapshotAt = '2026-07-08T12:00:00.000Z'
    const mainQuery = makeQuery({
      data: {
        Name: 'Avatar',
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 1000,
        remainingHp: 700,
        encounterId: 0,
        startedOn: '2026-07-08T11:58:00.000Z',
        completedOn: '2026-07-08T11:59:00.000Z',
        timestamp: '2026-07-09T00:00:00.000Z'
      },
      error: null
    })
    const prime1Query = makeQuery({ data: null, error: null })
    const prime2Query = makeQuery({ data: null, error: null })
    const queries = [mainQuery, prime1Query, prime2Query]
    const supabase = {
      from: vi.fn().mockImplementation(() => {
        const query = queries.shift()
        if (!query) throw new Error('Unexpected query')
        return query
      }),
      rpc: vi.fn()
    }

    const snapshot = await buildPlanFromNowSnapshot({
      supabase: supabase as never,
      guildCode: 'G1',
      season: '140',
      seasonId: 'config-140',
      snapshotAt,
      bossHpData,
      rotationSnapshot: null,
      progressionConfig: S107_CONFIG,
      preferAsOfStatus: true
    })

    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.from).toHaveBeenCalledWith('EOT_GR_data')
    expect(mainQuery.eq).toHaveBeenCalledWith('Guild', 'G1')
    expect(mainQuery.eq).toHaveBeenCalledWith('Season', '140')
    expect(mainQuery.eq).toHaveBeenCalledWith('encounterId', 0)
    expect(mainQuery.lte).toHaveBeenCalledWith('startedOn', snapshotAt)
    expect(mainQuery.order).toHaveBeenCalledWith('startedOn', {
      ascending: false,
      nullsFirst: false
    })
    expect(prime1Query.lte).toHaveBeenCalledWith('startedOn', snapshotAt)
    expect(prime1Query.order).toHaveBeenCalledWith('startedOn', {
      ascending: false,
      nullsFirst: false
    })
    expect(prime2Query.lte).toHaveBeenCalledWith('startedOn', snapshotAt)
    expect(prime2Query.order).toHaveBeenCalledWith('startedOn', {
      ascending: false,
      nullsFirst: false
    })
    expect(snapshot.encounters.main).toMatchObject({
      bossName: 'Avatar',
      maxHp: 1000,
      remainingHp: 700,
      confidence: 'high'
    })
  })

  it('uses completedOn, timestamp, startedOn event time for as-of snapshots', async () => {
    const snapshotAt = '2026-07-08T12:00:00.000Z'
    const rows: QueryRow[] = [
      {
        Guild: 'G1',
        Season: '140',
        damageType: 'Battle',
        Name: 'Avatar',
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 1000,
        remainingHp: 700,
        encounterId: 0,
        startedOn: '2026-07-08T11:58:00.000Z',
        completedOn: null,
        timestamp: '2026-07-08T11:59:00.000Z'
      },
      {
        Guild: 'G1',
        Season: '140',
        damageType: 'Battle',
        Name: 'Avatar',
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 1000,
        remainingHp: 850,
        encounterId: 0,
        startedOn: '2026-07-08T11:50:00.000Z',
        completedOn: '2026-07-08T11:51:00.000Z',
        timestamp: '2026-07-08T11:51:30.000Z'
      }
    ]
    const supabase = {
      from: vi.fn().mockImplementation(() => makeFilteringQuery(rows)),
      rpc: vi.fn()
    }

    const snapshot = await buildPlanFromNowSnapshot({
      supabase: supabase as never,
      guildCode: 'G1',
      season: '140',
      seasonId: 'config-140',
      snapshotAt,
      bossHpData,
      rotationSnapshot: null,
      progressionConfig: S107_CONFIG,
      preferAsOfStatus: true
    })

    expect(snapshot.encounters.main).toMatchObject({
      bossName: 'Avatar',
      remainingHp: 700,
      seededFromMax: false,
      confidence: 'high'
    })
  })

  it('excludes boss status rows that started before the snapshot but completed after it', async () => {
    const snapshotAt = '2026-07-08T12:00:00.000Z'
    const rows: QueryRow[] = [
      {
        Guild: 'G1',
        Season: '140',
        damageType: 'Battle',
        Name: 'Avatar',
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 1000,
        remainingHp: 0,
        encounterId: 0,
        startedOn: '2026-07-08T11:59:00.000Z',
        completedOn: '2026-07-08T12:02:00.000Z',
        timestamp: '2026-07-08T12:02:30.000Z'
      },
      {
        Guild: 'G1',
        Season: '140',
        damageType: 'Battle',
        Name: 'Avatar',
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 1000,
        remainingHp: 700,
        encounterId: 0,
        startedOn: '2026-07-08T11:50:00.000Z',
        completedOn: '2026-07-08T11:51:00.000Z',
        timestamp: '2026-07-09T00:00:00.000Z'
      },
      {
        Guild: 'G1',
        Season: '140',
        damageType: 'Battle',
        Name: 'Prime One',
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 100,
        remainingHp: 0,
        encounterId: 1,
        startedOn: '2026-07-08T11:59:00.000Z',
        completedOn: '2026-07-08T12:02:00.000Z',
        timestamp: '2026-07-08T12:02:30.000Z'
      },
      {
        Guild: 'G1',
        Season: '140',
        damageType: 'Battle',
        Name: 'Prime One',
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 100,
        remainingHp: 80,
        encounterId: 1,
        startedOn: '2026-07-08T11:49:00.000Z',
        completedOn: '2026-07-08T11:50:00.000Z',
        timestamp: '2026-07-09T00:00:00.000Z'
      },
      {
        Guild: 'G1',
        Season: '140',
        damageType: 'Battle',
        Name: 'Prime Two',
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 200,
        remainingHp: 0,
        encounterId: 2,
        startedOn: '2026-07-08T11:59:00.000Z',
        completedOn: '2026-07-08T12:02:00.000Z',
        timestamp: '2026-07-08T12:02:30.000Z'
      },
      {
        Guild: 'G1',
        Season: '140',
        damageType: 'Battle',
        Name: 'Prime Two',
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 200,
        remainingHp: 160,
        encounterId: 2,
        startedOn: '2026-07-08T11:48:00.000Z',
        completedOn: '2026-07-08T11:49:00.000Z',
        timestamp: '2026-07-09T00:00:00.000Z'
      }
    ]
    const supabase = {
      from: vi.fn().mockImplementation(() => makeFilteringQuery(rows)),
      rpc: vi.fn()
    }

    const snapshot = await buildPlanFromNowSnapshot({
      supabase: supabase as never,
      guildCode: 'G1',
      season: '140',
      seasonId: 'config-140',
      snapshotAt,
      bossHpData,
      rotationSnapshot: null,
      progressionConfig: S107_CONFIG,
      preferAsOfStatus: true
    })

    expect(snapshot.encounters.main).toMatchObject({
      bossName: 'Avatar',
      remainingHp: 700,
      seededFromMax: false,
      confidence: 'high'
    })
    expect(snapshot.encounters.prime1).toMatchObject({
      bossName: 'Prime One',
      remainingHp: 80,
      seededFromMax: false,
      confidence: 'high'
    })
    expect(snapshot.encounters.prime2).toMatchObject({
      bossName: 'Prime Two',
      remainingHp: 160,
      seededFromMax: false,
      confidence: 'high'
    })
  })

  it('does not advance to the next stage while a same-stage prime remains alive', async () => {
    const snapshotAt = '2026-07-08T12:00:00.000Z'
    const rows: QueryRow[] = [
      {
        Guild: 'G1',
        Season: '140',
        damageType: 'Battle',
        Name: 'Avatar',
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 1000,
        remainingHp: 0,
        encounterId: 0,
        startedOn: '2026-07-08T11:30:00.000Z',
        completedOn: '2026-07-08T11:31:00.000Z',
        timestamp: '2026-07-08T11:31:30.000Z'
      },
      {
        Guild: 'G1',
        Season: '140',
        damageType: 'Battle',
        Name: 'Prime One',
        rarity: 'Legendary',
        set: 0,
        loopIndex: 0,
        maxHp: 100,
        remainingHp: 80,
        encounterId: 1,
        startedOn: '2026-07-08T11:40:00.000Z',
        completedOn: '2026-07-08T11:41:00.000Z',
        timestamp: '2026-07-08T11:41:30.000Z'
      }
    ]
    const supabase = {
      from: vi.fn().mockImplementation(() => makeFilteringQuery(rows)),
      rpc: vi.fn()
    }

    const snapshot = await buildPlanFromNowSnapshot({
      supabase: supabase as never,
      guildCode: 'G1',
      season: '140',
      seasonId: 'config-140',
      snapshotAt,
      bossHpData,
      rotationSnapshot: null,
      progressionConfig: S107_CONFIG,
      preferAsOfStatus: true
    })

    expect(snapshot.stageCode).toBe('L1')
    expect(snapshot.advancedStage).toBe(false)
    expect(snapshot.encounters.main).toMatchObject({
      bossName: 'Avatar',
      remainingHp: 0,
      seededFromMax: false,
      confidence: 'high'
    })
    expect(snapshot.encounters.prime1).toMatchObject({
      bossName: 'Prime One',
      remainingHp: 80,
      seededFromMax: false,
      confidence: 'high'
    })
  })

  it('treats live RPC null remaining_hp as defeated and advances when primes are absent', async () => {
    const noPrimeBossHpData = {
      legendary: { L1: 1000, L2: 2000 },
      mythic: {},
      primes: {},
      byBossName: { Avatar_L1: 1000, Avatar_L2: 2000 }
    }
    const prime1Query = makeQuery({ data: null, error: null })
    const prime2Query = makeQuery({ data: null, error: null })
    const queries = [prime1Query, prime2Query]
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            boss_name: 'Avatar',
            rarity: 'Legendary',
            set: 0,
            encounter_id: 0,
            max_hp: 1000,
            remaining_hp: null,
            loop_index: 0,
            completed_on: '2026-07-08T11:59:00.000Z'
          }
        ],
        error: null
      }),
      from: vi.fn().mockImplementation(() => {
        const query = queries.shift()
        if (!query) throw new Error('Unexpected query')
        return query
      })
    }

    const snapshot = await buildPlanFromNowSnapshot({
      supabase: supabase as never,
      guildCode: 'G1',
      season: '140',
      seasonId: 'config-140',
      snapshotAt: '2026-07-08T12:00:00.000Z',
      bossHpData: noPrimeBossHpData,
      rotationSnapshot: null,
      progressionConfig: S107_CONFIG
    })

    expect(snapshot.stageCode).toBe('L2')
    expect(snapshot.advancedStage).toBe(true)
    expect(snapshot.encounters.main).toMatchObject({
      bossName: 'Avatar',
      maxHp: 2000,
      remainingHp: 2000,
      seededFromMax: true
    })
  })
})
