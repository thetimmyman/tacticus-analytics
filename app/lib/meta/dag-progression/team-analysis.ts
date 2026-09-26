import {
  buildRosterLookup,
  evaluateStrengthState,
  type OwnershipState,
  type StrengthState,
  type StrengthThresholds
} from '@/app/lib/meta/roster-strength'
import type { RosterInputEntry } from '@/app/lib/meta/roster-input'
import { parseTeamComposition } from '@/app/lib/meta/team-coverage'
import type {
  MetaTeamProgressionState,
  UpgradeStep
} from '@/app/lib/meta/types'
import type {
  DagEdgeRow,
  HeroScoreEntry,
  RosterUnitMaps,
  TeamEntry
} from './types'

// Module scope: normalizeUnitName is on a per-hero hot path.
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]/g

export const normalizeUnitName = (value: string): string =>
  value.trim().toLowerCase().replace(NON_ALPHANUMERIC_PATTERN, '')

const STRENGTH_STATE_PRIORITY: Record<StrengthState, number> = {
  Locked: 0,
  Weak: 1,
  Suitable: 2,
  Strong: 3,
  Optimal: 4,
  Invalid: 5
}

const pickWorstStrengthState = (
  current: StrengthState | null,
  incoming: StrengthState
): StrengthState => {
  if (!current) return incoming
  return STRENGTH_STATE_PRIORITY[incoming] < STRENGTH_STATE_PRIORITY[current]
    ? incoming
    : current
}

const buildUnitKeyMap = (composition: string): Map<string, string> => {
  const map = new Map<string, string>()
  const parsed = parseTeamComposition(composition)
  parsed.units.forEach((unit) => {
    const key = normalizeUnitName(unit)
    if (key) {
      map.set(key, unit)
    }
  })
  return map
}

const findSingleSwap = (
  fromComposition: string,
  toComposition: string
): { swappedOut: string; swappedIn: string } | null => {
  const fromMap = buildUnitKeyMap(fromComposition)
  const toMap = buildUnitKeyMap(toComposition)
  const fromKeys = new Set(fromMap.keys())
  const toKeys = new Set(toMap.keys())
  const removed = Array.from(fromKeys).filter((key) => !toKeys.has(key))
  const added = Array.from(toKeys).filter((key) => !fromKeys.has(key))
  if (removed.length !== 1 || added.length !== 1) {
    return null
  }
  const removedKey = removed[0]
  const addedKey = added[0]
  if (!removedKey || !addedKey) {
    return null
  }
  return {
    swappedOut: fromMap.get(removedKey) ?? removedKey,
    swappedIn: toMap.get(addedKey) ?? addedKey
  }
}

export const buildMetaTeamEdges = (teams: TeamEntry[]): DagEdgeRow[] => {
  const sorted = [...teams].sort((a, b) => {
    if (b.damageP90 !== a.damageP90) return b.damageP90 - a.damageP90
    return a.team_hash.localeCompare(b.team_hash)
  })
  const edges: DagEdgeRow[] = []
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]
    if (!current) {
      continue
    }
    for (let j = 0; j < i; j += 1) {
      const candidate = sorted[j]
      if (!candidate) {
        continue
      }
      if (candidate.damageP90 <= current.damageP90) continue
      const swap = findSingleSwap(current.composition, candidate.composition)
      if (!swap) continue
      edges.push({
        from_team_hash: current.team_hash,
        to_team_hash: candidate.team_hash,
        swapped_out: swap.swappedOut,
        swapped_in: swap.swappedIn,
        from_damage_p90: current.damageP90,
        to_damage_p90: candidate.damageP90,
        damage_gain: candidate.damageP90 - current.damageP90
      })
      break
    }
  }
  return edges
}

export const resolveTeamProgressState = (
  composition: string,
  rosterLookup: ReturnType<typeof buildRosterLookup>,
  strengthThresholds: StrengthThresholds | null
): MetaTeamProgressionState | null => {
  const units = parseTeamComposition(composition).units
  if (units.length === 0) return null
  let worstState: StrengthState | null = null
  let ownedFallback = false

  for (const unit of units) {
    const entry = rosterLookup.find(unit)
    if (!entry) {
      return 'Locked'
    }
    if (
      !strengthThresholds ||
      strengthThresholds.source === 'none' ||
      !rosterLookup.hasStrengthData
    ) {
      ownedFallback = true
      continue
    }
    const state = evaluateStrengthState(entry.raw, strengthThresholds)
    if (!state || state === 'Invalid') {
      ownedFallback = true
      continue
    }
    worstState = pickWorstStrengthState(worstState, state)
  }

  if (worstState) return worstState
  return ownedFallback ? 'Owned' : null
}

