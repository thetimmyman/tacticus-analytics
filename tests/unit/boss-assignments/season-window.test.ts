import { describe, it, expect } from 'vitest'
import {
  buildSeasonWindowNumbers,
  buildSeasonWindowOptions,
  resolveSeasonConfigId,
  resolveSelectedSeason,
  seasonWindowLabel,
  type SeasonConfigResolution
} from '@/app/(dashboard)/boss-assignments/_lib/season-window'

// The +1 season is selectable; a lagging cluster defaults to its own latest season.
describe('boss-assignments season window (review-gate fixes)', () => {
  describe('buildSeasonWindowNumbers', () => {
    it('force-includes the selected season after the rotation window', () => {
      expect(buildSeasonWindowNumbers([101, 102, 103], '107')).toEqual([
        101, 102, 103, 107
      ])
    })
  })

  describe('buildSeasonWindowOptions', () => {
    it('makes the +1 (upcoming) season selectable', () => {
      const options = buildSeasonWindowOptions([101, 102, 103, 104, 105], 103)
      const values = options.map((o) => o.value)
      expect(values).toContain('104')
      expect(options.find((o) => o.value === '104')?.label).toBe('Next · S104')
      expect(options.find((o) => o.value === '103')?.label).toBe('Live · S103')
    })

    it('always includes the cluster live season even when it is below the window', () => {
      const options = buildSeasonWindowOptions([101, 102, 103, 104, 105], 100)
      const values = options.map((o) => o.value)
      expect(values).toContain('100')
      expect(values).toEqual(['100', '101', '102', '103', '104', '105'])
      expect(options.find((o) => o.value === '100')?.label).toBe('Live · S100')
    })

    it('de-dupes and drops non-positive / non-finite seasons', () => {
      const options = buildSeasonWindowOptions([0, -1, NaN, 102, 102, 103], 103)
      expect(options.map((o) => o.value)).toEqual(['102', '103'])
    })
  })

  describe('seasonWindowLabel is relative to the cluster live season', () => {
    it('labels prior / live / next relative to clusterMax, not the global max', () => {
      expect(seasonWindowLabel(99, 100)).toBe('Prior · S99')
      expect(seasonWindowLabel(100, 100)).toBe('Live · S100')
      expect(seasonWindowLabel(101, 100)).toBe('Next · S101')
      expect(seasonWindowLabel(103, 100)).toBe('S103')
    })
  })

  describe('resolveSelectedSeason (interactive-vs-planning discriminant)', () => {
    it('clusterMax < globalMax: default (no ?season) lands on the interactive queue at clusterMax', () => {
      const res = resolveSelectedSeason(null, '100')
      expect(res.selectedSeason).toBe('100')
      expect(res.isLiveSeason).toBe(true)
    })

    it('selecting the global max on a lagging cluster is planning-only (not live)', () => {
      const res = resolveSelectedSeason('103', '100')
      expect(res.selectedSeason).toBe('103')
      expect(res.isLiveSeason).toBe(false)
    })

    it('selecting a past OR upcoming season is planning-only', () => {
      expect(resolveSelectedSeason('99', '100').isLiveSeason).toBe(false)
      expect(resolveSelectedSeason('101', '100').isLiveSeason).toBe(false)
    })

    it('explicitly selecting the live season is interactive', () => {
      const res = resolveSelectedSeason('100', '100')
      expect(res.isLiveSeason).toBe(true)
    })

    it('treats empty override as no override (default to live)', () => {
      expect(resolveSelectedSeason('', '100').selectedSeason).toBe('100')
      expect(resolveSelectedSeason(undefined, '100').isLiveSeason).toBe(true)
    })

    it('normalizes explicit season strings before comparing to live', () => {
      const res = resolveSelectedSeason('00100', '100')
      expect(res.selectedSeason).toBe('100')
      expect(res.isLiveSeason).toBe(true)
    })

    it('drops malformed overrides instead of passing them downstream', () => {
      const res = resolveSelectedSeason('101abc', '100')
      expect(res.selectedSeason).toBe('100')
      expect(res.isLiveSeason).toBe(true)
    })
  })

  describe('resolveSeasonConfigId', () => {
    const resolutions: SeasonConfigResolution[] = [
      { seasonNumber: 103, configId: 'cfg_a' },
      { seasonNumber: 104, configId: 'cfg_b' },
      { seasonNumber: 105, configId: 'cfg_c' }
    ]

    it('maps a season number (number or string) to its config id', () => {
      expect(resolveSeasonConfigId(resolutions, 104)).toBe('cfg_b')
      expect(resolveSeasonConfigId(resolutions, '105')).toBe('cfg_c')
    })

    it('returns null for an uncovered or non-numeric season', () => {
      expect(resolveSeasonConfigId(resolutions, 999)).toBeNull()
      expect(resolveSeasonConfigId(resolutions, 'latest')).toBeNull()
    })
  })
})
