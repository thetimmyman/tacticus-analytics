import { describe, it, expect, vi } from 'vitest'
import {
  detectDefeatTransitions,
  detectAvailabilityTransitions,
  postHeraldEvent,
  postHeraldAvailabilityEvent,
  postHeraldBombRangeEvent,
  postHeraldTestMessage,
  runHeraldForSync,
  __testing,
  type HeraldBattle,
  type AvailabilityTransition,
  type BombRangeTransition,
  type HeraldBossConfigRow
} from '@/app/lib/herald/engine'
import { postToWebhook } from '@/app/lib/discord/webhook-service'

vi.mock('@/app/lib/discord/webhook-service', () => ({
  postToWebhook: vi.fn(async () => ({
    ok: true,
    status: 204,
    attempts: 1
  })),
  logDiscordWebhookDelivery: vi.fn(async () => undefined)
}))

const logSpies = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))
vi.mock('@/app/lib/logging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/logging')>()
  return { ...actual, createComponentLogger: () => logSpies }
})

const NOW_MS = 1_700_000_000_000

const kill = (overrides: Partial<HeraldBattle> = {}): HeraldBattle => ({
  type: 'Ghazghkull',
  encounterIndex: 0,
  completedOn: NOW_MS - 60_000,
  remainingHp: 0,
  rarity: 'Legendary',
  userId: 'u1',
  displayName: 'Roy',
  tier: 5,
  set: 2,
  Season: 42,
  ...overrides
})

const bossConfig = (
  overrides: Partial<HeraldBossConfigRow> = {}
): HeraldBossConfigRow => ({
  boss_id: 'Ghazghkull_E0',
  rarity_set: null,
  enabled: true,
  webhook_config_ids: [],
  discord_role_ids: [],
  discord_role_labels: {},
  extra_links: [],
  extra_videos: [],
  custom_message_url: null,
  notes: null,
  side1_notes: null,
  side2_notes: null,
  side1_behaviour: 'kill',
  side2_behaviour: 'kill',
  side1_threshold_hp_pct: null,
  side2_threshold_hp_pct: null,
  ping_mode: 'per_side',
  ping_mode_explicit: false,
  ...overrides
})

describe('detectDefeatTransitions', () => {
  it('returns empty array when no battles have remainingHp 0', () => {
    const battles: HeraldBattle[] = [
      { ...kill({ remainingHp: 1000 }) },
      { ...kill({ remainingHp: 50 }) }
    ]
    expect(detectDefeatTransitions(battles, { nowMs: NOW_MS })).toEqual([])
  })

  it('detects a single Legendary kill', () => {
    const result = detectDefeatTransitions([kill()], { nowMs: NOW_MS })
    expect(result).toHaveLength(1)
    expect(result[0].boss_type).toBe('Ghazghkull')
    expect(result[0].rarity).toBe('Legendary')
    expect(result[0].killer_display_name).toBe('Roy')
    expect(result[0].completed_on).toBe(NOW_MS - 60_000)
    expect(result[0].boss_id).toBe('Ghazghkull_E0')
  })

  it('filters out sub-Legendary kills under default rarity filter', () => {
    const battles = [
      kill({ rarity: 'Epic' }),
      kill({ rarity: 'Rare', type: 'SomeOtherBoss' })
    ]
    expect(detectDefeatTransitions(battles, { nowMs: NOW_MS })).toEqual([])
  })

  it('detects Mythic kills under default rarity filter', () => {
    const result = detectDefeatTransitions(
      [kill({ rarity: 'Mythic', type: 'Mortarion' })],
      { nowMs: NOW_MS }
    )
    expect(result).toHaveLength(1)
    expect(result[0].rarity).toBe('Mythic')
    expect(result[0].boss_type).toBe('Mortarion')
  })

  it('honors a custom rarityFilter', () => {
    const battles = [
      kill({ rarity: 'Epic', type: 'EpicBoss' }),
      kill({ rarity: 'Rare', type: 'RareBoss' })
    ]
    const result = detectDefeatTransitions(battles, {
      nowMs: NOW_MS,
      rarityFilter: ['Epic', 'Rare']
    })
    expect(result).toHaveLength(2)
  })

  it('skips kills older than the 15-minute recency window', () => {
    const stale = kill({ completedOn: NOW_MS - 20 * 60 * 1000 })
    expect(detectDefeatTransitions([stale], { nowMs: NOW_MS })).toEqual([])
  })

  it('accepts kills exactly at the 15-minute recency boundary', () => {
    const atBoundary = kill({ completedOn: NOW_MS - 15 * 60 * 1000 })
    const result = detectDefeatTransitions([atBoundary], { nowMs: NOW_MS })
    expect(result).toHaveLength(1)
  })

  it('rejects kills 1ms past the 15-minute recency boundary', () => {
    const pastBoundary = kill({ completedOn: NOW_MS - 15 * 60 * 1000 - 1 })
    const result = detectDefeatTransitions([pastBoundary], { nowMs: NOW_MS })
    expect(result).toHaveLength(0)
  })

  it('skips kills with timestamps absurdly in the future', () => {
    const future = kill({ completedOn: NOW_MS + 5 * 60 * 1000 })
    expect(detectDefeatTransitions([future], { nowMs: NOW_MS })).toEqual([])
  })

  it('normalizes second-precision completedOn to milliseconds', () => {
    const secs = Math.floor((NOW_MS - 60_000) / 1000)
    const result = detectDefeatTransitions([kill({ completedOn: secs })], {
      nowMs: NOW_MS
    })
    expect(result).toHaveLength(1)
    expect(result[0].completed_on).toBe(secs * 1000)
  })

  it('deduplicates identical (boss, completedOn) entries from the raw payload', () => {
    const k = kill()
    const result = detectDefeatTransitions([k, { ...k }], { nowMs: NOW_MS })
    expect(result).toHaveLength(1)
  })

  it('treats different encounterIndex values as distinct bosses', () => {
    const battles = [
      kill({ encounterIndex: 0, completedOn: NOW_MS - 120_000 }),
      kill({ encounterIndex: 1, completedOn: NOW_MS - 60_000 })
    ]
    const result = detectDefeatTransitions(battles, { nowMs: NOW_MS })
    expect(result).toHaveLength(2)
    expect(result[0].boss_id).toBe('Ghazghkull_E0')
    expect(result[1].boss_id).toBe('Ghazghkull_E1')
  })

  it('fires a prime threshold transition exactly once before HP reaches zero', () => {
    const battles = [
      kill({
        encounterIndex: 1,
        remainingHp: 500,
        maxHp: 1000,
        set: 4,
        completedOn: NOW_MS - 120_000
      }),
      kill({
        encounterIndex: 1,
        remainingHp: 0,
        maxHp: 1000,
        set: 4,
        completedOn: NOW_MS - 60_000
      })
    ]
    const result = detectDefeatTransitions(battles, {
      nowMs: NOW_MS,
      killThresholdMap: new Map([['42|L5|1', 60]])
    })
    expect(result).toHaveLength(1)
    expect(result[0].boss_id).toBe('Ghazghkull_E1')
    expect(result[0].completed_on).toBe(NOW_MS - 120_000)
  })

  it('does not fire a configured threshold while the prime remains above it', () => {
    const result = detectDefeatTransitions(
      [
        kill({
          encounterIndex: 2,
          remainingHp: 700,
          maxHp: 1000,
          set: 4
        })
      ],
      {
        nowMs: NOW_MS,
        killThresholdMap: new Map([['42|L5|2', 60]])
      }
    )
    expect(result).toEqual([])
  })

  it('does not borrow the threshold from the tier below a displayed L5 prime', () => {
    const result = detectDefeatTransitions(
      [
        kill({
          encounterIndex: 2,
          remainingHp: 100,
          maxHp: 1000,
          set: 4
        })
      ],
      {
        nowMs: NOW_MS,
        killThresholdMap: new Map([['42|L4|2', 20]])
      }
    )
    expect(result).toEqual([])
  })

  it('sorts transitions by completed_on ascending', () => {
    const battles = [
      kill({ type: 'BossA', completedOn: NOW_MS - 60_000 }),
      kill({ type: 'BossB', completedOn: NOW_MS - 180_000 }),
      kill({ type: 'BossC', completedOn: NOW_MS - 120_000 })
    ]
    const result = detectDefeatTransitions(battles, { nowMs: NOW_MS })
    expect(result.map((t) => t.boss_type)).toEqual(['BossB', 'BossC', 'BossA'])
  })

  it('skips entries missing required fields', () => {
    const battles = [kill({ type: null }), kill({ completedOn: null })]
    expect(detectDefeatTransitions(battles, { nowMs: NOW_MS })).toEqual([])
  })

  it('does not skip entries with remainingHp === 0 when rarity case-mismatches', () => {
    const battles = [kill({ rarity: 'legendary' })]
    const result = detectDefeatTransitions(battles, { nowMs: NOW_MS })
    expect(result).toHaveLength(1)
  })

  it('ignores battles with null encounterIndex gracefully', () => {
    const result = detectDefeatTransitions([kill({ encounterIndex: null })], {
      nowMs: NOW_MS
    })
    expect(result).toHaveLength(1)
    expect(result[0].boss_id).toBe('Ghazghkull')
  })
})

describe('formatDefeatMessage', () => {
  it('renders a complete defeat message with killer and stage code', () => {
    const [transition] = detectDefeatTransitions([kill()], { nowMs: NOW_MS })
    const msg = __testing.formatDefeatMessage(transition)
    expect(msg).toContain('Ghazghkull')
    expect(msg).toContain('has been defeated')
    expect(msg).toContain('Roy')
    expect(msg).toContain('L3')
    expect(msg).not.toContain('Set 2')
    expect(msg).not.toContain('5⃣')
    expect(msg.split('\n')).toHaveLength(2)
  })

  it('omits the slain-by line when killer info is missing', () => {
    const [transition] = detectDefeatTransitions(
      [kill({ displayName: null, tier: null, set: null })],
      { nowMs: NOW_MS }
    )
    const msg = __testing.formatDefeatMessage(transition)
    expect(msg.split('\n')).toHaveLength(1)
    expect(msg).not.toContain('Slain by')
  })
})

describe('per-boss prime ping mode', () => {
  const sameStagePrimeTransitions = () =>
    detectDefeatTransitions(
      [
        kill({
          encounterIndex: 1,
          type: 'Ghazghkull',
          set: 1,
          completedOn: NOW_MS - 50_000
        }),
        kill({
          encounterIndex: 2,
          type: 'Ghazghkull',
          set: 1,
          completedOn: NOW_MS - 40_000
        })
      ],
      { nowMs: NOW_MS }
    )

  it('uses the main boss row as the group ping-mode fallback for primes', () => {
    const lookup = {
      size: 1,
      rows: [],
      resolve: (bossId: string) =>
        bossId === 'Ghazghkull_E0'
          ? bossConfig({
              boss_id: 'Ghazghkull_E0',
              ping_mode: 'combined',
              ping_mode_explicit: true
            })
          : null
    }
    const mode = __testing.resolveDefeatPingMode(
      lookup,
      sameStagePrimeTransitions()[0]
    )
    expect(mode).toBe('combined')
  })

  it('does not let legacy default per_side rows override the guild-global setting', () => {
    const lookup = {
      size: 1,
      rows: [],
      resolve: () =>
        bossConfig({
          ping_mode: 'per_side',
          ping_mode_explicit: false
        })
    }
    const mode = __testing.resolveDefeatPingMode(
      lookup,
      sameStagePrimeTransitions()[0]
    )
    expect(mode).toBeNull()
  })

  it('collapses same-stage prime defeats when per-boss mode is combined', () => {
    const transitions = sameStagePrimeTransitions()
    const lookup = {
      size: 1,
      rows: [],
      resolve: () =>
        bossConfig({
          ping_mode: 'combined',
          ping_mode_explicit: true
        })
    }
    const collapsed = __testing.collapseCombinedPrimeDefeats(
      transitions,
      (transition) =>
        __testing.resolveDefeatPingMode(lookup, transition) === 'combined'
    )
    expect(collapsed.dispatched).toHaveLength(1)
    expect(collapsed.consumed).toHaveLength(1)
    expect(collapsed.dispatched[0].boss_display_name).toContain(' & ')
  })

  it('keeps same-stage prime defeats independent when per-boss mode is per_side', () => {
    const transitions = sameStagePrimeTransitions()
    const lookup = {
      size: 1,
      rows: [],
      resolve: () =>
        bossConfig({
          ping_mode: 'per_side',
          ping_mode_explicit: true
        })
    }
    const collapsed = __testing.collapseCombinedPrimeDefeats(
      transitions,
      (transition) =>
        __testing.resolveDefeatPingMode(lookup, transition) === 'combined'
    )
    expect(collapsed.dispatched).toHaveLength(2)
    expect(collapsed.consumed).toHaveLength(0)
  })
})

