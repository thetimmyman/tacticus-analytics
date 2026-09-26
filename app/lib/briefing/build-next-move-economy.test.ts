import { describe, it, expect } from 'vitest'
import {
  buildNextMoveEconomyInputs,
  type BossValueRow,
  type UpcomingMain
} from '@/app/lib/briefing/build-next-move-economy'

// boss_name is the raw type token ("MagnusTheRed").
const valueRows: BossValueRow[] = [
  { bossName: 'MagnusTheRed', encounterId: 0, yourAvg: 100_000 },
  { bossName: 'TervigonLeviathan', encounterId: 0, yourAvg: 150_000 },
  { bossName: 'MagnusTheRed', encounterId: 1, yourAvg: 50_000 },
  { bossName: 'Mortarion', encounterId: 0, yourAvg: null }
]

function upcoming(over: Partial<UpcomingMain> = {}): UpcomingMain {
  return {
    name: 'tervigon',
    bossType: 'TervigonLeviathan',
    displayName: 'Tervigon (Leviathan)',
    stageCode: 'M2',
    loopIndex: 0,
    etaSeconds: 10 * 3600,
    etaSource: 'history',
    ...over
  }
}

describe('buildNextMoveEconomyInputs', () => {
  it('resolves current-boss value by the raw token (LandingPageBossOverview.name)', () => {
    const r = buildNextMoveEconomyInputs({
      currentBossName: 'MagnusTheRed',
      valueRows,
      upcomingMains: []
    })
    expect(r.currentBossValue).toBe(100_000)
  })

  it('matches an upcoming boss to history via the raw boss_type token', () => {
    const r = buildNextMoveEconomyInputs({
      currentBossName: 'MagnusTheRed',
      valueRows,
      upcomingMains: [upcoming({ bossType: 'TervigonLeviathan' })]
    })
    expect(r.alternatives).toHaveLength(1)
    expect(r.alternatives[0]!.value).toBe(150_000)
    expect(r.alternatives[0]!.displayName).toBe('Tervigon (Leviathan)')
    expect(r.alternatives[0]!.etaSeconds).toBe(10 * 3600)
  })

  it('does NOT bleed a sibling variant value across the lossy canonical', () => {
    // Same canonical "tervigon", different bosses.
    const rows: BossValueRow[] = [
      { bossName: 'TervigonGorgon', encounterId: 0, yourAvg: 140_000 }
    ]
    const r = buildNextMoveEconomyInputs({
      currentBossName: 'MagnusTheRed',
      valueRows: rows,
      upcomingMains: [
        upcoming({ name: 'tervigon', bossType: 'TervigonLeviathan' })
      ]
    })
    expect(r.alternatives[0]!.value).toBeNull()
  })

  it('matches the correct variant when the raw tokens agree', () => {
    const rows: BossValueRow[] = [
      { bossName: 'TervigonGorgon', encounterId: 0, yourAvg: 140_000 }
    ]
    const r = buildNextMoveEconomyInputs({
      currentBossName: 'MagnusTheRed',
      valueRows: rows,
      upcomingMains: [
        upcoming({ name: 'tervigon', bossType: 'TervigonGorgon' })
      ]
    })
    expect(r.alternatives[0]!.value).toBe(140_000)
  })

  it('matches a SHORT-form EOT name via the canonical fallback (boss_type differs)', () => {
    const rows: BossValueRow[] = [
      { bossName: 'Magnus', encounterId: 0, yourAvg: 120_000 }
    ]
    const r = buildNextMoveEconomyInputs({
      currentBossName: 'Magnus',
      valueRows: rows,
      upcomingMains: [upcoming({ name: 'magnus', bossType: 'MagnusTheRed' })]
    })
    expect(r.alternatives[0]!.value).toBe(120_000)
  })

  it('unmatched upcoming boss → null value (cannot drive a hold) + passes display through', () => {
    const r = buildNextMoveEconomyInputs({
      currentBossName: 'MagnusTheRed',
      valueRows,
      upcomingMains: [
        upcoming({
          name: 'screamer_killer',
          bossType: 'ScreamerKiller',
          displayName: ''
        })
      ]
    })
    expect(r.alternatives[0]!.value).toBeNull()
    expect(r.alternatives[0]!.displayName).toBe('Screamer Killer')
  })

  it('ignores prime rows and null averages in the value map', () => {
    const r = buildNextMoveEconomyInputs({
      currentBossName: 'Mortarion', // only a null-avg main row exists
      valueRows,
      upcomingMains: []
    })
    expect(r.currentBossValue).toBeNull()
  })

  it('current value is null when the player has no history on that boss', () => {
    const r = buildNextMoveEconomyInputs({
      currentBossName: 'Ghazghkull',
      valueRows,
      upcomingMains: []
    })
    expect(r.currentBossValue).toBeNull()
  })
})