export function collectRosterUnits(
  roster: RosterInputEntry[] | null | undefined,
  knownMows: Set<string>
): RosterUnitMaps {
  const heroMap = new Map<string, string>()
  const mowMap = new Map<string, string>()

  for (const entry of roster || []) {
    const rawName =
      typeof entry === 'string'
        ? entry
        : entry.name || entry.engineId || entry.id || ''
    if (!rawName) continue
    const normalized = normalizeUnitName(rawName)
    if (!normalized) continue
    const category = typeof entry === 'object' ? entry.category : null
    const categoryLabel =
      typeof category === 'string' ? category.toLowerCase() : ''
    const isMow =
      knownMows.has(normalized) ||
      categoryLabel === 'mow' ||
      categoryLabel.includes('machine')
    const targetMap = isMow ? mowMap : heroMap
    if (!targetMap.has(normalized)) {
      targetMap.set(normalized, rawName.trim())
    }
  }

  return {
    heroMap,
    mowMap,
    ownedUnits: new Set([...heroMap.keys(), ...mowMap.keys()])
  }
}

export function buildHeroScores(
  teams: TeamEntry[],
  rosterLookup: ReturnType<typeof buildRosterLookup>
): Map<string, HeroScoreEntry> {
  const scores = new Map<string, HeroScoreEntry>()

  for (const team of teams) {
    const parsed = parseTeamComposition(team.composition)
    for (const hero of parsed.heroes) {
      const normalized = normalizeUnitName(hero)
      if (!normalized || !rosterLookup.find(hero)) continue
      const existing = scores.get(normalized)
      if (existing) {
        existing.score += team.damageP90
      } else {
        scores.set(normalized, {
          name: hero,
          score: team.damageP90,
          isMow: false
        })
      }
    }
    if (parsed.mow) {
      const normalized = normalizeUnitName(parsed.mow)
      if (!normalized || !rosterLookup.find(parsed.mow)) continue
      const existing = scores.get(normalized)
      if (existing) {
        existing.score += team.damageP90
      } else {
        scores.set(normalized, {
          name: parsed.mow,
          score: team.damageP90,
          isMow: true
        })
      }
    }
  }

  return scores
}

export function findTopTeam(teams: TeamEntry[]): TeamEntry | null {
  let top: TeamEntry | null = null
  for (const team of teams) {
    if (!top || team.damageP90 > top.damageP90) {
      top = team
    }
  }
  return top
}

export function findClosestTeamByOverlap(
  teams: TeamEntry[],
  composition: string
): TeamEntry | null {
  const baseline = parseTeamComposition(composition)
  const baselineUnits = new Set(
    baseline.units.map((unit) => normalizeUnitName(unit)).filter(Boolean)
  )
  let best: TeamEntry | null = null
  let bestOverlap = -1

  for (const team of teams) {
    const parsed = parseTeamComposition(team.composition)
    const overlap = parsed.units.reduce((count, unit) => {
      const normalized = normalizeUnitName(unit)
      if (normalized && baselineUnits.has(normalized)) {
        return count + 1
      }
      return count
    }, 0)
    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap && best && team.damageP90 > best.damageP90)
    ) {
      bestOverlap = overlap
      best = team
    }
  }

  return best
}

