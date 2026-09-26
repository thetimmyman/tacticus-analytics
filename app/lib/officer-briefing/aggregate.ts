import type { MemberAnalysisSummary } from './analyze-member'
import {
  MIN_ATTACKS_FOR_VERDICT,
  hasSufficientAttacks
} from '@/app/lib/calculations/utils/confidence'
import type { MemberSignalRow } from './types'

export interface NormRow {
  displayName: string
  bossName: string
  encounterId: number
  battleCount: number
  vsGuild: number | null
}

export interface MemberAgg {
  displayName: string
  battleCount: number
  worstVsGuildPct: number | null
  worstBossName: string | null
  worstEncounterId: number | null
  worstBattleCount: number | null
  bestVsGuildPct: number | null
}

// Only rows with enough attacks can become worst/best, so a 1-attack fluke never tops the list.
export function aggregate(rows: NormRow[]): Map<string, MemberAgg> {
  const map = new Map<string, MemberAgg>()
  for (const r of rows) {
    if (!r.displayName) continue
    const agg =
      map.get(r.displayName) ??
      ({
        displayName: r.displayName,
        battleCount: 0,
        worstVsGuildPct: null,
        worstBossName: null,
        worstEncounterId: null,
        worstBattleCount: null,
        bestVsGuildPct: null
      } satisfies MemberAgg)
    agg.battleCount += r.battleCount ?? 0
    const vs = r.vsGuild
    if (vs != null && hasSufficientAttacks(r.battleCount)) {
      if (agg.worstVsGuildPct == null || vs < agg.worstVsGuildPct) {
        agg.worstVsGuildPct = vs
        agg.worstBossName = r.bossName
        agg.worstEncounterId = r.encounterId
        agg.worstBattleCount = r.battleCount
      }
      if (agg.bestVsGuildPct == null || vs > agg.bestVsGuildPct) {
        agg.bestVsGuildPct = vs
      }
    }
    map.set(r.displayName, agg)
  }
  return map
}

// Signed % vs best-fieldable expectation; shared so the list and detail panel agree.
export function rosterAdjustedPct(
  actualAvg: number | null | undefined,
  expectedForBestFieldable: number | null | undefined
): number | null {
  if (actualAvg == null || !expectedForBestFieldable) return null
  return (
    ((actualAvg - expectedForBestFieldable) / expectedForBestFieldable) * 100
  )
}

export function reconcileNeedsReview(
  candidates: MemberSignalRow[],
  verdicts: Map<string, MemberAnalysisSummary>
): MemberSignalRow[] {
  return candidates.filter((row) => {
    const h = verdicts.get(row.displayName)?.headline
    if (!h) return true
    if (
      h.classification === 'doing_great' ||
      h.classification === 'roster_limited' ||
      h.classification === 'insufficient_data'
    ) {
      return false
    }
    row.classification = h.classification
    row.readyNowUpside = h.readyNowUpside
    row.confidence = h.confidence
    row.recommendation = h.recommendation
    row.swaps = h.swaps
    row.worstBossName = h.bossName
    row.worstEncounterId = h.encounterId
    row.worstBattleCount = h.battleCount
    const pct = rosterAdjustedPct(h.actualAvg, h.expectedForBestFieldable)
    if (pct != null) row.rosterAdjustedPct = pct
    return true
  })
}

export const MIN_MEMBER_ATTACKS_FOR_OFFICER_BRIEFING = MIN_ATTACKS_FOR_VERDICT