// Same-stage prime availability transitions collapse into one post ("A & B").
describe('collapseCombinedPrimeAvailabilities', () => {
  const availability = (
    overrides: Partial<{
      boss_type: string
      boss_id: string
      boss_display_name: string
      rarity: string
      set: number
      encounter_index: number
      season: number
      loop_index: number
      tier: number | null
    }> = {}
  ) => ({
    boss_id: overrides.boss_id ?? 'Death_E1',
    boss_type: overrides.boss_type ?? 'Death',
    boss_display_name: overrides.boss_display_name ?? 'Rotbone',
    rarity: overrides.rarity ?? 'Mythic',
    tier: overrides.tier ?? 2,
    set: overrides.set ?? 1,
    encounter_index: overrides.encounter_index ?? 1,
    season: overrides.season ?? 99,
    loop_index: overrides.loop_index ?? 0
  })

  it('collapses same-stage E1 + E2 into one dispatched + one consumed', () => {
    const collapsed = __testing.collapseCombinedPrimeAvailabilities(
      [
        availability({
          boss_id: 'Death_E1',
          boss_display_name: 'Rotbone',
          encounter_index: 1
        }),
        availability({
          boss_id: 'Death_E2',
          boss_display_name: 'Corrodius',
          encounter_index: 2
        })
      ],
      () => true
    )
    expect(collapsed.dispatched).toHaveLength(1)
    expect(collapsed.consumed).toHaveLength(1)
    expect(collapsed.dispatched[0]?.boss_display_name).toBe(
      'Rotbone & Corrodius'
    )
    expect(collapsed.dispatched[0]?.boss_id).toBe('Death_E1')
    expect(collapsed.consumed[0]?.boss_id).toBe('Death_E2')
    const partner = collapsed.partnerByDispatchedBossId.get('Death_E1')
    expect(partner?.boss_id).toBe('Death_E2')
  })

  it('keeps independent when combine decision returns false', () => {
    const collapsed = __testing.collapseCombinedPrimeAvailabilities(
      [
        availability({ boss_id: 'Death_E1', encounter_index: 1 }),
        availability({
          boss_id: 'Death_E2',
          boss_display_name: 'Corrodius',
          encounter_index: 2
        })
      ],
      () => false
    )
    expect(collapsed.dispatched).toHaveLength(2)
    expect(collapsed.consumed).toHaveLength(0)
    expect(collapsed.partnerByDispatchedBossId.size).toBe(0)
  })

  it('does not pair primes from different stages (different set)', () => {
    const collapsed = __testing.collapseCombinedPrimeAvailabilities(
      [
        availability({ boss_id: 'Death_E1', encounter_index: 1, set: 0 }),
        availability({
          boss_id: 'Death_E2',
          boss_display_name: 'Corrodius',
          encounter_index: 2,
          set: 1
        })
      ],
      () => true
    )
    expect(collapsed.dispatched).toHaveLength(2)
    expect(collapsed.consumed).toHaveLength(0)
  })

  it('does not pair when both encounter_index are the same prime slot', () => {
    const collapsed = __testing.collapseCombinedPrimeAvailabilities(
      [
        availability({ boss_id: 'Death_E1', encounter_index: 1 }),
        availability({
          boss_id: 'Other_E1',
          boss_type: 'Other',
          encounter_index: 1
        })
      ],
      () => true
    )
    expect(collapsed.dispatched).toHaveLength(2)
    expect(collapsed.consumed).toHaveLength(0)
  })

  it('orders combined name by encounter_index even when E2 appears first', () => {
    const collapsed = __testing.collapseCombinedPrimeAvailabilities(
      [
        availability({
          boss_id: 'Death_E2',
          boss_display_name: 'Corrodius',
          encounter_index: 2
        }),
        availability({
          boss_id: 'Death_E1',
          boss_display_name: 'Rotbone',
          encounter_index: 1
        })
      ],
      () => true
    )
    expect(collapsed.dispatched).toHaveLength(1)
    expect(collapsed.dispatched[0]?.boss_display_name).toBe(
      'Rotbone & Corrodius'
    )
  })
})

describe('mergeCombinedPrimeNotes', () => {
  it('renders shared combined-prime notes as one note body', () => {
    expect(
      __testing.mergeCombinedPrimeNotes(
        'Hold ShoSyl until Riptide opens.',
        1,
        'Hold ShoSyl until Riptide opens.',
        2
      )
    ).toBe('Hold ShoSyl until Riptide opens.')
  })

  it('keeps legacy divergent prime notes labelled by side', () => {
    expect(
      __testing.mergeCombinedPrimeNotes('Left plan', 2, 'Right plan', 1)
    ).toBe('**Side 1:** Right plan\n\n**Side 2:** Left plan')
  })

  it('uses the one populated note when the sibling side is blank', () => {
    expect(__testing.mergeCombinedPrimeNotes('', 1, 'Only side note', 2)).toBe(
      'Only side note'
    )
  })
})

describe('filterRoleIdsForBoss', () => {
  const bossA = 'Ghazghkull_E0'
  const bossB = 'Belisarius_E0'

  it('includes mappings with null active_boss_ids (all-bosses default)', () => {
    const result = __testing.filterRoleIdsForBoss(
      [{ discord_role_id: '111111111111111111', active_boss_ids: null }],
      bossA
    )
    expect(result).toEqual(['111111111111111111'])
  })

  it('excludes mappings with empty active_boss_ids', () => {
    const result = __testing.filterRoleIdsForBoss(
      [{ discord_role_id: '111111111111111111', active_boss_ids: [] }],
      bossA
    )
    expect(result).toEqual([])
  })

  it('includes mappings whose active_boss_ids contains the target boss', () => {
    const result = __testing.filterRoleIdsForBoss(
      [
        {
          discord_role_id: '111111111111111111',
          active_boss_ids: [bossA, bossB]
        },
        { discord_role_id: '222222222222222222', active_boss_ids: [bossB] }
      ],
      bossA
    )
    expect(result).toEqual(['111111111111111111'])
  })

  it('mixes null-scope and specific-scope mappings correctly', () => {
    const result = __testing.filterRoleIdsForBoss(
      [
        { discord_role_id: '111111111111111111', active_boss_ids: null }, // all
        { discord_role_id: '222222222222222222', active_boss_ids: [bossB] }, // other boss
        { discord_role_id: '333333333333333333', active_boss_ids: [bossA] } // this boss
      ],
      bossA
    )
    expect(result).toEqual(['111111111111111111', '333333333333333333'])
  })

  it('deduplicates identical role IDs across multiple mappings', () => {
    const result = __testing.filterRoleIdsForBoss(
      [
        { discord_role_id: '111111111111111111', active_boss_ids: null },
        { discord_role_id: '111111111111111111', active_boss_ids: [bossA] }
      ],
      bossA
    )
    expect(result).toEqual(['111111111111111111'])
  })

  it('returns empty array when no mappings match', () => {
    const result = __testing.filterRoleIdsForBoss(
      [{ discord_role_id: '111111111111111111', active_boss_ids: [bossB] }],
      bossA
    )
    expect(result).toEqual([])
  })

  describe('per-stage rarity_set fallback', () => {
    it('uses the catch-all (rarity_set IS NULL) row when no per-stage row exists', () => {
      const result = __testing.filterRoleIdsForBoss(
        [
          {
            discord_role_id: '111111111111111111',
            active_boss_ids: null,
            meta_team_slug: 'admech',
            rarity_set: null
          }
        ],
        bossA,
        'L4'
      )
      expect(result).toEqual(['111111111111111111'])
    })

    it('per-stage row beats catch-all for the same meta_team_slug', () => {
      const result = __testing.filterRoleIdsForBoss(
        [
          {
            discord_role_id: '111111111111111111',
            active_boss_ids: null,
            meta_team_slug: 'admech',
            rarity_set: null
          },
          {
            discord_role_id: '222222222222222222',
            active_boss_ids: null,
            meta_team_slug: 'admech',
            rarity_set: 'L4'
          }
        ],
        bossA,
        'L4'
      )
      expect(result).toEqual(['222222222222222222'])
    })

    it('per-stage row for a DIFFERENT stage does not shadow the catch-all', () => {
      const result = __testing.filterRoleIdsForBoss(
        [
          {
            discord_role_id: '111111111111111111',
            active_boss_ids: null,
            meta_team_slug: 'admech',
            rarity_set: null
          },
          {
            discord_role_id: '222222222222222222',
            active_boss_ids: null,
            meta_team_slug: 'admech',
            rarity_set: 'M2'
          }
        ],
        bossA,
        'L4'
      )
      expect(result).toEqual(['111111111111111111'])
    })

    it('precedence is per meta_team_slug — different slugs resolve independently', () => {
      const result = __testing.filterRoleIdsForBoss(
        [
          {
            discord_role_id: '111111111111111111',
            active_boss_ids: null,
            meta_team_slug: 'admech',
            rarity_set: null
          },
          {
            discord_role_id: '222222222222222222',
            active_boss_ids: null,
            meta_team_slug: 'custodes',
            rarity_set: 'L4'
          }
        ],
        bossA,
        'L4'
      )
      expect(result.sort()).toEqual(
        ['111111111111111111', '222222222222222222'].sort()
      )
    })

    it('per-stage row still honors active_boss_ids filter', () => {
      const result = __testing.filterRoleIdsForBoss(
        [
          {
            discord_role_id: '111111111111111111',
            active_boss_ids: [bossB],
            meta_team_slug: 'admech',
            rarity_set: 'L4'
          }
        ],
        bossA,
        'L4'
      )
      expect(result).toEqual([])
    })
  })
})

describe('sanitizeRoleId', () => {
  it('accepts valid 17-20 digit snowflakes', () => {
    expect(__testing.sanitizeRoleId('12345678901234567')).toBe(
      '12345678901234567'
    ) // 17
    expect(__testing.sanitizeRoleId('123456789012345678')).toBe(
      '123456789012345678'
    ) // 18
    expect(__testing.sanitizeRoleId('12345678901234567890')).toBe(
      '12345678901234567890'
    ) // 20
  })

  it('trims surrounding whitespace', () => {
    expect(__testing.sanitizeRoleId('  123456789012345678  ')).toBe(
      '123456789012345678'
    )
  })

  it('rejects non-numeric inputs', () => {
    expect(__testing.sanitizeRoleId('<@&123456789012345678>')).toBeNull()
    expect(__testing.sanitizeRoleId('abcdefghijklmnopq')).toBeNull()
    expect(__testing.sanitizeRoleId('123-456-789-012-345')).toBeNull()
  })

  it('rejects too-short or too-long strings', () => {
    expect(__testing.sanitizeRoleId('1234567890123456')).toBeNull() // 16
    expect(__testing.sanitizeRoleId('123456789012345678901')).toBeNull() // 21
    expect(__testing.sanitizeRoleId('')).toBeNull()
  })

  it('rejects non-string inputs', () => {
    expect(__testing.sanitizeRoleId(123456789012345678)).toBeNull()
    expect(__testing.sanitizeRoleId(null)).toBeNull()
    expect(__testing.sanitizeRoleId(undefined)).toBeNull()
    expect(__testing.sanitizeRoleId({})).toBeNull()
  })
})

describe('prependRolePings', () => {
  it('returns content unchanged when no role IDs are given', () => {
    expect(__testing.prependRolePings([], 'Boss defeated')).toBe(
      'Boss defeated'
    )
  })

  it('prepends a single role mention on a new line', () => {
    const result = __testing.prependRolePings(
      ['123456789012345678'],
      'Boss defeated'
    )
    expect(result).toBe('<@&123456789012345678>\nBoss defeated')
  })

  it('joins multiple role mentions with spaces', () => {
    const result = __testing.prependRolePings(
      ['111111111111111111', '222222222222222222'],
      'Boss defeated'
    )
    expect(result).toBe(
      '<@&111111111111111111> <@&222222222222222222>\nBoss defeated'
    )
  })

  it('preserves newlines in the original content', () => {
    const result = __testing.prependRolePings(
      ['123456789012345678'],
      'Line 1\nLine 2'
    )
    expect(result).toBe('<@&123456789012345678>\nLine 1\nLine 2')
  })
})

describe('appendRolePings', () => {
  it('returns the preview line unchanged when no role IDs are given', () => {
    expect(__testing.appendRolePings([], 'Boss is now available!')).toBe(
      'Boss is now available!'
    )
  })

  it('appends a single role mention on a new line below the preview', () => {
    const result = __testing.appendRolePings(
      ['123456789012345678'],
      '🎖️ Lasher is now available!'
    )
    expect(result).toBe('🎖️ Lasher is now available!\n<@&123456789012345678>')
  })

  it('joins multiple role mentions with spaces on the trailing line', () => {
    const result = __testing.appendRolePings(
      ['111111111111111111', '222222222222222222'],
      'Preview'
    )
    expect(result).toBe(
      'Preview\n<@&111111111111111111> <@&222222222222222222>'
    )
  })

  it('uses the explicit role-ping text when provided (text mention mode)', () => {
    const result = __testing.appendRolePings(
      ['123456789012345678'],
      '🎖️ Lasher is now available!',
      '@Alpha Legion'
    )
    expect(result).toBe('🎖️ Lasher is now available!\n@Alpha Legion')
  })

  it('returns only the mention when the preview line is empty', () => {
    const result = __testing.appendRolePings(['123456789012345678'], '')
    expect(result).toBe('<@&123456789012345678>')
  })
})

