import { describe, it, expect } from 'vitest'
import {
  GLOBAL_CONFIG,
  getSeasonConfigForSeasonNumber,
  getSeasonLineup,
  getSeasonPosition,
  getSeasonProgressionConfig,
  prettyBossName,
  SEASON_DURATION_SECONDS,
  SEASON_GAP_SECONDS,
  SEASON_NUMBER_OFFSET,
  SEASON_LINEUP_RANGE
} from '@/app/lib/loki/season-configs'

describe('season lineup overlay', () => {
  it('exposes a contiguous captured range that includes the current window', () => {
    expect(SEASON_LINEUP_RANGE).not.toBeNull()
    expect(SEASON_LINEUP_RANGE!.min).toBeLessThanOrEqual(103)
    expect(SEASON_LINEUP_RANGE!.max).toBeGreaterThanOrEqual(105)
  })

  it('covers the GlobalConfig capture season and the next season', () => {
    const capturedAt = GLOBAL_CONFIG.extractedAt
    const configVersion = GLOBAL_CONFIG.configVersion
    if (typeof capturedAt !== 'string' || typeof configVersion !== 'string') {
      throw new Error('Bundled GlobalConfig is missing capture metadata')
    }
    const { seasonNumber } = getSeasonPosition(Date.parse(capturedAt))

    expect(
      getSeasonLineup(seasonNumber),
      `capture season S${seasonNumber} is missing`
    ).not.toBeNull()
    expect(
      getSeasonLineup(seasonNumber + 1),
      `next season S${seasonNumber + 1} is missing`
    ).toMatchObject({ configVersion })
  })

  it('does not roll the runtime season forward during the inter-season gap', () => {
    const misc = GLOBAL_CONFIG.guildBoss?.misc
    if (!misc || typeof misc.firstSeasonStart !== 'number') {
      throw new Error('Bundled GlobalConfig is missing season timing metadata')
    }
    const season107Start =
      misc.firstSeasonStart +
      SEASON_GAP_SECONDS * 1000 +
      (107 + SEASON_NUMBER_OFFSET - 1) * SEASON_DURATION_SECONDS * 1000
    const season108Start = season107Start + SEASON_DURATION_SECONDS * 1000

    expect(getSeasonPosition(season108Start - 1).seasonNumber).toBe(107)
    expect(getSeasonPosition(season108Start).seasonNumber).toBe(108)
  })

  it('resolves S105 to the live (v1.40) lineup, not the stale window', () => {
    const s105 = getSeasonLineup(105)
    expect(s105).not.toBeNull()
    const topTier = Math.max(
      ...s105!.encounters.map((e) => e.rarityIndex ?? -1)
    )
    const topBosses = s105!.encounters
      .filter((e) => e.rarityIndex === topTier && e.encounterIndex === 0)
      .map((e) => e.bossType)
      .sort()
    expect(topBosses).toEqual(['Magnus', 'Mortarion'])
  })

  it('converts captured lineups to the SeasonConfig shape used by historical slot resolution', () => {
    const config = getSeasonConfigForSeasonNumber(105)
    expect(config).not.toBeNull()
    const topTier = config!.bosses
      .filter((boss) => boss.rarity === 'Mythic' && boss.encounter_id === 0)
      .map((boss) => boss.boss_type)
      .sort()
    expect(topTier).toEqual(['Magnus', 'Mortarion'])
  })

  it('preserves a historical season from the earlier snapshot window', () => {
    const s102 = getSeasonLineup(102)
    expect(s102).not.toBeNull()
    expect(s102!.encounters.length).toBeGreaterThan(0)
  })

  it('captures S111 as config 2 with its full-loop progression policy', () => {
    // Baked values omit loopFromSet; the live override re-derives future seasons.
    const s111 = getSeasonLineup(111)
    expect(s111).toMatchObject({
      season: 111,
      configId: 'guild_boss_season_config_2',
      loopFromTier: 4,
      loopFromSet: null
    })
    expect(s111!.encounters.length).toBeGreaterThan(0)

    const progression = getSeasonProgressionConfig(111)
    expect(progression).not.toBeNull()
    expect(progression!.loopSequence).toEqual(progression!.firstPassSequence)
    expect(progression!.loopStartStage).toBe('L1')
  })

  it('returns null outside the captured range', () => {
    expect(getSeasonLineup(9999)).toBeNull()
  })

  it('displays reworked Belisarius tokens as Belisarius Cawl', () => {
    expect(prettyBossName('BelisariusRW')).toBe('Belisarius Cawl')
    expect(prettyBossName('Belisarius')).toBe('Belisarius Cawl')
  })
})
