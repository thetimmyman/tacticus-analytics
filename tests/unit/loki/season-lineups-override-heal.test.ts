import { describe, expect, it } from 'vitest'
import {
  patchOverlaySeasonsWithOverride,
  ROTATION_INDEX_OFFSET,
  SEASON_NUMBER_OFFSET,
  type GlobalConfig,
  type SeasonLineupEntry
} from '@/app/lib/loki/season-configs'

// patchOverlaySeasonsWithOverride() stops the baked overlay shadowing a drift heal.

const FIRST_SEASON_START_MS = 1_700_000_000_000
const SEASON_DURATION_SECONDS = 2_419_200 // 28 days
const BUFFER_AFTER_SEASON_END_SECONDS = 86_400 // 1 day
const FIRST_PLAYABLE_SEASON_START_MS =
  FIRST_SEASON_START_MS + BUFFER_AFTER_SEASON_END_SECONDS * 1000

// seasonsElapsed = 4 puts the only non-empty config (c5) in the last future slot.
const SEASONS_ELAPSED = 4
const EXTRACTED_AT = new Date(
  FIRST_PLAYABLE_SEASON_START_MS +
    SEASONS_ELAPSED * SEASON_DURATION_SECONDS * 1000 +
    1_000
).toISOString()

const CAPTURE_SEASON = SEASONS_ELAPSED + 1 - SEASON_NUMBER_OFFSET
const ROTATION_INDEX = (((SEASONS_ELAPSED + ROTATION_INDEX_OFFSET) % 5) + 5) % 5
// Asserts offset 4 routes to c5, so a constant change fails here, not as a silent no-op.
if (ROTATION_INDEX !== 0) {
  throw new Error(
    `test fixture assumption broken: rotationIndex ${ROTATION_INDEX} !== 0 -- recompute SEASONS_ELAPSED`
  )
}
const HEALED_SEASON = CAPTURE_SEASON + 4

const baseOverlaySeason = (
  season: number,
  bossType: string,
  overrides: Partial<SeasonLineupEntry> = {}
): SeasonLineupEntry => ({
  season,
  configId: 'guild_boss_season_config_2',
  configVersion: 'stale-v1',
  // Far older than EXTRACTED_AT, so the test exercises strictly-newer-wins.
  capturedAt: '2000-01-01T00:00:00.000Z',
  loopFromTier: null,
  loopFromSet: null,
  encounters: [
    {
      rarityIndex: 5,
      set: 4,
      encounterIndex: 0,
      encounterType: null,
      bossType,
      unitId: null,
      boardId: null
    }
  ],
  ...overrides
})

const overrideConfig = (): GlobalConfig => ({
  configVersion: 'healed-v2',
  extractedAt: EXTRACTED_AT,
  guildBoss: {
    misc: {
      firstSeasonStart: FIRST_SEASON_START_MS,
      seasonDuration: SEASON_DURATION_SECONDS,
      bufferAfterSeasonEnd: BUFFER_AFTER_SEASON_END_SECONDS
    },
    guildBossSeasonConfigRotation: ['c1', 'c2', 'c3', 'c4', 'c5'],
    guildBossSeasonDataConfigsGDTO: {
      c1: { tiers: [] },
      c2: { tiers: [] },
      c3: { tiers: [] },
      c4: { tiers: [] },
      c5: {
        tiers: [
          {
            sets: [
              {
                set: 4,
                encounters: [
                  { encounterIndex: 0, bossType: 'HealedBoss' },
                  { encounterIndex: 1, bossType: 'HealedBoss' }
                ]
              }
            ]
          }
        ]
      }
    }
  }
})

describe('WI-8230 thread-A: patchOverlaySeasonsWithOverride', () => {
  it('does nothing when the override is not active', () => {
    const seasons = {
      [HEALED_SEASON]: baseOverlaySeason(HEALED_SEASON, 'StaleBoss')
    }
    patchOverlaySeasonsWithOverride(seasons, overrideConfig(), {
      overrideActive: false,
      extractedAt: EXTRACTED_AT
    })
    expect(seasons[HEALED_SEASON]!.encounters[0]!.bossType).toBe('StaleBoss')
  })

  it('replaces a covered season with the override-derived (healed) lineup, and a season it does not cover is untouched', () => {
    const untouchedSeason = HEALED_SEASON - 1
    const seasons: Record<number, SeasonLineupEntry> = {
      [HEALED_SEASON]: baseOverlaySeason(HEALED_SEASON, 'StaleBoss'),
      [untouchedSeason]: baseOverlaySeason(untouchedSeason, 'UnrelatedBoss')
    }

    const result = patchOverlaySeasonsWithOverride(seasons, overrideConfig(), {
      overrideActive: true,
      extractedAt: EXTRACTED_AT
    })

    expect(result[HEALED_SEASON]!.encounters.map((e) => e.bossType)).toEqual([
      'HealedBoss',
      'HealedBoss'
    ])
    expect(result[HEALED_SEASON]!.configVersion).toBe('healed-v2')
    expect(result[HEALED_SEASON]!.configId).toBe('c5')
    expect(Date.parse(result[HEALED_SEASON]!.capturedAt)).toBe(
      Date.parse(EXTRACTED_AT)
    )

    expect(result[untouchedSeason]!.encounters[0]!.bossType).toBe(
      'UnrelatedBoss'
    )
  })

  it('keeps the live partial-loop policy, which arrives as integer strings', () => {
    // loopFromTier/loopFromSet arrive as strings; dropping them makes the planner loop from L1.
    const config = overrideConfig()
    const c5 = config.guildBoss.guildBossSeasonDataConfigsGDTO.c5 as Record<
      string,
      unknown
    >
    c5.loopFromTier = '4'
    c5.loopFromSet = '3'
    const seasons: Record<number, SeasonLineupEntry> = {
      [HEALED_SEASON]: baseOverlaySeason(HEALED_SEASON, 'StaleBoss')
    }

    const result = patchOverlaySeasonsWithOverride(seasons, config, {
      overrideActive: true,
      extractedAt: EXTRACTED_AT
    })

    expect(result[HEALED_SEASON]).toMatchObject({
      loopFromTier: 4,
      loopFromSet: 3
    })
  })

  it('never regresses an overlay entry that is already fresher than the override', () => {
    const seasons: Record<number, SeasonLineupEntry> = {
      [HEALED_SEASON]: baseOverlaySeason(HEALED_SEASON, 'FresherThanOverride', {
        capturedAt: '2099-01-01T00:00:00.000Z'
      })
    }
    const result = patchOverlaySeasonsWithOverride(seasons, overrideConfig(), {
      overrideActive: true,
      extractedAt: EXTRACTED_AT
    })
    expect(result[HEALED_SEASON]!.encounters[0]!.bossType).toBe(
      'FresherThanOverride'
    )
  })

  it('fails soft on a malformed override (missing rotation)', () => {
    const seasons = {
      [HEALED_SEASON]: baseOverlaySeason(HEALED_SEASON, 'StaleBoss')
    }
    const malformed = overrideConfig()
    malformed.guildBoss.guildBossSeasonConfigRotation = []
    const result = patchOverlaySeasonsWithOverride(seasons, malformed, {
      overrideActive: true,
      extractedAt: EXTRACTED_AT
    })
    expect(result[HEALED_SEASON]!.encounters[0]!.bossType).toBe('StaleBoss')
  })
})
