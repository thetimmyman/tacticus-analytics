import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SEASON_LOOP_POLICY,
  deriveProgressionConfig,
  getStageSequence,
  ladderStagesFromEncounters,
  nextStage,
  resolveSeasonLoopPolicy,
  stageCodeFromTierAndSet
} from '@/app/lib/boss-assignments/progression-config-shared'
import {
  getSeasonLineup,
  getSeasonLoopPolicy,
  getSeasonProgressionConfig,
  SEASON_LINEUPS
} from '@/app/lib/loki/season-configs'

// Loop policy is per season because the game mutates season configs in place.

const enc = (rarityIndex: number, set: number, encounterIndex: number) => ({
  rarityIndex,
  set,
  encounterIndex
})

describe('resolveSeasonLoopPolicy', () => {
  it('accepts the numeric STRINGS the game config actually ships', () => {
    // Values arrive as strings; a strict number check would silently drop the policy.
    expect(
      resolveSeasonLoopPolicy({ loopFromTier: '4', loopFromSet: '3' })
    ).toEqual({
      loopFromTier: 4,
      loopFromSet: 3,
      defaulted: false
    })
  })

  it('accepts plain numbers', () => {
    expect(
      resolveSeasonLoopPolicy({ loopFromTier: 4, loopFromSet: 0 })
    ).toEqual({
      loopFromTier: 4,
      loopFromSet: 0,
      defaulted: false
    })
  })

  it('defaults a pre-field snapshot to the full-ladder L1 loop and flags it', () => {
    expect(resolveSeasonLoopPolicy({})).toEqual(DEFAULT_SEASON_LOOP_POLICY)
    expect(resolveSeasonLoopPolicy(null)).toEqual(DEFAULT_SEASON_LOOP_POLICY)
    expect(
      resolveSeasonLoopPolicy({ loopFromTier: null, loopFromSet: null })
        .defaulted
    ).toBe(true)
  })

  it('defaults only the missing half of a partial policy, still flagged', () => {
    expect(resolveSeasonLoopPolicy({ loopFromTier: 5 })).toEqual({
      loopFromTier: 5,
      loopFromSet: 0,
      defaulted: true
    })
  })

  it('treats non-numeric junk as absent rather than NaN', () => {
    const policy = resolveSeasonLoopPolicy({
      loopFromTier: 'legendary',
      loopFromSet: ''
    })
    expect(policy).toEqual(DEFAULT_SEASON_LOOP_POLICY)
  })
})

describe('stageCodeFromTierAndSet', () => {
  it('maps rarity index + 0-indexed set to a stage code', () => {
    expect(stageCodeFromTierAndSet(4, 0)).toBe('L1')
    expect(stageCodeFromTierAndSet(4, 3)).toBe('L4')
    expect(stageCodeFromTierAndSet(5, 2)).toBe('M3')
  })

  it('returns null outside the tracked Legendary/Mythic ladder', () => {
    expect(stageCodeFromTierAndSet(3, 0)).toBeNull()
    expect(stageCodeFromTierAndSet(4, -1)).toBeNull()
  })
})

describe('ladderStagesFromEncounters', () => {
  it('keeps only Legendary/Mythic main bosses, in play order, deduped', () => {
    const stages = ladderStagesFromEncounters([
      enc(5, 1, 0),
      enc(4, 1, 0),
      enc(4, 1, 1), // prime — not a stage
      enc(3, 0, 0), // Epic — not a tracked ladder stage
      enc(4, 0, 0),
      enc(5, 0, 0),
      enc(4, 1, 0) // duplicate
    ])
    expect(stages).toEqual(['L1', 'L2', 'M1', 'M2'])
  })

  it('is empty for a lineup with no Legendary/Mythic main bosses', () => {
    expect(ladderStagesFromEncounters([enc(0, 0, 0), enc(4, 0, 1)])).toEqual([])
  })
})