describe('normalizeCompletedOn', () => {
  it('leaves ms-scale values unchanged', () => {
    expect(__testing.normalizeCompletedOn(1_700_000_000_000)).toBe(
      1_700_000_000_000
    )
  })

  it('multiplies s-scale values by 1000', () => {
    expect(__testing.normalizeCompletedOn(1_700_000_000)).toBe(
      1_700_000_000_000
    )
  })
})

describe('postHeraldEvent', () => {
  const transition = detectDefeatTransitions([kill()], { nowMs: NOW_MS })[0]
  const singleChannel = [
    { webhookId: null, webhookUrl: 'https://discord.com/api/webhooks/1/token' }
  ]

  const makeSupabaseMock = (overrides: {
    insertResult?: {
      data: Record<string, unknown> | null
      error: { code: string; message: string } | null
    }
    updateResult?: { error: { message: string } | null }
  }) => {
    const insertResult = overrides.insertResult ?? {
      data: { id: 123 },
      error: null
    }
    const updateResult = overrides.updateResult ?? { error: null }

    const updateChain = {
      eq: vi.fn().mockResolvedValue(updateResult)
    }
    const insertChain = {
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(insertResult)
    }
    const deleteEq = vi.fn().mockResolvedValue({ error: null })
    const deleteChain = { eq: deleteEq }
    const fromMock = vi.fn((table: string) => {
      if (table !== 'herald_posted_events') {
        throw new Error(`unexpected table: ${table}`)
      }
      return {
        insert: vi.fn().mockReturnValue(insertChain),
        update: vi.fn().mockReturnValue(updateChain),
        delete: vi.fn().mockReturnValue(deleteChain)
      }
    })
    const supabase = { from: fromMock } as unknown as Parameters<
      typeof postHeraldEvent
    >[0]['supabase']
    return { supabase, deleteEq }
  }

  it('posts a message and returns outcome=posted on successful insert', async () => {
    const { supabase } = makeSupabaseMock({})
    const result = await postHeraldEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition,
      invocationId: 'inv-1',
      channels: singleChannel
    })
    expect(result.outcome).toBe('posted')
    if (result.outcome === 'posted') {
      expect(result.status).toBe(204)
      expect(result.postedChannels).toBe(1)
      expect(result.failedChannels).toBe(0)
    }
  })

  it('returns outcome=dedup when INSERT raises 23505 unique violation', async () => {
    const { supabase } = makeSupabaseMock({
      insertResult: {
        data: null,
        error: { code: '23505', message: 'duplicate key value' }
      }
    })
    const result = await postHeraldEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition,
      invocationId: 'inv-2',
      channels: singleChannel
    })
    expect(result.outcome).toBe('dedup')
  })

  it('returns outcome=dedup when INSERT returns null row (no error, no data)', async () => {
    const { supabase } = makeSupabaseMock({
      insertResult: { data: null, error: null }
    })
    const result = await postHeraldEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition,
      invocationId: 'inv-3',
      channels: singleChannel
    })
    expect(result.outcome).toBe('dedup')
  })

  it('returns outcome=failed when INSERT errors with a non-conflict code', async () => {
    const { supabase } = makeSupabaseMock({
      insertResult: {
        data: null,
        error: { code: '42P01', message: 'relation does not exist' }
      }
    })
    const result = await postHeraldEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition,
      invocationId: 'inv-4',
      channels: singleChannel
    })
    expect(result.outcome).toBe('failed')
  })

  it('still returns outcome=posted when the status-writeback UPDATE fails', async () => {
    const { supabase } = makeSupabaseMock({
      updateResult: { error: { message: 'transient db error' } }
    })
    const result = await postHeraldEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition,
      invocationId: 'inv-5',
      channels: singleChannel
    })
    expect(result.outcome).toBe('posted')
  })

  it('returns outcome=skipped when channels list is empty', async () => {
    const { supabase } = makeSupabaseMock({})
    const result = await postHeraldEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition,
      invocationId: 'inv-6',
      channels: []
    })
    expect(result.outcome).toBe('skipped')
  })

  it('deletes the claimed dedup row when ALL channels fail so the next sync retries', async () => {
    const { supabase, deleteEq } = makeSupabaseMock({})
    vi.mocked(postToWebhook).mockResolvedValueOnce({
      ok: false,
      status: 500,
      attempts: 3,
      error: { type: 'server_error', message: 'Discord 500' }
    })
    const result = await postHeraldEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition,
      invocationId: 'inv-7',
      channels: singleChannel
    })
    expect(result.outcome).toBe('failed')
    expect(deleteEq).toHaveBeenCalledWith('id', 123)
  })

  it('deletes the claimed dedup row when postToWebhook THROWS for every channel', async () => {
    const { supabase, deleteEq } = makeSupabaseMock({})
    vi.mocked(postToWebhook).mockRejectedValueOnce(
      new Error('Discord webhook failed: network error')
    )
    const result = await postHeraldEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition,
      invocationId: 'inv-8',
      channels: singleChannel
    })
    expect(result.outcome).toBe('failed')
    expect(deleteEq).toHaveBeenCalledWith('id', 123)
  })

  it('keeps the dedup claim on PARTIAL fanout failure (no duplicate on the successful channel)', async () => {
    const { supabase, deleteEq } = makeSupabaseMock({})
    const twoChannels = [
      {
        webhookId: 'wh-1',
        webhookUrl: 'https://discord.com/api/webhooks/1/token'
      },
      {
        webhookId: 'wh-2',
        webhookUrl: 'https://discord.com/api/webhooks/2/token'
      }
    ]
    vi.mocked(postToWebhook).mockResolvedValueOnce({
      ok: false,
      status: 500,
      attempts: 3,
      error: { type: 'server_error', message: 'Discord 500' }
    })
    const result = await postHeraldEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition,
      invocationId: 'inv-9',
      channels: twoChannels
    })
    expect(result.outcome).toBe('posted')
    if (result.outcome === 'posted') {
      expect(result.postedChannels).toBe(1)
      expect(result.failedChannels).toBe(1)
    }
    expect(deleteEq).not.toHaveBeenCalled()
  })

  it('does not touch the dedup row on full success', async () => {
    const { supabase, deleteEq } = makeSupabaseMock({})
    const result = await postHeraldEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition,
      invocationId: 'inv-10',
      channels: singleChannel
    })
    expect(result.outcome).toBe('posted')
    expect(deleteEq).not.toHaveBeenCalled()
  })
})

describe('postHeraldAvailabilityEvent — snapshot-claim rollback', () => {
  const availabilityTransition: AvailabilityTransition = {
    boss_id: 'Ghazghkull_E0',
    boss_type: 'Ghazghkull',
    boss_display_name: 'Ghazghkull',
    rarity: 'Legendary',
    tier: 5,
    set: 2,
    encounter_index: 0,
    season: 42,
    loop_index: 0
  }
  const singleChannel = [
    {
      webhookId: 'wh-a',
      webhookUrl: 'https://discord.com/api/webhooks/1/token'
    }
  ]

  const makeAvailabilitySupabaseMock = () => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null })
    const snapshotInsertChain = {
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'snap-1', first_seen_at: null },
        error: null
      })
    }
    const fromMock = vi.fn((table: string) => {
      if (table === 'herald_boss_availability') {
        return {
          insert: vi.fn().mockReturnValue(snapshotInsertChain),
          delete: vi.fn().mockReturnValue({ eq: deleteEq })
        }
      }
      if (table === 'herald_posted_events') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<
      typeof postHeraldAvailabilityEvent
    >[0]['supabase']
    return { supabase, deleteEq }
  }

  it('deletes the claimed snapshot row when ALL channels fail so the next sync retries', async () => {
    const { supabase, deleteEq } = makeAvailabilitySupabaseMock()
    vi.mocked(postToWebhook).mockResolvedValueOnce({
      ok: false,
      status: 500,
      attempts: 3,
      error: { type: 'server_error', message: 'Discord 500' }
    })
    const result = await postHeraldAvailabilityEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition: availabilityTransition,
      invocationId: 'inv-av-1',
      channels: singleChannel
    })
    expect(result.outcome).toBe('failed')
    expect(deleteEq).toHaveBeenCalledWith('id', 'snap-1')
  })

  it('skips a setless transition without claiming or posting (set_num is NOT NULL)', async () => {
    const { supabase } = makeAvailabilitySupabaseMock()
    vi.mocked(postToWebhook).mockClear()
    const result = await postHeraldAvailabilityEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition: { ...availabilityTransition, set: null },
      invocationId: 'inv-av-noset',
      channels: singleChannel
    })
    expect(result).toEqual({ outcome: 'skipped', reason: 'no_set' })
    expect(supabase.from).not.toHaveBeenCalled()
    expect(postToWebhook).not.toHaveBeenCalled()
  })

  it('keeps the snapshot claim on success', async () => {
    const { supabase, deleteEq } = makeAvailabilitySupabaseMock()
    const result = await postHeraldAvailabilityEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition: availabilityTransition,
      invocationId: 'inv-av-2',
      channels: singleChannel
    })
    expect(result.outcome).toBe('posted')
    expect(deleteEq).not.toHaveBeenCalled()
  })

  it('renders multiple text-mode role labels without allowing real mentions', async () => {
    vi.mocked(postToWebhook).mockClear()
    const { supabase } = makeAvailabilitySupabaseMock()
    const result = await postHeraldAvailabilityEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition: availabilityTransition,
      invocationId: 'inv-av-text-labels',
      channels: singleChannel,
      roleIds: ['111111111111111111', '222222222222222222'],
      bossConfig: bossConfig({
        discord_role_ids: ['111111111111111111', '222222222222222222'],
        discord_role_labels: {
          '111111111111111111': 'Per Boss Main',
          '222222222222222222': 'Per Boss Flex'
        }
      }),
      mentionRolesAsText: true,
      roleLabels: new Map([['111111111111111111', 'Stale Mapping Label']])
    })

    expect(result.outcome).toBe('posted')
    const payload = vi.mocked(postToWebhook).mock.calls[0]?.[1]
    expect(payload?.content).toContain('@Per Boss Main @Per Boss Flex')
    expect(payload?.content).not.toContain('Stale Mapping Label')
    expect(payload?.allowed_mentions).toEqual({ parse: [] })
  })

  it('does not apply stale per-boss labels when roles come from guild mappings', async () => {
    vi.mocked(postToWebhook).mockClear()
    const { supabase } = makeAvailabilitySupabaseMock()
    const result = await postHeraldAvailabilityEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition: availabilityTransition,
      invocationId: 'inv-av-text-fallback-labels',
      channels: singleChannel,
      roleIds: ['111111111111111111'],
      bossConfig: bossConfig({
        discord_role_ids: [],
        discord_role_labels: {
          '111111111111111111': 'Stale Per Boss Label'
        }
      }),
      mentionRolesAsText: true,
      roleLabels: new Map([['111111111111111111', 'Active Mapping Label']])
    })

    expect(result.outcome).toBe('posted')
    const payload = vi.mocked(postToWebhook).mock.calls[0]?.[1]
    expect(payload?.content).toContain('@Active Mapping Label')
    expect(payload?.content).not.toContain('Stale Per Boss Label')
    expect(payload?.allowed_mentions).toEqual({ parse: [] })
  })
})

