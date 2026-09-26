// Deno port of the roster matching/scoring in app/api/meta/optimize/route.ts.

export interface RosterHero {
  name: string
  rarity?: string
  stars?: number
}

export interface TeamComposition {
  heroes: string[]
  mow: string | null
}

export function parseTeamComposition(composition: string): TeamComposition {
  const parts = composition.split(' + ')
  const herosPart = parts[0] || ''
  const mow = parts[1]?.trim() || null
  const heroes = herosPart
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
  return { heroes, mow }
}

export function calculateRosterCoverage(
  teamHeroes: string[],
  rosterSet: Set<string>
): { score: number; missing: string[] } {
  const missing: string[] = []
  let matched = 0

  for (const hero of teamHeroes) {
    const normalizedHero = hero.toLowerCase()
    let found = false
    if (rosterSet.has(normalizedHero)) {
      found = true
    } else {
      for (const rosterHero of rosterSet) {
        if (
          rosterHero.includes(normalizedHero) ||
          normalizedHero.includes(rosterHero)
        ) {
          found = true
          break
        }
      }
    }

    if (found) {
      matched++
    } else {
      missing.push(hero)
    }
  }

  const total = teamHeroes.length
  return {
    score: total > 0 ? (matched / total) * 100 : 0,
    missing
  }
}

export interface AssignmentScoreParams {
  damageP90: number
  coverageScore: number
  preference: 'preferred' | 'avoid' | 'neutral'
  reliability: number // 0-100
  weights?: {
    damage: number
    preference: number
    reliability: number
  }
}

export function calculateAssignmentScore(
  params: AssignmentScoreParams
): number {
  const weights = params.weights || {
    damage: 1.0,
    preference: 0.5,
    reliability: 0.2
  }

  // Linear scale with 1M as the "good" baseline.
  const normalizedDamage = params.damageP90 / 1_000_000

  const coverageFactor = params.coverageScore / 100

  let preferenceScore = 0
  if (params.preference === 'preferred') preferenceScore = 1
  if (params.preference === 'avoid') preferenceScore = -1 // Significant penalty

  const reliabilityFactor = params.reliability / 100

  // Damage is scaled by coverage: without the heroes the damage prediction is invalid.
  const baseScore = normalizedDamage * coverageFactor * weights.damage

  const finalScore =
    baseScore +
    preferenceScore * weights.preference +
    reliabilityFactor * weights.reliability

  return Math.max(0, finalScore) // Ensure non-negative score for LP solvers
}
