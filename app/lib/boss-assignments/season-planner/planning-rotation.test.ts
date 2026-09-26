import { describe, it, expect } from 'vitest'
import { resolvePlanningRotation } from '@/app/lib/boss-assignments/season-planner/planning-rotation'
import {
  SEASON_CONFIGS,
  type SeasonConfig
} from '@/app/lib/loki/season-configs'
import type { SeasonRotationSnapshot } from '@/app/lib/loki/rotation-cache'

const liveRotation = (): SeasonRotationSnapshot => ({
  resolvedAt: '2026-01-01T00:00:00.000Z',
  seasonNumber: 99,
  source: 'live',
  currentConfigId: 'live_season_99',
  nextConfigId: '',
  currentBosses: [
    {
      boss_type: 'LiveBoss',
      boss_name: 'Live Boss',
      set: 0,
      encounter_id: 0,
      rarity: 'Legendary',
      canonical: 'liveboss'
    }
  ],
  nextBosses: [],
  matches: 1,
  observedBosses: [],
  notes: null,
  errorReason: null
})

describe('resolvePlanningRotation', () => {
  it('returns the live rotation unchanged when no config is selected', () => {
    const live = liveRotation()
    const resolved = resolvePlanningRotation({
      configId: null,
      liveRotation: live
    })
    expect(resolved.rotation).toBe(live)
    expect(resolved.seasonId).toBe('live_season_99')
  })

  it('ignores an empty / whitespace config id', () => {
    const live = liveRotation()
    expect(
      resolvePlanningRotation({ configId: '   ', liveRotation: live }).rotation
    ).toBe(live)
  })

  it('ignores an unknown config id (falls back to live)', () => {
    const live = liveRotation()
    const resolved = resolvePlanningRotation({
      configId: 'not-a-real-config',
      liveRotation: live
    })
    expect(resolved.rotation).toBe(live)
    expect(resolved.seasonId).toBe('live_season_99')
  })

  it('substitutes a known non-live config’s bosses (planning-only forecast)', () => {
    const chosen = SEASON_CONFIGS.at(-1)
    expect(chosen).toBeDefined()
    expect(chosen!.bosses.length).toBeGreaterThan(0)

    const live = liveRotation()
    const resolved = resolvePlanningRotation({
      configId: chosen!.id,
      liveRotation: live
    })

    expect(resolved.seasonId).toBe(chosen!.id)
    expect(resolved.rotation?.currentConfigId).toBe(chosen!.id)
    expect(resolved.rotation?.currentBosses).toEqual(chosen!.bosses)
    expect(resolved.rotation?.currentBosses).not.toEqual(live.currentBosses)
  })

  it('prefers a season lineup overlay over raw sliding-window config content', () => {
    const raw = SEASON_CONFIGS[0]!
    const overlay: SeasonConfig = {
      id: raw.id,
      canonicalOrder: ['overlayboss'],
      bosses: [
        {
          boss_type: 'OverlayBoss',
          boss_name: 'Overlay Boss',
          set: 0,
          encounter_id: 0,
          rarity: 'Legendary',
          canonical: 'overlayboss'
        }
      ]
    }

    const resolved = resolvePlanningRotation({
      configId: raw.id,
      seasonConfig: overlay,
      liveRotation: liveRotation()
    })

    expect(resolved.seasonId).toBe(raw.id)
    expect(resolved.rotation?.currentBosses).toEqual(overlay.bosses)
    expect(resolved.rotation?.currentBosses).not.toEqual(raw.bosses)
  })

  it('works when there is no live rotation (synthesises a base)', () => {
    const chosen = SEASON_CONFIGS[0]!
    const resolved = resolvePlanningRotation({
      configId: chosen.id,
      liveRotation: null
    })
    expect(resolved.rotation?.currentBosses).toEqual(chosen.bosses)
    expect(resolved.rotation?.currentConfigId).toBe(chosen.id)
  })
})