describe('postHeraldBombRangeEvent — dedup-claim rollback', () => {
  const bombTransition: BombRangeTransition = {
    boss_id: 'Ghazghkull_E0',
    boss_type: 'Ghazghkull',
    boss_display_name: 'Ghazghkull',
    rarity: 'Legendary',
    tier: 5,
    set: 2,
    encounter_index: 0,
    season: 42,
    loop_index: 0,
    remaining_hp: 90_000,
    bombs_available: 12,
    bombs_needed: 10,
    overkill_threshold: 1.1,
    under_kill_threshold: false,
    kill_threshold_pct: null,
    guild_level: 20,
    mode: 'worst_case',
    damage_per_bomb: 10_000,
    damage_range: { floor: 9_000, ceil: 11_000 },
    scenarios: {
      worst_case: { bombs_needed: 10, damage_per_bomb: 9_000 },
      average: { bombs_needed: 9, damage_per_bomb: 10_000 },
      best_case: { bombs_needed: 9, damage_per_bomb: 11_000 }
    },
    observed_at: NOW_MS - 60_000
  }

  /** `auditError` models PostgREST resolving (never throwing) `{ error }`. */
  const makeBombSupabaseMock = (
    auditError: { message: string } | null = null
  ) => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null })
    const insertChain = {
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 77 }, error: null })
    }
    const auditInsert = vi.fn().mockResolvedValue({ error: auditError })
    const fromMock = vi.fn((table: string) => {
      if (table === 'herald_posted_events') {
        return {
          insert: vi.fn().mockReturnValue(insertChain),
          delete: vi.fn().mockReturnValue({ eq: deleteEq })
        }
      }
      if (table === 'discord_webhook_logs') {
        return { insert: auditInsert }
      }
      throw new Error(`unexpected table: ${table}`)
    })
    const supabase = { from: fromMock } as unknown as Parameters<
      typeof postHeraldBombRangeEvent
    >[0]['supabase']
    return { supabase, deleteEq, auditInsert }
  }

  it('deletes the claimed dedup row when the single-channel post fails', async () => {
    const { supabase, deleteEq } = makeBombSupabaseMock()
    vi.mocked(postToWebhook).mockResolvedValueOnce({
      ok: false,
      status: 500,
      attempts: 3,
      error: { type: 'server_error', message: 'Discord 500' }
    })
    const result = await postHeraldBombRangeEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition: bombTransition,
      invocationId: 'inv-bomb-1',
      webhookUrl: 'https://discord.com/api/webhooks/9/token',
      roleId: null
    })
    expect(result.outcome).toBe('failed')
    expect(deleteEq).toHaveBeenCalledWith('id', 77)
  })

  it('deletes the claimed dedup row when the post THROWS', async () => {
    const { supabase, deleteEq } = makeBombSupabaseMock()
    vi.mocked(postToWebhook).mockRejectedValueOnce(
      new Error('Discord webhook failed: server error')
    )
    const result = await postHeraldBombRangeEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition: bombTransition,
      invocationId: 'inv-bomb-2',
      webhookUrl: 'https://discord.com/api/webhooks/9/token',
      roleId: null
    })
    expect(result.outcome).toBe('failed')
    expect(deleteEq).toHaveBeenCalledWith('id', 77)
  })

  it('keeps the dedup claim on success', async () => {
    const { supabase, deleteEq } = makeBombSupabaseMock()
    const result = await postHeraldBombRangeEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition: bombTransition,
      invocationId: 'inv-bomb-3',
      webhookUrl: 'https://discord.com/api/webhooks/9/token',
      roleId: null
    })
    expect(result.outcome).toBe('posted')
    expect(deleteEq).not.toHaveBeenCalled()
  })

  it('still reports posted but WARNS when the audit insert is rejected', async () => {
    // A rejected audit insert resolves with { error }: the outcome stays 'posted' but is logged.
    logSpies.warn.mockClear()
    const { supabase, deleteEq, auditInsert } = makeBombSupabaseMock({
      message:
        'new row violates check constraint "discord_webhook_logs_status_check"'
    })
    const result = await postHeraldBombRangeEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition: bombTransition,
      invocationId: 'inv-bomb-audit-err',
      webhookUrl: 'https://discord.com/api/webhooks/9/token',
      roleId: null
    })

    expect(result.outcome).toBe('posted')
    expect(deleteEq).not.toHaveBeenCalled()
    expect(auditInsert).toHaveBeenCalledTimes(1)
    const warned = logSpies.warn.mock.calls.find(
      (call) => call[1] === 'herald.bomb_range.audit_write_failed'
    )
    expect(warned, 'audit-write failure must warn').toBeDefined()
    expect(warned?.[0]).toMatchObject({
      herald_invocation_id: 'inv-bomb-audit-err',
      guild_code: 'TEST_GUILD',
      err: 'new row violates check constraint "discord_webhook_logs_status_check"'
    })
  })

  it('still reports posted and WARNS when the audit insert THROWS', async () => {
    logSpies.warn.mockClear()
    const { supabase } = makeBombSupabaseMock()
    vi.mocked(supabase.from as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce((table: string) => {
        if (table === 'herald_posted_events') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { id: 77 }, error: null })
            }),
            delete: vi.fn().mockReturnValue({ eq: vi.fn() })
          }
        }
        throw new Error(`unexpected table: ${table}`)
      })
      .mockImplementationOnce(() => ({
        insert: vi.fn().mockRejectedValue(new Error('connection reset'))
      }))

    const result = await postHeraldBombRangeEvent({
      supabase,
      guildCode: 'TEST_GUILD',
      transition: bombTransition,
      invocationId: 'inv-bomb-audit-throw',
      webhookUrl: 'https://discord.com/api/webhooks/9/token',
      roleId: null
    })

    expect(result.outcome).toBe('posted')
    const warned = logSpies.warn.mock.calls.find(
      (call) => call[1] === 'herald.bomb_range.audit_write_failed'
    )
    expect(warned, 'thrown audit write must warn too').toBeDefined()
    expect(warned?.[0]).toMatchObject({ err: 'connection reset' })
  })
})

describe('resolveRoleIdsForTransition', () => {
  it('returns per-boss discord_role_ids when the per-boss list is non-empty', () => {
    const config = bossConfig({
      boss_id: 'Ghazghkull_E0',
      discord_role_ids: ['111111111111111111', '222222222222222222']
    })
    const result = __testing.resolveRoleIdsForTransition(
      config,
      [{ discord_role_id: '999999999999999999', active_boss_ids: null }],
      'Ghazghkull_E0'
    )
    expect(result).toEqual(['111111111111111111', '222222222222222222'])
  })

  it('falls back to guild mappings when per-boss list is empty', () => {
    const config = bossConfig({
      boss_id: 'Ghazghkull_E0',
      discord_role_ids: []
    })
    const result = __testing.resolveRoleIdsForTransition(
      config,
      [{ discord_role_id: '999999999999999999', active_boss_ids: null }],
      'Ghazghkull_E0'
    )
    expect(result).toEqual(['999999999999999999'])
  })

  it('drops invalid snowflakes from per-boss list without falling back', () => {
    const config = bossConfig({
      boss_id: 'Ghazghkull_E0',
      discord_role_ids: ['not-a-snowflake', '111111111111111111']
    })
    const result = __testing.resolveRoleIdsForTransition(
      config,
      [{ discord_role_id: '999999999999999999', active_boss_ids: null }],
      'Ghazghkull_E0'
    )
    expect(result).toEqual(['111111111111111111'])
  })
})

describe('loadSkippedPrimesForSeasons', () => {
  const makeMock = (
    rows: Array<{
      season_number: string
      level: string
      sub_bosses: Record<string, unknown> | null
    }> | null,
    error: { message: string } | null = null
  ) => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: rows, error })
    }
    const from = vi.fn().mockReturnValue(chain)
    return { from } as unknown as Parameters<
      typeof __testing.loadSkippedPrimesForSeasons
    >[0]
  }

  it('flattens sub1_skip / sub2_skip flags into level_SubN keys per season', async () => {
    const result = await __testing.loadSkippedPrimesForSeasons(
      makeMock([
        {
          season_number: '99',
          level: 'L1',
          sub_bosses: {
            sub1: 'A',
            sub2: 'B',
            sub1_skip: true,
            sub2_skip: false
          }
        },
        {
          season_number: '99',
          level: 'M3',
          sub_bosses: {
            sub1: 'X',
            sub2: 'Y',
            sub1_skip: false,
            sub2_skip: true
          }
        }
      ]),
      'GUILD',
      ['99']
    )
    expect(result.get('99')?.has('L1_Sub1')).toBe(true)
    expect(result.get('99')?.has('L1_Sub2')).toBe(false)
    expect(result.get('99')?.has('M3_Sub1')).toBe(false)
    expect(result.get('99')?.has('M3_Sub2')).toBe(true)
  })

  it('returns empty result for a guild that has never planned (no rows)', async () => {
    const result = await __testing.loadSkippedPrimesForSeasons(
      makeMock([]),
      'GUILD',
      ['99']
    )
    expect(result.size).toBe(0)
  })

  it('swallows db errors and returns empty — Herald must not fail a sync because the planner table is broken', async () => {
    const result = await __testing.loadSkippedPrimesForSeasons(
      makeMock(null, { message: 'table missing' }),
      'GUILD',
      ['99']
    )
    expect(result.size).toBe(0)
  })

  it('short-circuits when given no seasons (no query)', async () => {
    const mock = makeMock([])
    const result = await __testing.loadSkippedPrimesForSeasons(
      mock,
      'GUILD',
      []
    )
    expect(result.size).toBe(0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mock as any).from).not.toHaveBeenCalled()
  })

  const makeDualMock = (opts: {
    plannerRows?: Array<{
      season_number: string
      level: string
      sub_bosses: Record<string, unknown> | null
    }>
    tokenRows?: Array<{
      boss_name: string
      rarity: string
      set: number
      encounter_id: number
      skip: boolean
      source?: string
      seeded_from_seasons?: string
    }>
    plannerError?: { message: string } | null
    tokenError?: { message: string } | null
  }) => {
    const from = vi.fn((table: string) => {
      if (table === 'boss_target_tokens') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: opts.tokenRows ?? [],
            error: opts.tokenError ?? null
          })
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: opts.plannerRows ?? [],
          error: opts.plannerError ?? null
        })
      }
    })
    return { from } as unknown as Parameters<
      typeof __testing.loadSkippedPrimesForSeasons
    >[0]
  }

  it('folds boss_target_tokens.skip into a boss-qualified key on every requested season (the SKIPPED-badge bug)', async () => {
    const result = await __testing.loadSkippedPrimesForSeasons(
      makeDualMock({
        plannerRows: [],
        tokenRows: [
          {
            boss_name: 'Ghazghkull',
            rarity: 'Legendary',
            set: 4, // 1-indexed → stage "L4"
            encounter_id: 1,
            skip: true
          }
        ]
      }),
      'GUILD',
      ['104', '105']
    )
    // Token pins carry no season, so they apply to every season.
    for (const season of ['104', '105']) {
      expect(
        __testing.isPrimeSkipped(result.get(season), 'Ghazghkull', 'L4', 1)
      ).toBe(true)
      expect(
        __testing.isPrimeSkipped(result.get(season), 'Ghazghkull', 'L4', 2)
      ).toBe(false)
    }
  })

  it('does not let a token pin bleed onto a different boss sharing the same stage code', async () => {
    const result = await __testing.loadSkippedPrimesForSeasons(
      makeDualMock({
        tokenRows: [
          {
            boss_name: 'Ghazghkull',
            rarity: 'Legendary',
            set: 4,
            encounter_id: 1,
            skip: true
          }
        ]
      }),
      'GUILD',
      ['104']
    )
    expect(
      __testing.isPrimeSkipped(result.get('104'), 'Mortarion', 'L4', 1)
    ).toBe(false)
  })

  it('unions planner and token sources; either surface suppresses', async () => {
    const result = await __testing.loadSkippedPrimesForSeasons(
      makeDualMock({
        plannerRows: [
          {
            season_number: '104',
            level: 'L4',
            sub_bosses: { sub2_skip: true }
          }
        ],
        tokenRows: [
          {
            boss_name: 'Ghazghkull',
            rarity: 'Legendary',
            set: 4,
            encounter_id: 1,
            skip: true
          }
        ]
      }),
      'GUILD',
      ['104']
    )
    const set = result.get('104')
    expect(__testing.isPrimeSkipped(set, 'Ghazghkull', 'L4', 2)).toBe(true)
    expect(__testing.isPrimeSkipped(set, 'Ghazghkull', 'L4', 1)).toBe(true)
  })

  it('ignores non-skipped and main-encounter token rows', async () => {
    const result = await __testing.loadSkippedPrimesForSeasons(
      makeDualMock({
        tokenRows: [
          {
            boss_name: 'Ghazghkull',
            rarity: 'Legendary',
            set: 4,
            encounter_id: 2,
            skip: false
          }
        ]
      }),
      'GUILD',
      ['104']
    )
    expect(
      __testing.isPrimeSkipped(result.get('104'), 'Ghazghkull', 'L4', 2)
    ).toBe(false)
  })

  it('does NOT treat a "None Available" no-data sentinel (skip=true) as a skip', async () => {
    // Historical-seed skips are not officer intent; the prime is still announced.
    const result = await __testing.loadSkippedPrimesForSeasons(
      makeDualMock({
        tokenRows: [
          {
            boss_name: 'Ghazghkull',
            rarity: 'Legendary',
            set: 4,
            encounter_id: 1,
            skip: true,
            source: 'historical_seed',
            seeded_from_seasons: 'none available'
          }
        ]
      }),
      'GUILD',
      ['104']
    )
    expect(
      __testing.isPrimeSkipped(result.get('104'), 'Ghazghkull', 'L4', 1)
    ).toBe(false)
  })

  it('still honors a genuine officer skip (skip=true, officer_manual source)', async () => {
    const result = await __testing.loadSkippedPrimesForSeasons(
      makeDualMock({
        tokenRows: [
          {
            boss_name: 'Ghazghkull',
            rarity: 'Legendary',
            set: 4,
            encounter_id: 1,
            skip: true,
            source: 'officer_manual'
          }
        ]
      }),
      'GUILD',
      ['104']
    )
    expect(
      __testing.isPrimeSkipped(result.get('104'), 'Ghazghkull', 'L4', 1)
    ).toBe(true)
  })

  it('token load failure is swallowed and does not drop planner skips', async () => {
    const result = await __testing.loadSkippedPrimesForSeasons(
      makeDualMock({
        plannerRows: [
          {
            season_number: '104',
            level: 'L4',
            sub_bosses: { sub1_skip: true }
          }
        ],
        tokenError: { message: 'boss_target_tokens exploded' }
      }),
      'GUILD',
      ['104']
    )
    expect(
      __testing.isPrimeSkipped(result.get('104'), 'Ghazghkull', 'L4', 1)
    ).toBe(true)
  })
})