export function buildSyntheticUpgradePath(options: {
  baselineComposition: string
  baselineDamage: number
  targetTeam: TeamEntry
  heroScores: Map<string, HeroScoreEntry>
  rosterLookup: ReturnType<typeof buildRosterLookup>
  compositionLookup: Map<string, TeamEntry>
  startIndex?: number
}): { path: UpgradeStep[]; totalIncrease: number } {
  const {
    baselineComposition,
    baselineDamage,
    targetTeam,
    heroScores,
    rosterLookup,
    compositionLookup
  } = options

  const baselineParts = parseTeamComposition(baselineComposition)
  const targetParts = parseTeamComposition(targetTeam.composition)
  let currentHeroes = [...baselineParts.heroes]
  let currentMow = baselineParts.mow
  let currentDamage = baselineDamage
  let stepIndex = options.startIndex ?? 0

  const scoreFor = (name: string) =>
    heroScores.get(normalizeUnitName(name))?.score ?? 0
  const baselineSet = new Set(
    currentHeroes.map((hero) => normalizeUnitName(hero))
  )
  const targetSet = new Set(
    targetParts.heroes.map((hero) => normalizeUnitName(hero))
  )

  const missingHeroes = targetParts.heroes.filter(
    (hero) => !baselineSet.has(normalizeUnitName(hero))
  )
  const extraHeroes = currentHeroes.filter(
    (hero) => !targetSet.has(normalizeUnitName(hero))
  )

  missingHeroes.sort((a, b) => scoreFor(b) - scoreFor(a))
  extraHeroes.sort((a, b) => scoreFor(a) - scoreFor(b))

  const path: UpgradeStep[] = []

  const pushStep = (
    fromTeam: string,
    toTeam: string,
    swapOut: string,
    swapIn: string
  ) => {
    const normalized = normalizeTeamComposition(toTeam)
    const matched = compositionLookup.get(normalized)
    const nextDamage = matched?.damageP90 ?? currentDamage
    const rawIncrease = nextDamage - currentDamage
    const percentIncrease =
      currentDamage > 0 ? (rawIncrease / currentDamage) * 100 : 0
    const roundedIncrease = Math.round(rawIncrease)
    const roundedPercent = Math.round(percentIncrease * 10) / 10
    const roundedDamage = Math.round(nextDamage)
    const isOwned = rosterLookup.find(swapIn) !== null
    const ownershipState: OwnershipState = isOwned ? 'owned' : 'missing'

    stepIndex += 1
    path.push({
      step_index: stepIndex,
      from_team: fromTeam,
      to_team: toTeam,
      swapped_out: swapOut,
      swapped_in: swapIn,
      swap_out: swapOut,
      swap_in: swapIn,
      damage_increase: roundedIncrease,
      damage_gain: roundedIncrease,
      percent_increase: roundedPercent,
      new_damage_p90: roundedDamage,
      meta_team: matched?.metaTeam ?? null,
      is_owned: isOwned,
      ownership_state: ownershipState,
      strength_state: null,
      power: null,
      power_source: null,
      required_power: null,
      strength_score: null,
      threshold_source: null,
      next_node_id: ''
    })

    currentDamage = nextDamage
  }

  for (let i = 0; i < missingHeroes.length; i += 1) {
    const swapIn = missingHeroes[i]
    const swapOut = extraHeroes[i] ?? currentHeroes[0] ?? ''
    if (!swapOut || !swapIn) continue

    const fromTeam = [
      currentHeroes.join(', '),
      currentMow ? ` + ${currentMow}` : ''
    ]
      .filter(Boolean)
      .join('')
    const updatedHeroes = [...currentHeroes]
    const swapIndex = updatedHeroes.findIndex(
      (hero) => normalizeUnitName(hero) === normalizeUnitName(swapOut)
    )
    if (swapIndex >= 0) {
      updatedHeroes[swapIndex] = swapIn
    }
    currentHeroes = updatedHeroes
    const toTeam = [
      currentHeroes.join(', '),
      currentMow ? ` + ${currentMow}` : ''
    ]
      .filter(Boolean)
      .join('')

    pushStep(fromTeam, toTeam, swapOut, swapIn)
  }

  if (
    targetParts.mow &&
    normalizeUnitName(targetParts.mow) !== normalizeUnitName(currentMow || '')
  ) {
    const fromTeam = [
      currentHeroes.join(', '),
      currentMow ? ` + ${currentMow}` : ''
    ]
      .filter(Boolean)
      .join('')
    const swapOut = currentMow || 'Open Slot'
    const swapIn = targetParts.mow
    currentMow = targetParts.mow
    const toTeam = [
      currentHeroes.join(', '),
      currentMow ? ` + ${currentMow}` : ''
    ]
      .filter(Boolean)
      .join('')
    pushStep(fromTeam, toTeam, swapOut, swapIn)
  }

  const totalIncrease = path.reduce(
    (sum, step) => sum + step.damage_increase,
    0
  )
  return { path, totalIncrease }
}

export function parseTeamHeroes(composition: string): string[] {
  const parts = composition.split(' + ')
  const heroesPart = parts[0] || ''
  const mowPart = parts[1]?.trim() || null
  const heroes = heroesPart
    .split(',')
    .map((hero) => hero.trim().toLowerCase())
    .filter(Boolean)
  if (mowPart) {
    heroes.push(mowPart.toLowerCase())
  }
  return heroes
}

export function normalizeTeamComposition(composition: string): string {
  const trimmed = composition.trim()
  if (!trimmed) return trimmed
  const parts = trimmed.split(' + ')
  const heroesPart = parts[0] || ''
  const mowPart = parts[1]?.trim() || null
  const heroes = heroesPart
    .split(',')
    .map((hero) => hero.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
  return heroes.length > 0
    ? `${heroes.join(', ')}${mowPart ? ` + ${mowPart}` : ''}`
    : trimmed
}
