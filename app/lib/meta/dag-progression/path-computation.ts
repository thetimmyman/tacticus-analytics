import {
  buildRosterLookup,
  evaluateStrengthState,
  type OwnershipState,
  type StrengthState,
  type StrengthThresholds
} from '@/app/lib/meta/roster-strength'
import type { UpgradeStep } from '@/app/lib/meta/types'
import type { DagEdgeRow, TeamEntry } from './types'

// Runaway guard; real rosters converge in under ~20 steps.
const MAX_UPGRADE_STEPS = 50 as const

export type PathComputationContext = {
  edgeMap: Map<string, DagEdgeRow>
  teamLookup: Map<string, TeamEntry>
  rosterLookup: ReturnType<typeof buildRosterLookup>
  strengthThresholds: StrengthThresholds | null
}

export type PathComputationResult = {
  path: UpgradeStep[]
  finalHash: string
  totalIncrease: number
}

export function computePathFromTeam(
  startHash: string,
  ctx: PathComputationContext
): PathComputationResult {
  const { edgeMap, teamLookup, rosterLookup, strengthThresholds } = ctx
  const path: UpgradeStep[] = []
  let currentHash = startHash
  let steps = 0

  while (steps < MAX_UPGRADE_STEPS) {
    const edge = edgeMap.get(currentHash)
    if (!edge) break

    const fromTeam = teamLookup.get(edge.from_team_hash)
    const toTeam = teamLookup.get(edge.to_team_hash)

    if (!fromTeam || !toTeam) break

    const fromDamage = edge.from_damage_p90 ?? fromTeam.damageP90
    const toDamage = edge.to_damage_p90 ?? toTeam.damageP90
    const rawIncrease = edge.damage_gain ?? toDamage - fromDamage
    if (!Number.isFinite(rawIncrease) || rawIncrease < 0) break
    const percentIncrease =
      fromDamage > 0 ? (rawIncrease / fromDamage) * 100 : 0
    const roundedIncrease = Math.round(rawIncrease)
    const roundedPercent = Math.round(percentIncrease * 10) / 10
    const roundedDamage = Math.round(toDamage)

    const matchedRosterEntry = rosterLookup.find(edge.swapped_in)
    const ownershipState: OwnershipState | null = rosterLookup.hasEntries
      ? matchedRosterEntry
        ? 'owned'
        : 'missing'
      : null
    const isOwned = rosterLookup.hasEntries ? Boolean(matchedRosterEntry) : null
    const power = matchedRosterEntry?.power ?? null
    const powerSource = matchedRosterEntry?.powerSource ?? null
    const thresholdSource = strengthThresholds?.source ?? null
    const requiredPower = strengthThresholds?.suitable ?? null
    let strengthState: StrengthState | null = null

    if (rosterLookup.hasEntries && ownershipState === 'missing') {
      strengthState = 'Locked'
    } else if (
      rosterLookup.hasEntries &&
      strengthThresholds &&
      rosterLookup.hasStrengthData
    ) {
      if (!matchedRosterEntry) {
        strengthState = 'Locked'
      } else if (power == null) {
        strengthState = 'Invalid'
      } else {
        strengthState = evaluateStrengthState(
          matchedRosterEntry.raw,
          strengthThresholds
        )
      }
    }

    const strengthScore =
      power != null && strengthThresholds?.optimal
        ? Math.min(100, Math.round((power / strengthThresholds.optimal) * 100))
        : (matchedRosterEntry?.strengthScore ?? null)

    path.push({
      step_index: steps + 1,
      from_team: fromTeam.composition,
      to_team: toTeam.composition,
      swapped_out: edge.swapped_out,
      swapped_in: edge.swapped_in,
      swap_out: edge.swapped_out,
      swap_in: edge.swapped_in,
      damage_increase: roundedIncrease,
      damage_gain: roundedIncrease,
      percent_increase: roundedPercent,
      new_damage_p90: roundedDamage,
      meta_team: toTeam.metaTeam,
      is_owned: isOwned,
      ownership_state: ownershipState,
      strength_state: strengthState,
      power,
      power_source: powerSource,
      required_power: requiredPower,
      strength_score: strengthScore,
      threshold_source: thresholdSource,
      next_node_id: edge.to_team_hash
    })

    currentHash = edge.to_team_hash
    steps += 1
  }

  const totalIncrease = path.reduce(
    (sum, step) => sum + step.damage_increase,
    0
  )
  return { path, finalHash: currentHash, totalIncrease }
}