describe('loadBossDisplayNameOverrides', () => {
  const makeMock = () => {
    const chain = {
      select: vi.fn().mockResolvedValue({
        data: [
          {
            boss_type: 'Magnus',
            encounter_index: 0,
            boss_name: 'Magnus the Red'
          },
          { boss_type: 'Magnus', encounter_index: 1, boss_name: 'Thaumacus' },
          { boss_type: 'Magnus', encounter_index: 2, boss_name: 'Abraxas' }
        ],
        error: null
      })
    }
    const from = vi.fn().mockReturnValue(chain)
    return { from } as unknown as Parameters<
      typeof __testing.loadBossDisplayNameOverrides
    >[0]
  }

  it('registers main-boss override (Magnus_E0 → "Magnus the Red") since prettyBossName misses single-word epithets', async () => {
    const map = await __testing.loadBossDisplayNameOverrides(makeMock())
    expect(map.get('Magnus_E0')).toBe('Magnus the Red')
    expect(map.get('ThousMagnus_E0')).toBe('Magnus the Red')
  })

  it('registers prime overrides under the real-sync key (Magnus_E1 → Thaumacus)', async () => {
    const map = await __testing.loadBossDisplayNameOverrides(makeMock())
    expect(map.get('Magnus_E1')).toBe('Thaumacus')
    expect(map.get('Magnus_E2')).toBe('Abraxas')
  })

  it('also registers prime overrides under the UI test-fire key (ThousSorcerer_E1 → Thaumacus)', async () => {
    const map = await __testing.loadBossDisplayNameOverrides(makeMock())
    expect(map.get('ThousSorcerer_E1')).toBe('Thaumacus')
    expect(map.get('ThousInfernalMaster_E2')).toBe('Abraxas')
  })
})

describe('formatDefeatEmbed', () => {
  const [transition] = detectDefeatTransitions([kill()], { nowMs: NOW_MS })

  it('renders a minimal embed with title, description, and color for Legendary', () => {
    const embed = __testing.formatDefeatEmbed(transition)
    expect(embed.title).toContain('Ghazghkull')
    expect(embed.description).toContain('Roy')
    expect(embed.description).toContain('L3')
    expect(embed.description).not.toContain('Set 2')
    expect(embed.color).toBe(0xf5a623) // LEGENDARY_COLOR
  })

  // Extras belong to availability posts, where a strategy prompt is actionable.
  it('never attaches extras fields (replays, videos, links)', () => {
    const embed = __testing.formatDefeatEmbed(transition)
    expect(embed.fields ?? []).toEqual([])
  })
})

describe('normalizeExtraEntries', () => {
  it('accepts valid http/https URLs', () => {
    expect(
      __testing.normalizeExtraEntries([
        { label: 'A', url: 'https://example.com' },
        { label: 'B', url: 'http://example.org' }
      ])
    ).toHaveLength(2)
  })

  it('rejects non-http protocols', () => {
    expect(
      __testing.normalizeExtraEntries([
        { label: 'B', url: 'javascript:alert(1)' },
        { label: 'C', url: 'ftp://example.com' }
      ])
    ).toHaveLength(0)
  })

  it('defaults label to URL when label is empty', () => {
    const out = __testing.normalizeExtraEntries([
      { label: '', url: 'https://example.com' }
    ])
    expect(out[0].label).toBe('https://example.com')
  })

  it('drops non-array inputs', () => {
    expect(__testing.normalizeExtraEntries(null)).toEqual([])
    expect(__testing.normalizeExtraEntries('not an array')).toEqual([])
  })
})

// Defaults to a prime so battle rows cannot bypass the prime-death gate.
const bossAt = (overrides: Partial<HeraldBattle> = {}): HeraldBattle => ({
  type: 'Ghazghkull',
  encounterIndex: 1,
  completedOn: NOW_MS - 60_000,
  remainingHp: 5000, // still alive — not a defeat
  rarity: 'Legendary',
  userId: 'u1',
  displayName: 'Roy',
  tier: 5,
  set: 2,
  Season: 99,
  loopIndex: 0,
  ...overrides
})

describe('detectBombRangeTransitions', () => {
  it('fires when usable bombs can kill a still-living boss at floor damage', () => {
    const result = __testing.detectBombRangeTransitions(
      [
        bossAt({
          encounterIndex: 0,
          remainingHp: 52_440,
          loopIndex: 2
        })
      ],
      {
        bombsAvailable: 5,
        overkillThreshold: 0.8,
        nowMs: NOW_MS
      }
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      boss_id: 'Ghazghkull_E0',
      season: 99,
      loop_index: 2,
      encounter_index: 0,
      remaining_hp: 52_440,
      bombs_available: 5,
      bombs_needed: 4
    })
  })

  it('does not count one bomb at the default threshold as usable overkill', () => {
    const result = __testing.detectBombRangeTransitions(
      [
        bossAt({
          encounterIndex: 0,
          remainingHp: 13_110
        })
      ],
      {
        bombsAvailable: 1,
        overkillThreshold: 0.8,
        nowMs: NOW_MS
      }
    )
    expect(result).toEqual([])
  })

  it('flags a prime at/below its configured kill threshold as considered dead', () => {
    const result = __testing.detectBombRangeTransitions(
      [
        bossAt({
          encounterIndex: 2,
          remainingHp: 25_000,
          maxHp: 2_500_000, // 1% remaining, threshold 20%
          set: 4
        })
      ],
      {
        bombsAvailable: 5,
        overkillThreshold: 0.8,
        nowMs: NOW_MS,
        killThresholdMap: new Map([['99|L5|2', 20]])
      }
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      encounter_index: 2,
      under_kill_threshold: true,
      kill_threshold_pct: 20
    })
  })

  it('does not flag a prime above its configured kill threshold', () => {
    const result = __testing.detectBombRangeTransitions(
      [
        bossAt({
          encounterIndex: 2,
          remainingHp: 30_000,
          maxHp: 100_000, // 30% remaining, threshold 20%
          set: 4
        })
      ],
      {
        bombsAvailable: 5,
        overkillThreshold: 0.8,
        nowMs: NOW_MS,
        killThresholdMap: new Map([['99|L5|2', 20]])
      }
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      under_kill_threshold: false,
      kill_threshold_pct: 20
    })
  })

  it('does not flag when maxHp is missing (threshold uncomputable)', () => {
    const result = __testing.detectBombRangeTransitions(
      [
        bossAt({
          encounterIndex: 2,
          remainingHp: 25_000,
          maxHp: null,
          set: 4
        })
      ],
      {
        bombsAvailable: 5,
        overkillThreshold: 0.8,
        nowMs: NOW_MS,
        killThresholdMap: new Map([['99|L5|2', 20]])
      }
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      under_kill_threshold: false,
      kill_threshold_pct: 20
    })
  })

  it('does not borrow an L4 threshold for a displayed L5 prime', () => {
    const result = __testing.detectBombRangeTransitions(
      [
        bossAt({
          encounterIndex: 2,
          remainingHp: 25_000,
          maxHp: 2_500_000,
          set: 4
        })
      ],
      {
        bombsAvailable: 5,
        overkillThreshold: 0.8,
        nowMs: NOW_MS,
        killThresholdMap: new Map([['99|L4|2', 20]])
      }
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      under_kill_threshold: false,
      kill_threshold_pct: null
    })
  })
})

describe('formatBombRangeEmbed — under-threshold advisory', () => {
  const base: BombRangeTransition = {
    boss_id: 'Belisarius_E2',
    boss_type: 'Belisarius',
    boss_display_name: 'Actus',
    rarity: 'Mythic',
    tier: 6,
    set: 1,
    encounter_index: 2,
    season: 104,
    loop_index: 0,
    remaining_hp: 24_982,
    bombs_available: 11,
    bombs_needed: 2,
    overkill_threshold: 0.8,
    under_kill_threshold: false,
    kill_threshold_pct: null,
    guild_level: 43,
    mode: 'worst_case',
    damage_per_bomb: 13_720,
    damage_range: { floor: 13_720, ceil: 18_140 },
    scenarios: {
      worst_case: { bombs_needed: 2, damage_per_bomb: 13_720 },
      average: { bombs_needed: 2, damage_per_bomb: 15_930 },
      best_case: { bombs_needed: 2, damage_per_bomb: 18_140 }
    },
    observed_at: NOW_MS - 60_000
  }

  it('keeps the bombing call-to-action when not under threshold', () => {
    const embed = __testing.formatBombRangeEmbed(base)
    expect(embed.title).toContain('is in bomb range!')
    expect(embed.description).toContain(
      'Please ask an officer for confirmation before bombing.'
    )
  })

  it('flips to the considered-dead advisory when under threshold', () => {
    const embed = __testing.formatBombRangeEmbed({
      ...base,
      under_kill_threshold: true,
      kill_threshold_pct: 20
    })
    expect(embed.title).toContain('is under threshold — considered dead')
    expect(embed.title).not.toContain('is in bomb range!')
    expect(embed.description).toContain(
      '**Actus** is under threshold and is considered dead. Do not bomb unless an officer calls for it.'
    )
    expect(embed.description).not.toContain(
      'Please ask an officer for confirmation before bombing.'
    )
  })
})

describe('runHeraldForSync — bomb range', () => {
  const makeBombRangeSupabaseMock = (
    opts: {
      bombAlertEnabled?: boolean
      webhookUrl?: string | null
      notificationsEnabled?: boolean
    } = {}
  ) => {
    const inserts: Record<string, unknown[]> = {}
    const query = (
      payload: {
        data: Record<string, unknown> | null
        error: Record<string, unknown> | null
      },
      maybeSinglePayload: {
        data: Record<string, unknown> | null
        error: Record<string, unknown> | null
      } = payload
    ) => {
      const proxy: Record<string, unknown> = {}
      const identity = () => proxy
      proxy.select = identity
      proxy.eq = identity
      proxy.in = identity
      proxy.order = identity
      proxy.limit = identity
      proxy.update = vi.fn(() => proxy)
      proxy.insert = vi.fn((row: Record<string, unknown>) => {
        const table = (proxy as { __table?: string }).__table ?? 'unknown'
        inserts[table] = [...(inserts[table] ?? []), row]
        return proxy
      })
      proxy.maybeSingle = vi.fn(() => Promise.resolve(maybeSinglePayload))
      proxy.then = (
        resolve: (value: {
          data: Record<string, unknown> | null
          error: Record<string, unknown> | null
        }) => unknown,
        reject: (reason?: unknown) => unknown
      ) => Promise.resolve(payload).then(resolve, reject)
      return proxy
    }

    const guildConfigRow = {
      notifications_enabled: opts.notificationsEnabled ?? true,
      mention_roles_as_text: false,
      combine_prime_deaths: false,
      bomb_alert_enabled: opts.bombAlertEnabled ?? true,
      bomb_alert_overkill_threshold: 0.8,
      bomb_alert_role_id: '123456789012345678',
      bomb_alert_webhook_url:
        opts.webhookUrl ?? 'https://discord.com/api/webhooks/bomb/token'
    }

    const fromMock = vi.fn((table: string) => {
      if (table === 'guild_config') {
        const q = query(
          { data: guildConfigRow, error: null },
          { data: guildConfigRow, error: null }
        )
        ;(q as { __table?: string }).__table = table
        return q
      }
      if (
        table === 'upcoming_season_bosses' ||
        table === 'herald_boss_availability' ||
        table === 'boss_mapping' ||
        table === 'herald_meta_role_mapping'
      ) {
        const q = query({ data: [], error: null })
        ;(q as { __table?: string }).__table = table
        return q
      }
      if (table === 'herald_posted_events') {
        const q = query(
          { data: { id: 713 }, error: null },
          { data: { id: 713 }, error: null }
        )
        ;(q as { __table?: string }).__table = table
        return q
      }
      if (table === 'discord_webhook_logs') {
        const q = query({ data: null, error: null })
        ;(q as { __table?: string }).__table = table
        return q
      }
      throw new Error(`unexpected table: ${table}`)
    })

    return {
      inserts,
      supabase: { from: fromMock } as unknown as Parameters<
        typeof runHeraldForSync
      >[0]['supabase']
    }
  }

  it('posts a bomb-range alert even when there are no defeat or availability transitions', async () => {
    const postMock = vi.mocked(postToWebhook)
    postMock.mockClear()
    const { supabase, inserts } = makeBombRangeSupabaseMock()
    const result = await runHeraldForSync({
      supabase,
      guildCode: 'IW',
      battles: [],
      allBattles: [
        bossAt({
          encounterIndex: 0,
          remainingHp: 52_440,
          loopIndex: 2
        })
      ],
      nowMs: NOW_MS,
      bombsAvailableOverride: 5
    })

    expect(result.detected).toBe(0)
    expect(result.availability_detected).toBe(0)
    expect(result.bomb_range_detected).toBe(1)
    expect(result.bomb_range_posted).toBe(1)
    expect(inserts.herald_posted_events).toHaveLength(1)
    expect(inserts.herald_posted_events[0]).toMatchObject({
      guild_code: 'IW',
      boss_id: 'Ghazghkull_E0',
      season: 99,
      loop_index: 2,
      encounter_index: 0,
      transition_type: 'bomb_range_breach'
    })
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock.mock.calls[0][0]).toBe(
      'https://discord.com/api/webhooks/bomb/token'
    )
    // The title leads so mobile push previews show the bomb-range line.
    const sentPayload = postMock.mock.calls[0][1] as { content: string }
    expect(sentPayload.content).toMatch(/is in bomb range!/)
    expect(sentPayload.content.endsWith('<@&123456789012345678>')).toBe(true)
    expect(sentPayload.content).toContain('\n<@&123456789012345678>')
    expect(postMock.mock.calls[0][1]).toMatchObject({
      allowed_mentions: {
        parse: [],
        roles: ['123456789012345678']
      }
    })
  })

  it('does not post or claim dedup rows when bomb alerts are disabled', async () => {
    const postMock = vi.mocked(postToWebhook)
    postMock.mockClear()
    const { supabase, inserts } = makeBombRangeSupabaseMock({
      bombAlertEnabled: false
    })
    const result = await runHeraldForSync({
      supabase,
      guildCode: 'IW',
      battles: [],
      allBattles: [
        bossAt({
          encounterIndex: 0,
          remainingHp: 52_440
        })
      ],
      nowMs: NOW_MS,
      bombsAvailableOverride: 5
    })

    expect(result.bomb_range_detected).toBe(0)
    expect(result.bomb_range_posted).toBe(0)
    expect(inserts.herald_posted_events ?? []).toHaveLength(0)
    expect(postMock).not.toHaveBeenCalled()
  })
})

