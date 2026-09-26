import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/loki/season-configs', () => ({
  getSeasonConfigIdForOffset: () => ({ id: 'cfg-current', seasonNumber: 104 }),
  getSeasonConfigById: () => ({
    id: 'cfg-current',
    bosses: [
      // Lore name differs from the raw type; set 1 -> M2 guards the set+1 conversion.
      { boss_type: 'SilentKing', set: 1, encounter_id: 0, rarity: 'Mythic' },
      { boss_type: 'Mortarion', set: 0, encounter_id: 2, rarity: 'Mythic' },
      // Same boss as L4 and M2 main; rarity_set keeps them distinct.
      { boss_type: 'Ghazghkull', set: 3, encounter_id: 0, rarity: 'Legendary' },
      { boss_type: 'Ghazghkull', set: 1, encounter_id: 0, rarity: 'Mythic' },
      { boss_type: 'Magnus', set: 2, encounter_id: 0, rarity: 'Mythic' },
      { boss_type: 'Zero', set: 0, encounter_id: 0, rarity: 'Mythic' },
      { boss_type: 'Ignored', set: 0, encounter_id: 0, rarity: 'Common' }
    ]
  })
}))

vi.mock('@/app/lib/data/boss-hp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/data/boss-hp')>()
  return {
    ...actual,
    getAllBossHp: async () => ({
      legendary: {},
      mythic: {},
      byBossName: {
        SilentKing_M2: 20_020_000,
        Ghazghkull_L4: 10_000_000,
        Ghazghkull_M2: 30_000_000,
        Magnus_M3: 30_000_000
      },
      primes: { Mortarion_prime2_M1: 5_000_000 }
    })
  }
})

import { loadPlaybookClearTargets } from '@/app/lib/briefing/load-playbook-clear-targets'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

type FakeRow = Record<string, string | number | boolean | null>
type FakeBuilder = {
  select: () => FakeBuilder
  eq: () => FakeBuilder
  in: () => FakeBuilder
  then: (resolve: (v: { data: FakeRow[]; error: null }) => void) => void
}
const asClient = (o: object): TypedSupabaseClient =>
  o as unknown as TypedSupabaseClient

function fakeSupabase(tables: Record<string, FakeRow[]>): TypedSupabaseClient {
  const make = (rows: FakeRow[]): FakeBuilder => {
    const b: FakeBuilder = {
      select: () => b,
      eq: () => b,
      in: () => b,
      then: (resolve) => resolve({ data: rows, error: null })
    }
    return b
  }
  return asClient({ from: (table: string) => make(tables[table] ?? []) })
}

const TARGET_ROWS: FakeRow[] = [
  {
    boss_name: 'SilentKing',
    rarity: 'Mythic',
    set: 2,
    target_tokens: 14,
    season_number: '104',
    encounter_id: 0
  },
  {
    boss_name: 'Mortarion',
    rarity: 'Mythic',
    set: 1,
    target_tokens: 5,
    season_number: '104',
    encounter_id: 2
  },
  {
    boss_name: 'Ghazghkull',
    rarity: 'Legendary',
    set: 4,
    target_tokens: 20,
    season_number: '104',
    encounter_id: 0
  },
  {
    boss_name: 'Ghazghkull',
    rarity: 'Mythic',
    set: 2,
    target_tokens: 15,
    season_number: '104',
    encounter_id: 0
  },
  {
    boss_name: 'Zero',
    rarity: 'Mythic',
    set: 1,
    target_tokens: 0,
    season_number: '104',
    encounter_id: 0
  }
]

const MAPPING_ROWS: FakeRow[] = [
  { boss_type: 'SilentKing', encounter_index: 0, boss_name: 'Szarekh' },
  { boss_type: 'Mortarion', encounter_index: 2, boss_name: 'Rotbone' }
]

function supa() {
  return fakeSupabase({
    boss_target_tokens: TARGET_ROWS,
    boss_mapping: MAPPING_ROWS
  })
}

