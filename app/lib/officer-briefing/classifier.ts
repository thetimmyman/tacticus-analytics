// Two gaps on population average damage: execution = expected(used) - actual, selection =
// expected(best fieldable) - expected(used). Never say "wrong team": the member may not have
// owned the better roster at attack time.

import type { Confidence, MemberClassification } from './types'
import {
  MIN_ATTACKS_FOR_VERDICT,
  MED_CONF_ATTACKS,
  HIGH_CONF_ATTACKS,
  classifyConfidence
} from '@/app/lib/calculations/utils/confidence'

export const CLASSIFIER = {
  MIN_ATTACKS: MIN_ATTACKS_FOR_VERDICT,
  /** Relative selection gap below which teams count as equivalent. */
  SELECTION_MARGIN: 0.05,
  /** Relative execution gap at/above which execution needs review. */
  EXECUTION_TAU: 0.15,
  /** Relative margin above best-fieldable expectation that earns recognition. */
  RECOGNIZE_EPS: 0.1,
  HIGH_CONF_ATTACKS,
  MED_CONF_ATTACKS
} as const

export interface ClassifierInput {
  actualAvg: number | null
  /** Population average for the same composition the member used. */
  expectedForUsedTeam: number | null
  /** Population average for the best team fieldable now (0 missing heroes). */
  expectedForBestFieldable: number | null
  battleCount: number
  bestFieldableDiffersFromUsed: boolean
  rosterStale: boolean
}

export interface ClassifierResult {
  classification: MemberClassification
  confidence: Confidence
  executionGap: number | null
  selectionGap: number | null
  readyNowUpside: number | null
  recommendation: string
}

function roundK(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1000)}k`
  return `${Math.round(n)}`
}

function baseConfidence(battleCount: number): Confidence {
  return classifyConfidence(battleCount)
}

export function classifyMemberBoss(input: ClassifierInput): ClassifierResult {
  const {
    actualAvg,
    expectedForUsedTeam,
    expectedForBestFieldable,
    battleCount,
    bestFieldableDiffersFromUsed,
    rosterStale
  } = input

  const executionGap =
    expectedForUsedTeam != null && actualAvg != null
      ? expectedForUsedTeam - actualAvg
      : null
  const selectionGap =
    expectedForBestFieldable != null && expectedForUsedTeam != null
      ? expectedForBestFieldable - expectedForUsedTeam
      : null
  const readyNowUpside =
    expectedForBestFieldable != null && actualAvg != null
      ? Math.max(0, expectedForBestFieldable - actualAvg)
      : null

  if (battleCount < CLASSIFIER.MIN_ATTACKS || actualAvg == null) {
    return {
      classification: 'insufficient_data',
      confidence: 'low',
      executionGap,
      selectionGap,
      readyNowUpside,
      recommendation: `Only ${battleCount} comparable attack${battleCount === 1 ? '' : 's'} — not enough to judge yet.`
    }
  }

  if (
    expectedForBestFieldable != null &&
    actualAvg > expectedForBestFieldable * (1 + CLASSIFIER.RECOGNIZE_EPS)
  ) {
    const pct = Math.round(
      ((actualAvg - expectedForBestFieldable) / expectedForBestFieldable) * 100
    )
    return {
      classification: 'doing_great',
      confidence: baseConfidence(battleCount),
      executionGap,
      selectionGap,
      readyNowUpside,
      recommendation: `~${pct}% above roster-adjusted expectation — recognize the result.`
    }
  }

  const relSelection =
    selectionGap != null && expectedForUsedTeam
      ? selectionGap / expectedForUsedTeam
      : 0
  const relExecution =
    executionGap != null && expectedForUsedTeam
      ? executionGap / expectedForUsedTeam
      : 0

  // Suppressed on a stale roster: "fieldable now" cannot be trusted.
  if (
    relSelection >= CLASSIFIER.SELECTION_MARGIN &&
    bestFieldableDiffersFromUsed &&
    !rosterStale
  ) {
    const upside = readyNowUpside != null ? roundK(readyNowUpside) : '—'
    return {
      classification: 'needs_support_wrong_team',
      confidence:
        battleCount >= CLASSIFIER.HIGH_CONF_ATTACKS ? 'high' : 'medium',
      executionGap,
      selectionGap,
      readyNowUpside,
      recommendation: `A stronger team is available now — projects about +${upside}/attack from heroes they already own. Suggest the team change before reviewing execution.`
    }
  }

  if (relExecution >= CLASSIFIER.EXECUTION_TAU) {
    const gap = executionGap != null ? roundK(executionGap) : '—'
    return {
      classification: 'needs_support_correct_team',
      confidence: baseConfidence(battleCount),
      executionGap,
      selectionGap,
      readyNowUpside,
      recommendation: `On about the best team they can field, but ~${gap}/attack below the population average for it — review execution and tactics.`
    }
  }

  return {
    classification: 'roster_limited',
    confidence: baseConfidence(battleCount),
    executionGap,
    selectionGap,
    readyNowUpside,
    recommendation:
      'Performing about as well as their current roster allows — no stronger team available. No coaching task.'
  }
}
