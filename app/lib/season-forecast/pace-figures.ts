// The pace-model outlook first, else the caller's envelope figures (sim timeout, past season, feature off).

import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'
import type { PlayerTokenPaceRow } from '@/app/lib/season-forecast/season-token-economy'
import type { SeasonForecastPlayerRow } from '@/app/lib/season-forecast/forecast-service'

export type SpendableCapSource = 'pace' | 'envelope'

export interface SpendableCapFigures {
  source: SpendableCapSource
  spendableByEnd: number
  capBoundPlayers: number
  estimatedCapWaste: number
}

export type SpendableCapOutlook = Pick<
  SeasonOutlookProjection,
  'tokensRemaining' | 'playersAtCapRisk' | 'projectedWaste'
>

export function selectSpendableCapFigures(args: {
  outlook: SpendableCapOutlook | null | undefined
  envelope: {
    spendableByEnd: number
    capBoundPlayers: number
    estimatedCapWaste: number
  }
}): SpendableCapFigures {
  const { outlook, envelope } = args
  if (outlook) {
    return {
      source: 'pace',
      spendableByEnd: outlook.tokensRemaining,
      capBoundPlayers: outlook.playersAtCapRisk,
      estimatedCapWaste: outlook.projectedWaste
    }
  }
  return {
    source: 'envelope',
    spendableByEnd: envelope.spendableByEnd,
    capBoundPlayers: envelope.capBoundPlayers,
    estimatedCapWaste: envelope.estimatedCapWaste
  }
}

export interface CapRiskEntry {
  displayName: string
  estimatedCapWaste: number
}

/** Empty pace rows over a non-empty modeled roster mean "nobody at risk". Envelope rows are used when
 * paceRows is null or the modeled roster was empty (a broken mapping must not read as "no risk"). */
export function selectCapRiskEntries(args: {
  paceRows: PlayerTokenPaceRow[] | null | undefined
  paceMemberCount?: number | null
  envelopeRows: SeasonForecastPlayerRow[]
}): { source: SpendableCapSource; entries: CapRiskEntry[] } {
  const paceModeledRoster =
    args.paceRows &&
    (args.paceRows.length > 0 || (args.paceMemberCount ?? 0) > 0)
  if (args.paceRows && paceModeledRoster) {
    return {
      source: 'pace',
      entries: args.paceRows
        .filter((row) => row.atCapRisk)
        .map((row) => ({
          displayName: row.displayName,
          estimatedCapWaste: Math.round(row.projectedWaste)
        }))
    }
  }
  return {
    source: 'envelope',
    entries: args.envelopeRows
      .filter((row) => row.will_cap)
      .map((row) => ({
        displayName: row.display_name,
        estimatedCapWaste: row.estimated_cap_waste
      }))
  }
}

/** Live facts from the envelope row, projection fields from the pace row; null without an envelope row. */
export function mergePlayerProjection(
  envelopeRow: SeasonForecastPlayerRow | null | undefined,
  paceRow: PlayerTokenPaceRow | null | undefined
): SeasonForecastPlayerRow | null {
  if (!envelopeRow) return null
  if (!paceRow) return envelopeRow
  return {
    ...envelopeRow,
    tokens_at_season_end: Math.round(paceRow.tokensRemaining),
    will_cap: paceRow.atCapRisk,
    estimated_cap_waste: Math.round(paceRow.projectedWaste)
  }
}