describe('deriveProgressionConfig', () => {
  const FULL = ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2', 'M3']

  it('loops only the top five bosses under the current (4, 3) policy', () => {
    const cfg = deriveProgressionConfig({
      stages: FULL,
      policy: { loopFromTier: 4, loopFromSet: 3, defaulted: false }
    })
    expect(cfg.loopSequence).toEqual(['L4', 'L5', 'M1', 'M2', 'M3'])
    expect(cfg.loopStartStage).toBe('L4')
  })

  it('still plays L1-L3 on the first pass', () => {
    const cfg = deriveProgressionConfig({
      stages: FULL,
      policy: { loopFromTier: 4, loopFromSet: 3, defaulted: false }
    })
    expect(getStageSequence(cfg, 0)).toEqual(FULL)
    expect(getStageSequence(cfg, 1)).not.toContain('L1')
    expect(getStageSequence(cfg, 1)).not.toContain('L3')
  })

  it('wraps from the last stage back to the loop start, not to L1', () => {
    const cfg = deriveProgressionConfig({
      stages: FULL,
      policy: { loopFromTier: 4, loopFromSet: 3, defaulted: false }
    })
    expect(nextStage(cfg, 'M3', 0)).toEqual({
      stageCode: 'L4',
      loopIndex: 1,
      wrapsLoop: true
    })
    expect(nextStage(cfg, 'L5', 1)).toEqual({
      stageCode: 'M1',
      loopIndex: 1,
      wrapsLoop: false
    })
  })

  it('reproduces the legacy full loop under the (4, 0) policy', () => {
    const cfg = deriveProgressionConfig({
      stages: FULL,
      policy: { loopFromTier: 4, loopFromSet: 0, defaulted: false }
    })
    expect(cfg.loopSequence).toEqual(FULL)
    expect(cfg.loopStartStage).toBe('L1')
  })

  it('rejects a policy that names a stage this season lacks', () => {
    expect(() =>
      deriveProgressionConfig({
        stages: ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2'],
        policy: { loopFromTier: 5, loopFromSet: 2, defaulted: false }
      })
    ).toThrow('Progression loop start M3 is absent from the season ladder')
  })

  it('rejects an empty ladder instead of synthesizing L1', () => {
    expect(() =>
      deriveProgressionConfig({
        stages: [],
        policy: { loopFromTier: 4, loopFromSet: 0, defaulted: true }
      })
    ).toThrow('Cannot derive progression config from an empty ladder')
  })

  it('rejects an unknown current stage instead of resetting to L1', () => {
    const cfg = deriveProgressionConfig({
      stages: FULL,
      policy: { loopFromTier: 4, loopFromSet: 3, defaulted: false }
    })

    expect(() => nextStage(cfg, 'M4', 0)).toThrow(
      'Stage M4 is absent from the progression sequence for loop 0'
    )
  })
})

describe('season-lineups overlay carries the live policy', () => {
  // Positive controls: the overlay must load non-null values for later assertions to mean anything.
  const seasons = Object.values(SEASON_LINEUPS.seasons)

  it('is populated', () => {
    expect(seasons.length).toBeGreaterThanOrEqual(10)
  })

  it('has at least one season with a policy actually read from the game config', () => {
    const explicit = seasons.filter(
      (s) => !resolveSeasonLoopPolicy(s).defaulted
    )
    expect(explicit.length).toBeGreaterThan(0)
  })

  it('has at least one season whose loop is genuinely shorter than its first pass', () => {
    const truncated = seasons.filter((s) => {
      const cfg = getSeasonProgressionConfig(s.season)
      return (
        cfg !== null && cfg.loopSequence.length < cfg.firstPassSequence.length
      )
    })
    expect(truncated.length).toBeGreaterThan(0)
  })

  it('resolves S107 to the five-boss loop', () => {
    expect(getSeasonLineup(107)).not.toBeNull()
    expect(getSeasonLoopPolicy(107)).toEqual({
      loopFromTier: 4,
      loopFromSet: 3,
      defaulted: false
    })
    const cfg = getSeasonProgressionConfig(107)
    expect(cfg!.firstPassSequence).toEqual([
      'L1',
      'L2',
      'L3',
      'L4',
      'L5',
      'M1',
      'M2',
      'M3'
    ])
    expect(cfg!.loopSequence).toEqual(['L4', 'L5', 'M1', 'M2', 'M3'])
  })

  it('leaves historical seasons on the full loop they actually played', () => {
    // S101-S105 predate loopFromSet and S106 carries (4, 0); both loop the whole ladder.
    for (const season of [101, 102, 103, 104, 105, 106]) {
      const cfg = getSeasonProgressionConfig(season)
      expect(cfg, `season ${season} missing from overlay`).not.toBeNull()
      expect(cfg!.loopSequence, `season ${season} loop changed`).toEqual(
        cfg!.firstPassSequence
      )
      expect(cfg!.loopStartStage, `season ${season} loop start changed`).toBe(
        'L1'
      )
    }
  })

  it('reverts to the full loop on S110, because the policy is per-config', () => {
    // Not a one-way cutover: S110/S111 carry (4, 0) and loop L1-L5 again.
    const cfg = getSeasonProgressionConfig(110)
    expect(cfg!.loopSequence).toEqual(cfg!.firstPassSequence)
  })

  it('returns null for a season outside the captured range', () => {
    expect(getSeasonProgressionConfig(9999)).toBeNull()
  })

  it('never yields a degenerate empty ladder for a covered season', () => {
    // An empty config makes getSeasonProgressionConfig return null; no covered season may trip it.
    for (const entry of seasons) {
      const cfg = getSeasonProgressionConfig(entry.season)
      expect(cfg, `season ${entry.season} degenerated to null`).not.toBeNull()
      expect(cfg!.firstPassSequence.length).toBeGreaterThan(0)
      expect(cfg!.loopSequence.length).toBeGreaterThan(0)
    }
  })
})
