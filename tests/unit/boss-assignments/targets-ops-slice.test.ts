/** Keys use a 1-based `set`; `loadFailed` alone stops un-skipping a prime after a failed read. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { bosses, seasonConfig } = vi.hoisted(() => {
  const bosses = [
    // `set` is 0-indexed in season-configs.
    {
      boss_type: 'HiveTyrantKronos',
      boss_name: 'Hive Tyrant (Kronos)',
      set: 3,
      encounter_id: 0,
      rarity: 'Legendary',
      canonical: 'hive_tyrant',
      variant: null
    },
    {
      boss_type: 'HiveTyrantKronos',
      boss_name: 'Hive Tyrant (Kronos)',
      set: 3,
      encounter_id: 1,
      rarity: 'Legendary',
      canonical: 'hive_tyrant',
      variant: null
    },
    {
      boss_type: 'HiveTyrantKronos',
      boss_name: 'Hive Tyrant (Kronos)',
      set: 3,
      encounter_id: 2,
      rarity: 'Legendary',
      canonical: 'hive_tyrant',
      variant: null
    },
    {
      boss_type: 'Magnus',
      boss_name: 'Magnus',
      set: 0,
      encounter_id: 1,
      rarity: 'Mythic',
      canonical: 'magnus',
      variant: null
    },
    {
      boss_type: 'TrainingDummy',
      boss_name: 'Training Dummy',
      set: 0,
      encounter_id: 0,
      rarity: 'Epic',
      canonical: 'trainingdummy',
      variant: null
    }
  ]
  return {
    bosses,
    seasonConfig: { id: 'config_1', bosses, canonicalOrder: ['hive_tyrant'] }
  }
})

vi.mock('@/app/lib/loki/season-configs', () => ({
  getSeasonConfigIdForOffset: vi.fn(() => ({
    id: 'config_1',
    seasonNumber: 100
  })),
  getSeasonConfigForSeasonNumber: vi.fn(() => seasonConfig),
  getSeasonConfigById: vi.fn(() => seasonConfig)
}))

vi.mock('@/app/lib/db', () => ({ db: vi.fn() }))

import { loadTargetsOpsSlice } from '@/app/(dashboard)/boss-assignments/targets/_lib/load-targets-ops-slice'
import { db } from '@/app/lib/db'

interface TableResponse {
  data: unknown[] | null
  error: { message: string } | null
}

let filterCalls: Array<{ table: string; op: string; args: unknown[] }> = []

function buildSupabaseMock(responses: Record<string, TableResponse>) {
  return {
    from(table: string) {
      const response = responses[table] ?? { data: [], error: null }
      const record = (op: string, args: unknown[]) => {
        filterCalls.push({ table, op, args })
      }
      const builder: Record<string, unknown> = {}
      const chain =
        (op: string) =>
        (...args: unknown[]) => {
          record(op, args)
          return builder
        }
      const terminal =
        (op: string) =>
        (...args: unknown[]) => {
          record(op, args)
          return Promise.resolve(response)
        }
      Object.assign(builder, {
        select: chain('select'),
        eq: chain('eq'),
        is: terminal('is'),
        in: terminal('in')
      })
      return builder
    }
  }
}

const HERALD_ROWS = [
  {
    boss_id: 'HiveTyrantKronos_E0',
    discord_role_ids: ['111111111111111111'],
    discord_role_labels: { '111111111111111111': 'Alpha' },
    notes: 'herald main note',
    side1_notes: 'herald side1 note',
    side2_notes: null,
    ping_mode: 'per_side',
    extra_links: [],
    custom_message_url: null
  },
  {
    boss_id: 'HiveTyrantKronos_E1',
    discord_role_ids: ['222222222222222222'],
    discord_role_labels: { '222222222222222222': 'Bravo' },
    notes: null,
    side1_notes: null,
    side2_notes: null,
    ping_mode: null,
    extra_links: [],
    custom_message_url: null
  }
]

const SEASON_OPS_ROWS = [
  {
    season_number: '104',
    level: 'L4',
    sub_bosses: {
      sub1_skip: true,
      sub2_kill_threshold_pct: 60,
      side1_notes: 'season side1 note'
    }
  },
  {
    season_number: '104',
    level: 'M1',
    sub_bosses: { sub1_skip: false }
  }
]

function installDb(
  overrides: Partial<Record<string, TableResponse>> = {}
): void {
  vi.mocked(db).mockResolvedValue(
    buildSupabaseMock({
      herald_boss_config: { data: HERALD_ROWS, error: null },
      upcoming_season_bosses: { data: SEASON_OPS_ROWS, error: null },
      ...overrides
    }) as never
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  filterCalls = []
  installDb()
})

describe('loadTargetsOpsSlice', () => {
  it('keys entries EXACTLY like mergedRows / perBossActuals, with a 1-BASED set', async () => {
    const slice = await loadTargetsOpsSlice({
      guildCode: 'GUILD',
      seasonNumber: 104,
      enabled: true
    })

    expect(Object.keys(slice.byKey).sort()).toEqual([
      'HiveTyrantKronos__Legendary__4__0',
      'HiveTyrantKronos__Legendary__4__1',
      'HiveTyrantKronos__Legendary__4__2',
      'Magnus__Mythic__1__1'
    ])
    expect(slice.seasonNumber).toBe(104)
    expect(slice.loadFailed).toBe(false)
  })

  it('derives the stage code and Herald boss id from the shared identity helpers', async () => {
    const slice = await loadTargetsOpsSlice({
      guildCode: 'GUILD',
      seasonNumber: 104,
      enabled: true
    })

    expect(slice.byKey['HiveTyrantKronos__Legendary__4__1']).toMatchObject({
      difficultyCode: 'L4',
      heraldBossId: 'HiveTyrantKronos_E1',
      bossType: 'HiveTyrantKronos',
      rarity: 'Legendary',
      set: 4,
      encounterId: 1
    })
    expect(slice.byKey['Magnus__Mythic__1__1']).toMatchObject({
      difficultyCode: 'M1',
      heraldBossId: 'Magnus_E1'
    })
  })

  it('applies the hub merge precedence per encounter', async () => {
    const slice = await loadTargetsOpsSlice({
      guildCode: 'GUILD',
      seasonNumber: 104,
      enabled: true
    })

    const main = slice.byKey['HiveTyrantKronos__Legendary__4__0']
    const prime1 = slice.byKey['HiveTyrantKronos__Legendary__4__1']
    const prime2 = slice.byKey['HiveTyrantKronos__Legendary__4__2']

    expect(main.behaviour).toBe('kill')
    expect(main.thresholdHpPct).toBeNull()
    expect(main.notes).toBe('herald main note')
    expect(main.roleIds).toEqual(['111111111111111111'])

    expect(prime1.behaviour).toBe('skip')
    expect(prime1.notes).toBe('season side1 note')
    expect(prime1.roleIds).toEqual(['222222222222222222'])
    expect(prime1.roleLabels).toEqual({ '222222222222222222': 'Bravo' })

    expect(prime2.behaviour).toBe('threshold')
    expect(prime2.thresholdHpPct).toBe(60)
    expect(prime2.roleIds).toEqual([])
    expect(prime2.notes).toBeNull()
  })

  it('does not bleed one stage’s ops onto another stage', async () => {
    const slice = await loadTargetsOpsSlice({
      guildCode: 'GUILD',
      seasonNumber: 104,
      enabled: true
    })

    // M1 must not inherit L4's skip.
    expect(slice.byKey['Magnus__Mythic__1__1'].behaviour).toBe('kill')
  })

  it('keeps the rarity_set NULL catch-all filter on the Herald read', async () => {
    await loadTargetsOpsSlice({
      guildCode: 'GUILD',
      seasonNumber: 104,
      enabled: true
    })

    // The writer hardcodes rarity_set: null; a wider read shows rows saves never update.
    expect(filterCalls).toContainEqual({
      table: 'herald_boss_config',
      op: 'is',
      args: ['rarity_set', null]
    })
    expect(filterCalls).toContainEqual({
      table: 'herald_boss_config',
      op: 'eq',
      args: ['guild_code', 'GUILD']
    })
    expect(filterCalls).toContainEqual({
      table: 'upcoming_season_bosses',
      op: 'in',
      args: ['season_number', ['104']]
    })
  })

  describe('loadFailed — a read error must never masquerade as "no ops set"', () => {
    it('flags a failed Herald read', async () => {
      installDb({
        herald_boss_config: { data: null, error: { message: 'boom' } }
      })

      const slice = await loadTargetsOpsSlice({
        guildCode: 'GUILD',
        seasonNumber: 104,
        enabled: true
      })

      expect(slice.loadFailed).toBe(true)
      expect(Object.keys(slice.byKey).length).toBeGreaterThan(0)
      expect(slice.byKey['HiveTyrantKronos__Legendary__4__0'].roleIds).toEqual(
        []
      )
    })

    it('flags a failed season-ops read even though the defaults look valid', async () => {
      installDb({
        upcoming_season_bosses: { data: null, error: { message: 'boom' } }
      })

      const slice = await loadTargetsOpsSlice({
        guildCode: 'GUILD',
        seasonNumber: 104,
        enabled: true
      })

      expect(slice.loadFailed).toBe(true)
      // The hazard: a skipped prime reads back as 'kill'; only loadFailed tells them apart.
      expect(slice.byKey['HiveTyrantKronos__Legendary__4__1'].behaviour).toBe(
        'kill'
      )
    })

    it('stays false when the reads succeed and simply return nothing', async () => {
      installDb({
        herald_boss_config: { data: [], error: null },
        upcoming_season_bosses: { data: [], error: null }
      })

      const slice = await loadTargetsOpsSlice({
        guildCode: 'GUILD',
        seasonNumber: 104,
        enabled: true
      })

      expect(slice.loadFailed).toBe(false)
      expect(slice.byKey['HiveTyrantKronos__Legendary__4__1'].behaviour).toBe(
        'kill'
      )
    })
  })

  describe('gating', () => {
    it('reads nothing for a read-only member (enabled=false)', async () => {
      const slice = await loadTargetsOpsSlice({
        guildCode: 'GUILD',
        seasonNumber: 104,
        enabled: false
      })

      expect(slice).toEqual({ seasonNumber: 104, byKey: {}, loadFailed: false })
      expect(db).not.toHaveBeenCalled()
    })

    it('reads nothing without a guild code', async () => {
      const slice = await loadTargetsOpsSlice({
        guildCode: '',
        seasonNumber: 104,
        enabled: true
      })

      expect(slice.byKey).toEqual({})
      expect(slice.loadFailed).toBe(false)
      expect(db).not.toHaveBeenCalled()
    })

    it('reads nothing for a non-finite season', async () => {
      const slice = await loadTargetsOpsSlice({
        guildCode: 'GUILD',
        seasonNumber: Number.NaN,
        enabled: true
      })

      expect(slice.byKey).toEqual({})
      expect(db).not.toHaveBeenCalled()
    })
  })

  it('excludes tiers below Legendary', async () => {
    const slice = await loadTargetsOpsSlice({
      guildCode: 'GUILD',
      seasonNumber: 104,
      enabled: true
    })

    expect(bosses.some((boss) => boss.rarity === 'Epic')).toBe(true)
    expect(
      Object.keys(slice.byKey).some((key) => key.startsWith('TrainingDummy'))
    ).toBe(false)
  })
})
