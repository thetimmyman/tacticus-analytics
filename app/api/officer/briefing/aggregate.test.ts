import { describe, it, expect } from 'vitest'
import {
  aggregate,
  reconcileNeedsReview,
  type NormRow
} from '@/app/lib/officer-briefing/aggregate'
import type { MemberSignalRow } from '@/app/lib/officer-briefing/types'
import type { MemberAnalysisSummary } from '@/app/lib/officer-briefing/analyze-member'
import type { MemberBossVerdict } from '@/app/lib/officer-briefing/types'

const row = (over: Partial<NormRow>): NormRow => ({
  displayName: 'SyntheticMember',
  bossName: 'Magnus',
  encounterId: 0,
  battleCount: 5,
  vsGuild: -30,
  ...over
})

describe('officer-briefing aggregate() — per-boss confidence gate', () => {
  it('a 1-attack boss can NOT become the worst signal', () => {
    const agg = aggregate([
      row({
        bossName: 'RogalDorn',
        encounterId: 0,
        vsGuild: -73,
        battleCount: 1
      }),
      row({ bossName: 'Magnus', encounterId: 0, vsGuild: -25, battleCount: 8 })
    ])
    const k = agg.get('SyntheticMember')!
    // The confident boss (8 attacks) is the worst signal, NOT the -73 fluke.
    expect(k.worstVsGuildPct).toBe(-25)
    expect(k.worstBossName).toBe('Magnus')
    expect(k.worstBattleCount).toBe(8)
    expect(k.battleCount).toBe(9)
  })

  it('member with only sub-floor bosses has a null worst signal (drops from list)', () => {
    const agg = aggregate([
      row({ bossName: 'Lion', vsGuild: -50, battleCount: 1 })
    ])
    const m = agg.get('SyntheticMember')!
    expect(m.worstVsGuildPct).toBeNull()
    expect(m.worstBossName).toBeNull()
    expect(m.worstBattleCount).toBeNull()
    expect(m.battleCount).toBe(1)
  })

  it('a 2-attack boss now qualifies as the worst signal (floor = 2)', () => {
    const agg = aggregate([
      row({ bossName: 'Lion', vsGuild: -50, battleCount: 2 }),
      row({ bossName: 'Magnus', vsGuild: -10, battleCount: 8 })
    ])
    const m = agg.get('SyntheticMember')!
    expect(m.worstVsGuildPct).toBe(-50)
    expect(m.worstBattleCount).toBe(2)
  })

  it('a confident boss surfaces normally', () => {
    const agg = aggregate([
      row({ bossName: 'Lion', vsGuild: -40, battleCount: 5 })
    ])
    const m = agg.get('SyntheticMember')!
    expect(m.worstVsGuildPct).toBe(-40)
    expect(m.worstBattleCount).toBe(5)
  })

  it('recognition is symmetric: a 1-attack fluke cannot earn bestVsGuildPct', () => {
    const agg = aggregate([
      row({ bossName: 'Riptide', vsGuild: 200, battleCount: 1 }),
      row({ bossName: 'Magnus', vsGuild: 10, battleCount: 6 })
    ])
    const m = agg.get('SyntheticMember')!
    expect(m.bestVsGuildPct).toBe(10) // not the +200 single-attack fluke
  })
})

function candidate(over: Partial<MemberSignalRow> = {}): MemberSignalRow {
  return {
    displayName: 'MemberA',
    worstVsGuildPct: -35,
    bestVsGuildPct: 5,
    battleCount: 13,
    worstBossName: 'Lion',
    worstEncounterId: 0,
    worstBattleCount: 13,
    tokenCapRisk: false,
    estimatedCapWaste: null,
    bucket: 'needs_review',
    ...over
  }
}

function verdict(over: Partial<MemberBossVerdict> = {}): MemberBossVerdict {
  return {
    bossName: 'Magnus',
    bossType: 'Magnus',
    encounterId: 0,
    rarity: 'M1',
    classification: 'needs_support_wrong_team',
    confidence: 'high',
    actualAvg: 800_000,
    expectedForUsedTeam: 900_000,
    expectedForBestFieldable: 1_000_000,
    executionGap: 100_000,
    selectionGap: 100_000,
    readyNowUpside: 200_000,
    teamUsed: null,
    bestFieldable: null,
    usedTeamHash: 'used-hash',
    recommendedTeamHash: 'best-hash',
    swaps: [],
    battleCount: 6,
    recommendation: 'x',
    ...over
  }
}

const summary = (
  displayName: string,
  headline: MemberBossVerdict | null
): MemberAnalysisSummary => ({
  displayName,
  verdicts: headline ? [headline] : [],
  headline,
  rosterSyncedAt: null
})

describe('reconcileNeedsReview — list matches the detail panel', () => {
  it('roster doing-great member dropped from needs-support', () => {
    const verdicts = new Map([
      [
        'MemberA',
        summary(
          'MemberA',
          verdict({ classification: 'doing_great', actualAvg: 1_150_000 })
        )
      ]
    ])
    expect(reconcileNeedsReview([candidate()], verdicts)).toHaveLength(0)
  })

  it('drops roster_limited and insufficient_data too', () => {
    expect(
      reconcileNeedsReview(
        [candidate({ displayName: 'A' }), candidate({ displayName: 'B' })],
        new Map([
          ['A', summary('A', verdict({ classification: 'roster_limited' }))],
          ['B', summary('B', verdict({ classification: 'insufficient_data' }))]
        ])
      )
    ).toHaveLength(0)
  })

  it('keeps a genuine coaching case and rewrites its metric/boss from the verdict', () => {
    const verdicts = new Map([['MemberA', summary('MemberA', verdict())]])
    const [out] = reconcileNeedsReview([candidate()], verdicts)
    expect(out!.classification).toBe('needs_support_wrong_team')
    expect(out!.worstBossName).toBe('Magnus') // overwritten to match the detail headline
    expect(out!.worstBattleCount).toBe(6)
    expect(out!.readyNowUpside).toBe(200_000)
    expect(out!.rosterAdjustedPct).toBeCloseTo(-20)
  })

  it('keeps the cheap vs-guild signal when the engine returned no headline (degraded)', () => {
    const [out] = reconcileNeedsReview(
      [candidate()],
      new Map([['MemberA', summary('MemberA', null)]])
    )
    expect(out!.worstBossName).toBe('Lion')
    expect(out!.classification).toBeUndefined()
    expect(out!.rosterAdjustedPct).toBeUndefined()
  })

  it('keeps a candidate entirely absent from the verdicts map (engine failure)', () => {
    expect(reconcileNeedsReview([candidate()], new Map())).toHaveLength(1)
  })
})