describe('detectAvailabilityTransitions', () => {
  it('returns a transition for each distinct prime (boss_id, rarity, set) not in the snapshot', () => {
    const battles = [
      bossAt(), // Ghazghkull_E1 → also emits Ghazghkull_E2 sibling
      bossAt({ type: 'Belisarius', encounterIndex: 1 }),
      bossAt({ type: 'Belisarius', encounterIndex: 2 })
    ]
    const result = detectAvailabilityTransitions(battles, new Set())
    expect(result.map((t) => t.boss_id).sort()).toEqual([
      'Belisarius_E1',
      'Belisarius_E2',
      'Ghazghkull_E1',
      'Ghazghkull_E2' // synthesized sibling
    ])
  })

  it('skips bosses already in the already-seen snapshot set (5-part key)', () => {
    const battles = [
      bossAt(), // Ghazghkull_E1 @ 99 set=2 Legendary loop=0
      bossAt({ type: 'Belisarius' }) // Belisarius_E1 @ 99
    ]
    const snapshot = new Set([
      '99|Ghazghkull_E1|0|Legendary|2',
      '99|Ghazghkull_E2|0|Legendary|2',
      '99|Belisarius_E2|0|Legendary|2'
    ])
    const result = detectAvailabilityTransitions(battles, snapshot)
    expect(result.map((t) => t.boss_id)).toEqual(['Belisarius_E1'])
  })

  it('skips a stage with no set: set_num is NOT NULL and part of the dedup key', () => {
    const battles = [
      bossAt({ set: undefined }),
      bossAt({ type: 'Belisarius', set: null })
    ]
    expect(detectAvailabilityTransitions(battles, new Set())).toEqual([])
  })

  it('does NOT emit availability for main-boss rows (encounterIndex 0)', () => {
    // A main-boss battle row must not trigger this detector, or the prime-death gate is bypassed.
    const battles = [
      bossAt({ encounterIndex: 0 }),
      bossAt({ type: 'Belisarius', encounterIndex: 0 })
    ]
    const result = detectAvailabilityTransitions(battles, new Set())
    expect(result).toHaveLength(0)
  })

  it('completes prime siblings — one prime battle row triggers BOTH primes for the stage', () => {
    const battles = [
      bossAt({
        type: 'Magnus',
        encounterIndex: 1,
        rarity: 'Mythic',
        set: 1,
        loopIndex: 2
      })
    ]
    const result = detectAvailabilityTransitions(battles, new Set())
    expect(result.map((t) => t.boss_id).sort()).toEqual([
      'Magnus_E1',
      'Magnus_E2'
    ])
    const e2 = result.find((t) => t.boss_id === 'Magnus_E2')!
    expect(e2.rarity).toBe('Mythic')
    expect(e2.set).toBe(1)
    expect(e2.loop_index).toBe(2)
  })

  it('does not synthesize a sibling that is already in the snapshot', () => {
    const battles = [
      bossAt({
        type: 'Magnus',
        encounterIndex: 1,
        rarity: 'Mythic',
        set: 1,
        loopIndex: 2
      })
    ]
    const snapshot = new Set(['99|Magnus_E2|2|Mythic|1'])
    const result = detectAvailabilityTransitions(battles, snapshot)
    expect(result.map((t) => t.boss_id)).toEqual(['Magnus_E1'])
  })

  it('still surfaces E2 when E1 is already in the snapshot (IW catch-up case)', () => {
    // E1 announced but E2 never was: a new E1 row surfaces E2 (self-healing catch-up).
    const battles = [
      bossAt({
        type: 'Magnus',
        encounterIndex: 1,
        rarity: 'Mythic',
        set: 1,
        loopIndex: 2
      })
    ]
    const snapshot = new Set(['99|Magnus_E1|2|Mythic|1'])
    const result = detectAvailabilityTransitions(battles, snapshot)
    expect(result.map((t) => t.boss_id)).toEqual(['Magnus_E2'])
  })

  it('treats same boss_id at different (rarity, set) positions as distinct', () => {
    const battles = [
      bossAt({
        type: 'Magnus',
        encounterIndex: 1,
        rarity: 'Mythic',
        set: 1,
        loopIndex: 2
      })
    ]
    const snapshot = new Set([
      '99|Magnus_E1|2|Legendary|3', // L4 Magnus E1 already emitted
      '99|Magnus_E2|2|Mythic|1' // suppress sibling-completion for this test
    ])
    const result = detectAvailabilityTransitions(battles, snapshot)
    expect(result).toHaveLength(1)
    expect(result[0].rarity).toBe('Mythic')
    expect(result[0].set).toBe(1)
  })

  it('deduplicates within a single sync — one battle per (boss_id, stage) is enough', () => {
    const battles = [
      bossAt(),
      bossAt({ userId: 'u2', displayName: 'Alice' }),
      bossAt({ userId: 'u3', displayName: 'Bob' })
    ]
    const result = detectAvailabilityTransitions(battles, new Set())
    expect(result.map((t) => t.boss_id).sort()).toEqual([
      'Ghazghkull_E1',
      'Ghazghkull_E2'
    ])
  })

  it('honors the rarity filter (filters out sub-Legendary)', () => {
    const battles = [
      bossAt({ rarity: 'Epic', type: 'EpicBoss' }),
      bossAt({ rarity: 'Legendary', type: 'LegBoss' })
    ]
    const result = detectAvailabilityTransitions(battles, new Set())
    expect(result.map((t) => t.boss_id).sort()).toEqual([
      'LegBoss_E1',
      'LegBoss_E2'
    ])
  })

  it('includes Mythic under default rarity filter', () => {
    const battles = [
      bossAt({ rarity: 'Mythic', type: 'MythBoss' }),
      bossAt({ rarity: 'Legendary', type: 'LegBoss' })
    ]
    const result = detectAvailabilityTransitions(battles, new Set())
    expect(result.map((t) => t.boss_type).sort()).toEqual([
      'LegBoss',
      'LegBoss',
      'MythBoss',
      'MythBoss'
    ])
  })

  it('honors a custom rarity filter', () => {
    const battles = [
      bossAt({ rarity: 'Mythic', type: 'MythBoss' }),
      bossAt({ rarity: 'Legendary', type: 'LegBoss' }),
      bossAt({ rarity: 'Epic', type: 'EpicBoss' })
    ]
    const result = detectAvailabilityTransitions(battles, new Set(), {
      rarityFilter: ['Legendary', 'Mythic']
    })
    expect(result.map((t) => t.boss_type).sort()).toEqual([
      'LegBoss',
      'LegBoss',
      'MythBoss',
      'MythBoss'
    ])
  })

  it('skips battles missing type, season, or encounterIndex', () => {
    const battles = [
      bossAt({ type: null }),
      bossAt({ Season: null }),
      bossAt({ encounterIndex: null })
    ]
    expect(detectAvailabilityTransitions(battles, new Set())).toHaveLength(0)
  })

  it('treats different seasons as distinct entries for the same boss', () => {
    const battles = [bossAt({ Season: 99 }), bossAt({ Season: 100 })]
    const result = detectAvailabilityTransitions(battles, new Set())
    expect(result).toHaveLength(4)
    expect(result.map((t) => t.season).sort((a, b) => a - b)).toEqual([
      99, 99, 100, 100
    ])
  })

  it('returns tier/set info from the first matching battle seen (same full key)', () => {
    const battles = [
      bossAt({ tier: 7, set: 3 }),
      bossAt({ tier: 5, set: 3 }) // dedupe — same (boss_id, rarity, set)
    ]
    const result = detectAvailabilityTransitions(battles, new Set())
    const e1 = result.find((t) => t.encounter_index === 1)!
    expect(e1.tier).toBe(7)
    expect(e1.set).toBe(3)
  })
})

describe('formatAvailabilityMessage', () => {
  const transition: AvailabilityTransition = {
    boss_id: 'Ghazghkull_E0',
    boss_type: 'Ghazghkull',
    boss_display_name: 'Ghazghkull',
    rarity: 'Legendary',
    tier: 5,
    set: 2,
    encounter_index: 0,
    season: 99
  }

  it('renders title + stage code detail line', () => {
    const msg = __testing.formatAvailabilityMessage(transition)
    expect(msg).toContain('Ghazghkull')
    expect(msg).toContain('is now available')
    expect(msg).toContain('L3')
    expect(msg).not.toContain('Set 2')
    expect(msg).not.toContain('5⃣')
    expect(msg.split('\n')).toHaveLength(2)
  })

  it('drops the detail line when set is null', () => {
    const msg = __testing.formatAvailabilityMessage({
      ...transition,
      tier: null,
      set: null
    })
    expect(msg.split('\n')).toHaveLength(1)
  })
})