describe('loadPlaybookClearTargets', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keys a MAIN on the raw slug + rarity_set (= get_player_boss_performance boss_name), NOT the lore name', async () => {
    const out = await loadPlaybookClearTargets(supa(), 'EOT', '104')
    const t = out.get('SilentKing::0::M2')
    expect(t).toBeDefined()
    expect(t!.bossHp).toBe(20_020_000)
    expect(t!.targetTokens).toBe(14)
    expect(t!.requiredDpt).toBeCloseTo(20_020_000 / 14, 6)
    expect(out.get('Szarekh::0::M2')).toBeUndefined()
  })

  it('keeps two same-name main tiers distinct by rarity_set (Ghazghkull L4 vs M2 — no collision)', async () => {
    const out = await loadPlaybookClearTargets(supa(), 'EOT', '104')
    const l4 = out.get('Ghazghkull::0::L4')
    const m2 = out.get('Ghazghkull::0::M2')
    expect(l4).toBeDefined()
    expect(m2).toBeDefined()
    expect(l4!.requiredDpt).toBeCloseTo(10_000_000 / 20, 6)
    expect(m2!.requiredDpt).toBeCloseTo(30_000_000 / 15, 6)
    expect(l4!.requiredDpt).not.toBeCloseTo(m2!.requiredDpt, 0)
  })

  it('resolves a prime via lookupPrimeBossHp + the prime’s own boss_mapping name', async () => {
    const out = await loadPlaybookClearTargets(supa(), 'EOT', '104')
    const p = out.get('Rotbone::2::M1')
    expect(p).toBeDefined()
    expect(p!.bossHp).toBe(5_000_000)
    expect(p!.requiredDpt).toBeCloseTo(5_000_000 / 5, 6)
    expect(out.get('Mortarion::2::M1')).toBeUndefined()
  })

  it('omits bosses with no officer target and target_tokens<=0', async () => {
    const out = await loadPlaybookClearTargets(supa(), 'EOT', '104')
    expect(out.get('Magnus::0::M3')).toBeUndefined()
    expect(out.get('Zero::0::M1')).toBeUndefined()
  })

  it('lets a season-specific officer skip SHADOW a legacy skip=false target', async () => {
    const out = await loadPlaybookClearTargets(
      fakeSupabase({
        boss_target_tokens: [
          {
            boss_name: 'SilentKing',
            rarity: 'Mythic',
            set: 2,
            target_tokens: 10,
            season_number: '',
            encounter_id: 0,
            skip: false,
            source: null,
            seeded_from_seasons: null
          },
          // Skipped this season: must suppress, not fall back to the legacy row.
          {
            boss_name: 'SilentKing',
            rarity: 'Mythic',
            set: 2,
            target_tokens: 12,
            season_number: '104',
            encounter_id: 0,
            skip: true,
            source: null,
            seeded_from_seasons: null
          }
        ],
        boss_mapping: MAPPING_ROWS
      }),
      'EOT',
      '104'
    )
    expect(out.get('SilentKing::0::M2')).toBeUndefined()
  })

  it('ignores the seeder NO-DATA sentinel: it neither feeds a target nor shadows a legacy one', async () => {
    const out = await loadPlaybookClearTargets(
      fakeSupabase({
        boss_target_tokens: [
          {
            boss_name: 'SilentKing',
            rarity: 'Mythic',
            set: 2,
            target_tokens: 10,
            season_number: '',
            encounter_id: 0,
            skip: false,
            source: null,
            seeded_from_seasons: null
          },
          {
            boss_name: 'SilentKing',
            rarity: 'Mythic',
            set: 2,
            target_tokens: 0,
            season_number: '104',
            encounter_id: 0,
            skip: true,
            source: 'historical_seed',
            seeded_from_seasons: 'none available (S90-S103)'
          }
        ],
        boss_mapping: MAPPING_ROWS
      }),
      'EOT',
      '104'
    )
    const t = out.get('SilentKing::0::M2')
    expect(t).toBeDefined()
    expect(t!.targetTokens).toBe(10)
  })

  it('falls back to the prime DISPLAY-name key for pre-WI-834 legacy rows (slug rows keep precedence)', async () => {
    const out = await loadPlaybookClearTargets(
      fakeSupabase({
        boss_target_tokens: [
          {
            boss_name: 'Rotbone',
            rarity: 'Mythic',
            set: 1,
            target_tokens: 4,
            season_number: '',
            encounter_id: 2,
            skip: false,
            source: null,
            seeded_from_seasons: null
          }
        ],
        boss_mapping: MAPPING_ROWS
      }),
      'EOT',
      '104'
    )
    const p = out.get('Rotbone::2::M1')
    expect(p).toBeDefined()
    expect(p!.targetTokens).toBe(4)
    expect(p!.requiredDpt).toBeCloseTo(5_000_000 / 4, 6)
  })

  it('returns an empty map on missing guild/season', async () => {
    expect((await loadPlaybookClearTargets(supa(), '', '104')).size).toBe(0)
    expect((await loadPlaybookClearTargets(supa(), 'EOT', '')).size).toBe(0)
  })

  it('is error-guarded — a throwing client yields an empty map, not a rejection', async () => {
    const boom = asClient({
      from() {
        throw new Error('db down')
      }
    })
    const out = await loadPlaybookClearTargets(boom, 'EOT', '104')
    expect(out.size).toBe(0)
  })
})