describe('resolveHeraldWebhook — guild → cluster fallback', () => {
  const makeSupabaseMock = (opts: {
    guildWebhookRows?: Array<{
      webhook_url: string | null
      thread_id?: string | null
      enabled: boolean
      updated_at?: string
    }>
    guildWebhookError?: { message: string } | null
    clusterCode?: string | null
    guildConfigError?: { message: string } | null
    clusterId?: string | null
    clusterLookupError?: { message: string } | null
    clusterWebhookRows?: Array<{
      webhook_url: string | null
      thread_id?: string | null
      enabled: boolean
      updated_at?: string
    }>
    clusterWebhookError?: { message: string } | null
  }) => {
    const chain = (payload: {
      data: Record<string, unknown> | Record<string, unknown>[] | null
      error: { message: string } | null
    }) => {
      const terminal = Promise.resolve(payload)
      const proxy: Record<string, unknown> = {}
      const identity = () => proxy
      proxy.select = identity
      proxy.eq = identity
      proxy.order = identity
      proxy.limit = (): typeof terminal => terminal
      proxy.maybeSingle = (): typeof terminal => terminal
      return proxy
    }
    const fromMock = vi.fn((table: string) => {
      if (table === 'webhook_config') {
        const state = fromMock as unknown as { __webhookCall?: number }
        state.__webhookCall = (state.__webhookCall ?? 0) + 1
        if (state.__webhookCall === 1) {
          return chain({
            data: opts.guildWebhookRows ?? [],
            error: opts.guildWebhookError ?? null
          })
        }
        return chain({
          data: opts.clusterWebhookRows ?? [],
          error: opts.clusterWebhookError ?? null
        })
      }
      if (table === 'guild_config') {
        return chain({
          data: opts.clusterCode ? { cluster_code: opts.clusterCode } : null,
          error: opts.guildConfigError ?? null
        })
      }
      if (table === 'clusters') {
        return chain({
          data: opts.clusterId ? { id: opts.clusterId } : null,
          error: opts.clusterLookupError ?? null
        })
      }
      throw new Error(`unexpected table: ${table}`)
    })
    return { from: fromMock } as unknown as Parameters<
      typeof __testing.resolveHeraldWebhook
    >[0]
  }

  it('returns guild-scoped URL when the guild row has an enabled webhook', async () => {
    const supabase = makeSupabaseMock({
      guildWebhookRows: [
        {
          webhook_url: 'https://discord.com/api/webhooks/g',
          thread_id: '111111111111111111',
          enabled: true
        }
      ]
    })
    const result = await __testing.resolveHeraldWebhook(supabase, 'IW')
    expect(result.webhookUrl).toBe('https://discord.com/api/webhooks/g')
    expect(result.scope).toBe('guild')
    expect(result.threadId).toBe('111111111111111111')
  })

  it('falls back to cluster-scoped URL when guild has no enabled webhook', async () => {
    const supabase = makeSupabaseMock({
      guildWebhookRows: [],
      clusterCode: 'EOT',
      clusterId: 'cluster-uuid-1',
      clusterWebhookRows: [
        {
          webhook_url: 'https://discord.com/api/webhooks/c',
          thread_id: '222222222222222222',
          enabled: true
        }
      ]
    })
    const result = await __testing.resolveHeraldWebhook(supabase, 'IW')
    expect(result.webhookUrl).toBe('https://discord.com/api/webhooks/c')
    expect(result.scope).toBe('cluster')
    expect(result.threadId).toBe('222222222222222222')
  })

  it('prefers guild-scoped over cluster-scoped when both exist (override)', async () => {
    const supabase = makeSupabaseMock({
      guildWebhookRows: [
        {
          webhook_url: 'https://discord.com/api/webhooks/g-override',
          enabled: true
        }
      ],
      clusterCode: 'EOT',
      clusterId: 'cluster-uuid-1',
      clusterWebhookRows: [
        {
          webhook_url: 'https://discord.com/api/webhooks/c-default',
          enabled: true
        }
      ]
    })
    const result = await __testing.resolveHeraldWebhook(supabase, 'IW')
    expect(result.webhookUrl).toBe(
      'https://discord.com/api/webhooks/g-override'
    )
    expect(result.scope).toBe('guild')
  })

  it('returns null with reason=no_enabled_webhook when neither scope has a row', async () => {
    const supabase = makeSupabaseMock({
      guildWebhookRows: [],
      clusterCode: 'EOT',
      clusterId: 'cluster-uuid-1',
      clusterWebhookRows: []
    })
    const result = await __testing.resolveHeraldWebhook(supabase, 'IW')
    expect(result.webhookUrl).toBeNull()
    expect(result.reason).toBe('no_enabled_webhook')
  })

  it('returns null when guild has no cluster_code (cluster fallback unreachable)', async () => {
    const supabase = makeSupabaseMock({
      guildWebhookRows: [],
      clusterCode: null
    })
    const result = await __testing.resolveHeraldWebhook(supabase, 'IW')
    expect(result.webhookUrl).toBeNull()
    expect(result.reason).toBe('no_enabled_webhook')
  })

  it('returns db_error reason when guild webhook query errors out', async () => {
    const supabase = makeSupabaseMock({
      guildWebhookError: { message: 'connection refused' }
    })
    const result = await __testing.resolveHeraldWebhook(supabase, 'IW')
    expect(result.webhookUrl).toBeNull()
    expect(result.reason).toContain('connection refused')
  })

  it('returns empty_webhook_url when guild row has an empty URL AND no cluster fallback', async () => {
    const supabase = makeSupabaseMock({
      guildWebhookRows: [{ webhook_url: '   ', enabled: true }],
      clusterCode: 'EOT',
      clusterId: 'cluster-uuid-1',
      clusterWebhookRows: []
    })
    const result = await __testing.resolveHeraldWebhook(supabase, 'IW')
    expect(result.webhookUrl).toBeNull()
    expect(result.reason).toBe('empty_webhook_url')
  })
})

describe('formatAvailabilityEmbed', () => {
  const transition: AvailabilityTransition = {
    boss_id: 'Ghazghkull_E0',
    boss_type: 'Ghazghkull',
    boss_display_name: 'Ghazghkull',
    rarity: 'Legendary',
    tier: 5,
    set: 2,
    encounter_index: 0,
    season: 99
  }

  it('renders an embed with title, description, and color for Legendary', () => {
    const embed = __testing.formatAvailabilityEmbed(transition, {
      extraLinks: [],
      extraVideos: []
    })
    expect(embed.title).toContain('Ghazghkull')
    expect(embed.title).toContain('is now available')
    expect(embed.description).toContain('L3')
    expect(embed.description).not.toContain('Set 2')
    expect(embed.color).toBe(0xf5a623)
  })

  it('adds Videos and Links fields when extras are provided', () => {
    const embed = __testing.formatAvailabilityEmbed(transition, {
      extraLinks: [{ label: 'Wiki', url: 'https://example.com/wiki' }],
      extraVideos: [{ label: 'Walk-through', url: 'https://example.com/v' }]
    })
    expect(embed.fields?.some((f) => f.name.includes('Videos'))).toBe(true)
    expect(embed.fields?.some((f) => f.name.includes('Links'))).toBe(true)
  })

  it('omits the Links field entirely when there are no guild-configured extras', () => {
    const embed = __testing.formatAvailabilityEmbed(transition, {
      extraLinks: [],
      extraVideos: []
    })
    const links = embed.fields?.find((f) => f.name.includes('Links'))
    expect(links).toBeUndefined()
  })

  it('emits only guild-configured extras in the Links field (no hardcoded anchors)', () => {
    const embed = __testing.formatAvailabilityEmbed(transition, {
      extraLinks: [
        { label: 'Raid Maps Channel', url: 'https://discord.com/channels/1/2' },
        {
          label: 'Science Labs Channel',
          url: 'https://discord.com/channels/1/3'
        }
      ],
      extraVideos: []
    })
    const links = embed.fields?.find((f) => f.name.includes('Links'))
    expect(links).toBeDefined()
    const value = links!.value
    expect(value).toContain('Raid Maps Channel')
    expect(value).toContain('Science Labs Channel')
    expect(value).not.toContain('Boss Playbook')
  })

  it('resolves UI-derived herald boss_ids (tacticusTableIds-stripped) to the playbook slug', () => {
    expect(__testing.heraldBossIdToPlaybookSlug('ThousMagnus_E0')).toBe(
      'magnus'
    )
    expect(__testing.heraldBossIdToPlaybookSlug('ThousSorcerer_E1')).toBe(
      'magnus'
    )
    expect(__testing.heraldBossIdToPlaybookSlug('ThousInfernalMaster_E2')).toBe(
      'magnus'
    )
    expect(__testing.heraldBossIdToPlaybookSlug('Lion_E0')).toBe('lion')
    expect(__testing.heraldBossIdToPlaybookSlug('DarkaLion_E0')).toBe('lion')
    expect(__testing.heraldBossIdToPlaybookSlug('DarkaTerminator_E1')).toBe(
      'lion'
    )
    expect(__testing.heraldBossIdToPlaybookSlug('DarkaCompanion_E2')).toBe(
      'lion'
    )
  })

  it('resolves post-rework `RW`-suffixed bossType to the underlying playbook slug', () => {
    // Reworked bosses gain a trailing `RW`; a null slug drops the prime epithet.
    expect(__testing.heraldBossIdToPlaybookSlug('BelisariusRW_E0')).toBe(
      'belisarius'
    )
    expect(__testing.heraldBossIdToPlaybookSlug('BelisariusRW_E1')).toBe(
      'belisarius'
    )
    expect(__testing.heraldBossIdToPlaybookSlug('BelisariusRW_E2')).toBe(
      'belisarius'
    )
  })

  it('resolves each Herald encounter to its exact canonical replay boss unit', () => {
    expect(__testing.heraldBossIdToCatalogBossUnitId('Magnus_E0')).toBe(
      'GuildBoss9Boss1ThousMagnus'
    )
    expect(__testing.heraldBossIdToCatalogBossUnitId('Magnus_E1')).toBe(
      'GuildBoss9MiniBoss1ThousSorcerer'
    )
    expect(__testing.heraldBossIdToCatalogBossUnitId('Magnus_E2')).toBe(
      'GuildBoss9MiniBoss2ThousInfernalMaster'
    )
    expect(__testing.heraldBossIdToCatalogBossUnitId('not-valid')).toBeNull()
  })

  it('parses a Herald stage token into replay rarity and zero-based set', () => {
    expect(__testing.parseReplayStageToken('L1')).toEqual({
      rarity: 'Legendary',
      setNumber: 0
    })
    expect(__testing.parseReplayStageToken('M3')).toEqual({
      rarity: 'Mythic',
      setNumber: 2
    })
    expect(__testing.parseReplayStageToken(null)).toBeNull()
    expect(__testing.parseReplayStageToken('Epic3')).toBeNull()
  })
})

describe('formatAvailabilityCompactMessage', () => {
  const transition: AvailabilityTransition = {
    boss_id: 'Ghazghkull_E0',
    boss_type: 'Ghazghkull',
    boss_display_name: 'Ghazghkull',
    rarity: 'Legendary',
    tier: 5,
    set: 2,
    encounter_index: 0,
    season: 99
  }

  it('renders a single string with title + stage code; omits Links when there are no extras', () => {
    const msg = __testing.formatAvailabilityCompactMessage(transition, {
      extraLinks: [],
      extraVideos: []
    })
    expect(typeof msg).toBe('string')
    expect(msg).toContain('Ghazghkull')
    expect(msg).toContain('is now available')
    expect(msg).toContain('(L3)')
    expect(msg).not.toContain('Boss Playbook')
    expect(msg).not.toContain('🔗 Links')
  })

  it('inlines officer notes, videos, and extra links', () => {
    const msg = __testing.formatAvailabilityCompactMessage(transition, {
      extraLinks: [{ label: 'Wiki', url: 'https://example.com/wiki' }],
      extraVideos: [{ label: 'Walk-through', url: 'https://example.com/v' }],
      note: 'Watch for adds on turn 3.'
    })
    expect(msg).toContain('Notes')
    expect(msg).toContain('Watch for adds on turn 3.')
    expect(msg).toContain('Videos')
    expect(msg).toContain('Walk-through')
    expect(msg).toContain('Wiki')
    expect(msg).not.toContain('Boss Playbook')
  })

  it('uses customDescription as the lead body when provided', () => {
    const msg = __testing.formatAvailabilityCompactMessage(transition, {
      extraLinks: [],
      extraVideos: [],
      customDescription: 'Officer briefing for this raid.'
    })
    expect(msg).toContain('Officer briefing for this raid.')
    expect(msg).toContain('L3')
  })

  it('caps total length at 1900 chars to stay under Discord content limit', () => {
    const longBody = 'x'.repeat(2000)
    const msg = __testing.formatAvailabilityCompactMessage(transition, {
      extraLinks: [],
      extraVideos: [],
      note: longBody,
      customDescription: longBody
    })
    expect(msg.length).toBeLessThanOrEqual(1900)
    expect(msg.endsWith('…')).toBe(true)
  })
})

// Webhooks do not resolve `:name:` shortcodes, so they map to `<:name:id>`.

describe('buildEmojiResolver', () => {
  it('returns identity when the emoji map is empty', () => {
    const resolve = __testing.buildEmojiResolver(new Map())
    expect(resolve(':C_EC_Laviscus: hello')).toBe(':C_EC_Laviscus: hello')
  })

  it('substitutes known shortcodes with the stored <:name:id> form', () => {
    const map = new Map([
      ['C_EC_Laviscus', '<:C_EC_Laviscus:111111111111111111>'],
      ['C_AC_Trajann', '<:C_AC_Trajann:222222222222222222>']
    ])
    const resolve = __testing.buildEmojiResolver(map)
    const out = resolve(':C_EC_Laviscus: :C_AC_Trajann: + :MOW_Biovore:')
    expect(out).toBe(
      '<:C_EC_Laviscus:111111111111111111> <:C_AC_Trajann:222222222222222222> + :MOW_Biovore:'
    )
  })

  it('leaves unknown shortcodes untouched so accidental matches do not corrupt text', () => {
    const map = new Map([
      ['C_EC_Laviscus', '<:C_EC_Laviscus:111111111111111111>']
    ])
    const resolve = __testing.buildEmojiResolver(map)
    expect(resolve('see :foo: at 12:34')).toBe('see :foo: at 12:34')
    const animated = new Map([['Spin', '<a:Spin:333333333333333333>']])
    expect(__testing.buildEmojiResolver(animated)(':Spin:')).toBe(
      '<a:Spin:333333333333333333>'
    )
  })

  it('falls back to the hero display-name alias when the catalogued emoji name differs', () => {
    // Officers type the hero name but Custodes emojis use a class name; the alias bridges it.
    const map = new Map([
      ['C_AC_SwordMaster', '<:C_AC_SwordMaster:1380247280380154086>'],
      ['kariyan', '<:C_AC_SwordMaster:1380247280380154086>']
    ])
    const resolve = __testing.buildEmojiResolver(map)
    expect(resolve(':C_AC_Kariyan:')).toBe(
      '<:C_AC_SwordMaster:1380247280380154086>'
    )
  })

  it('does not apply the display-name fallback to non-underscored shortcodes', () => {
    // Only underscored shortcodes use the fallback, so prose like `:Kariyan:` never renders.
    const map = new Map([
      ['kariyan', '<:C_AC_SwordMaster:1380247280380154086>']
    ])
    const resolve = __testing.buildEmojiResolver(map)
    expect(resolve(':Kariyan:')).toBe(':Kariyan:')
    expect(resolve(':C_AC_Kariyan:')).toBe(
      '<:C_AC_SwordMaster:1380247280380154086>'
    )
  })
})

describe('formatAvailabilityEmbed with emoji resolver', () => {
  const transition: AvailabilityTransition = {
    boss_id: 'Sibyll_E0',
    boss_type: 'Sibyll',
    boss_display_name: 'Sibyll',
    rarity: 'Legendary',
    tier: 5,
    set: 1,
    encounter_index: 0,
    season: 101
  }

  it('resolves shortcodes inside the officer note before truncation', () => {
    const resolve = __testing.buildEmojiResolver(
      new Map([
        ['C_EC_Laviscus', '<:C_EC_Laviscus:111111111111111111>'],
        ['C_AC_Trajann', '<:C_AC_Trajann:222222222222222222>']
      ])
    )
    const embed = __testing.formatAvailabilityEmbed(transition, {
      extraLinks: [],
      extraVideos: [],
      note: 'Sibyll Open\n:C_EC_Laviscus: :C_AC_Trajann: + :MOW_Biovore:',
      resolveEmoji: resolve
    })
    const notes = embed.fields?.find((f) => f.name.includes('Notes'))
    expect(notes).toBeDefined()
    expect(notes?.value).toContain('<:C_EC_Laviscus:111111111111111111>')
    expect(notes?.value).toContain('<:C_AC_Trajann:222222222222222222>')
    expect(notes?.value).toContain(':MOW_Biovore:')
  })

  it('resolves shortcodes inside customDescription', () => {
    const resolve = __testing.buildEmojiResolver(
      new Map([['C_EC_Laviscus', '<:C_EC_Laviscus:111111111111111111>']])
    )
    const embed = __testing.formatAvailabilityEmbed(transition, {
      extraLinks: [],
      extraVideos: [],
      customDescription: 'Briefing — keep :C_EC_Laviscus: alive.',
      resolveEmoji: resolve
    })
    expect(embed.description).toContain('<:C_EC_Laviscus:111111111111111111>')
  })
})

describe('formatAvailabilityCompactMessage with emoji resolver', () => {
  const transition: AvailabilityTransition = {
    boss_id: 'Sibyll_E0',
    boss_type: 'Sibyll',
    boss_display_name: 'Sibyll',
    rarity: 'Legendary',
    tier: 5,
    set: 1,
    encounter_index: 0,
    season: 101
  }

  it('resolves shortcodes in note and customDescription', () => {
    const resolve = __testing.buildEmojiResolver(
      new Map([
        ['C_EC_Laviscus', '<:C_EC_Laviscus:111111111111111111>'],
        ['C_AC_Trajann', '<:C_AC_Trajann:222222222222222222>']
      ])
    )
    const msg = __testing.formatAvailabilityCompactMessage(transition, {
      extraLinks: [],
      extraVideos: [],
      note: ':C_EC_Laviscus: :C_AC_Trajann:',
      customDescription: 'Lead :C_AC_Trajann: T1.',
      resolveEmoji: resolve
    })
    expect(msg).toContain('<:C_EC_Laviscus:111111111111111111>')
    expect(msg).toContain('<:C_AC_Trajann:222222222222222222>')
    expect(/(?<!<a?):C_EC_Laviscus:/.test(msg)).toBe(false)
    expect(/(?<!<a?):C_AC_Trajann:/.test(msg)).toBe(false)
  })
})

describe('loadHeroEmojiMap', () => {
  it('builds a name-keyed map from hero_mappings, ignoring null and unparseable entries', async () => {
    const rows = [
      { discord_emoji: '<:C_EC_Laviscus:111111111111111111>' },
      { discord_emoji: '<:C_AC_Trajann:222222222222222222>' },
      { discord_emoji: '<a:Spin:333333333333333333>' },
      { discord_emoji: '   ' },
      { discord_emoji: null },
      { discord_emoji: 'not-an-emoji' }
    ]
    const supabaseStub = {
      from: () => ({
        select: () => ({
          not: () => Promise.resolve({ data: rows, error: null })
        })
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    const map = await __testing.loadHeroEmojiMap(supabaseStub)
    expect(map.get('C_EC_Laviscus')).toBe('<:C_EC_Laviscus:111111111111111111>')
    expect(map.get('C_AC_Trajann')).toBe('<:C_AC_Trajann:222222222222222222>')
    expect(map.get('Spin')).toBe('<a:Spin:333333333333333333>')
    expect(map.size).toBe(3)
  })

  it('registers a lowercase display-name alias without shadowing real emoji names', async () => {
    const rows = [
      {
        discord_emoji: '<:C_AC_SwordMaster:1380247280380154086>',
        display_name: 'Kariyan'
      },
      {
        discord_emoji: '<:C_O_BossGulgortz:1166604925850095646>',
        display_name: 'Boss Gulgortz'
      }
    ]
    const supabaseStub = {
      from: () => ({
        select: () => ({
          not: () => Promise.resolve({ data: rows, error: null })
        })
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    const map = await __testing.loadHeroEmojiMap(supabaseStub)
    expect(map.get('C_AC_SwordMaster')).toBe(
      '<:C_AC_SwordMaster:1380247280380154086>'
    )
    expect(map.get('kariyan')).toBe('<:C_AC_SwordMaster:1380247280380154086>')
    expect(map.get('bossgulgortz')).toBe(
      '<:C_O_BossGulgortz:1166604925850095646>'
    )
  })

  it('returns empty map on query error rather than throwing', async () => {
    const supabaseStub = {
      from: () => ({
        select: () => ({
          not: () => Promise.resolve({ data: null, error: { message: 'oops' } })
        })
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const map = await __testing.loadHeroEmojiMap(supabaseStub)
    expect(map.size).toBe(0)
  })
})

describe('pingedMetaTeamNamesForBoss', () => {
  const baseMappings = [
    {
      discord_role_id: '111111111111111111',
      active_boss_ids: null,
      rarity_set: null,
      meta_team_slug: 'Admech',
      display_label: null
    },
    {
      discord_role_id: '222222222222222222',
      active_boss_ids: null,
      rarity_set: null,
      meta_team_slug: 'Battlesuits',
      display_label: null
    },
    {
      discord_role_id: '333333333333333333',
      active_boss_ids: null,
      rarity_set: 'L4',
      meta_team_slug: 'Admech',
      display_label: null
    }
  ]

  it('returns empty when no roles are pinged', () => {
    const out = __testing.pingedMetaTeamNamesForBoss(
      baseMappings,
      'Magnus_E0',
      'L4',
      []
    )
    expect(out).toEqual([])
  })

  it('returns lowercased slugs for the teams whose roles are pinged', () => {
    const out = __testing.pingedMetaTeamNamesForBoss(
      baseMappings,
      'Magnus_E0',
      null, // rarity NULL falls back to catch-all rows
      ['111111111111111111', '222222222222222222']
    )
    expect(out.sort()).toEqual(['admech', 'battlesuits'])
  })

  it('per-stage rarity_set row beats catch-all when raritySet matches', () => {
    const outWithL4Role = __testing.pingedMetaTeamNamesForBoss(
      baseMappings,
      'Magnus_E0',
      'L4',
      ['333333333333333333']
    )
    expect(outWithL4Role).toEqual(['admech'])

    const outWithCatchAllRole = __testing.pingedMetaTeamNamesForBoss(
      baseMappings,
      'Magnus_E0',
      'L4',
      ['111111111111111111']
    )
    expect(outWithCatchAllRole).toEqual([])
  })

  it("respects active_boss_ids scope — drops teams that don't apply to this boss", () => {
    const scoped = [
      {
        discord_role_id: '999999999999999999',
        active_boss_ids: ['Magnus_E1'],
        rarity_set: null,
        meta_team_slug: 'Specialist',
        display_label: null
      }
    ]
    const onScopeBoss = __testing.pingedMetaTeamNamesForBoss(
      scoped,
      'Magnus_E1',
      null,
      ['999999999999999999']
    )
    expect(onScopeBoss).toEqual(['specialist'])

    const offScopeBoss = __testing.pingedMetaTeamNamesForBoss(
      scoped,
      'Magnus_E0',
      null,
      ['999999999999999999']
    )
    expect(offScopeBoss).toEqual([])
  })

  it('drops mappings with null/empty meta_team_slug or discord_role_id', () => {
    const messy = [
      {
        discord_role_id: '',
        active_boss_ids: null,
        rarity_set: null,
        meta_team_slug: 'Admech',
        display_label: null
      },
      {
        discord_role_id: '111',
        active_boss_ids: null,
        rarity_set: null,
        meta_team_slug: null,
        display_label: null
      }
    ]
    const out = __testing.pingedMetaTeamNamesForBoss(messy, 'Magnus_E0', null, [
      '111',
      ''
    ])
    expect(out).toEqual([])
  })
})

describe('postHeraldTestMessage', () => {
  const makeTestFireSupabaseMock = (
    opts: {
      hasWebhook?: boolean
      hasBossConfig?: boolean
    } = {}
  ) => {
    const hasWebhook = opts.hasWebhook ?? true
    const hasBossConfig = opts.hasBossConfig ?? false

    const terminalRows = (rows: Record<string, unknown>[]) => {
      const payload = Promise.resolve({ data: rows, error: null })
      const proxy: Record<string, unknown> = {}
      const identity = () => proxy
      proxy.select = identity
      proxy.eq = identity
      proxy.order = identity
      proxy.limit = (): typeof payload => payload
      proxy.maybeSingle = (): Promise<{
        data: Record<string, unknown> | null
        error: null
      }> => Promise.resolve({ data: rows[0] ?? null, error: null })
      proxy.in = identity
      return proxy
    }

    const fromMock = vi.fn((table: string) => {
      if (table === 'webhook_config') {
        return terminalRows(
          hasWebhook
            ? [
                {
                  webhook_url: 'https://discord.com/api/webhooks/g',
                  thread_id: '333333333333333333',
                  enabled: true
                }
              ]
            : []
        )
      }
      if (table === 'guild_config') return terminalRows([]) // no cluster fallback
      if (table === 'clusters') return terminalRows([])
      if (table === 'herald_boss_config') {
        return terminalRows(
          hasBossConfig
            ? [
                {
                  boss_id: 'Ghazghkull_E0',
                  enabled: true,
                  webhook_config_ids: [],
                  discord_role_ids: [],
                  extra_links: [],
                  extra_videos: []
                }
              ]
            : []
        )
      }
      if (table === 'herald_meta_role_mapping') return terminalRows([])
      if (table === 'boss_playbook_replays') return terminalRows([])
      throw new Error(`unexpected table: ${table}`)
    })
    return { from: fromMock } as unknown as Parameters<
      typeof postHeraldTestMessage
    >[0]['supabase']
  }

  it('posts to all resolved channels when webhook exists, returns success counts', async () => {
    const postMock = vi.mocked(postToWebhook)
    postMock.mockClear()
    const result = await postHeraldTestMessage({
      supabase: makeTestFireSupabaseMock({ hasWebhook: true }),
      guildCode: 'IW',
      bossId: 'Ghazghkull_E0',
      bossDisplayName: 'Ghazghkull',
      kind: 'defeat',
      invocationId: 'test-inv-1',
      actorDisplayName: 'Roy'
    })
    expect(result.channels).toBe(1)
    expect(result.posted).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.scope).toBe('guild')
    expect(result.embed_used).toBe(true)
    expect(result.error).toBeUndefined()
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock.mock.calls[0]?.[2]).toMatchObject({
      threadId: '333333333333333333'
    })
  })

  it('returns error=no_valid_channels when no webhook configured at any scope', async () => {
    const result = await postHeraldTestMessage({
      supabase: makeTestFireSupabaseMock({ hasWebhook: false }),
      guildCode: 'IW',
      bossId: 'Ghazghkull_E0',
      bossDisplayName: 'Ghazghkull',
      kind: 'defeat',
      invocationId: 'test-inv-2'
    })
    expect(result.channels).toBe(0)
    expect(result.posted).toBe(0)
    expect(result.error).toBe('no_valid_channels')
  })

  it('posts an availability-kind message when kind="availability"', async () => {
    const result = await postHeraldTestMessage({
      supabase: makeTestFireSupabaseMock({ hasWebhook: true }),
      guildCode: 'IW',
      bossId: 'Ghazghkull_E0',
      bossDisplayName: 'Ghazghkull',
      kind: 'availability',
      invocationId: 'test-inv-3'
    })
    expect(result.posted).toBe(1)
    expect(result.error).toBeUndefined()
  })
})
