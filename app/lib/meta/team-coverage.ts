// Shared by the optimizer and Officer's Briefing; the Deno edge copy is pinned by fixture-parity tests.

export function parseTeamComposition(composition: string): {
  heroes: string[]
  mow: string | null
  units: string[]
} {
  const parts = composition.split(' + ')
  const heroPart = parts[0] ?? ''
  const mow = parts[1]?.trim() || null
  const heroes = heroPart
    .split(',')
    .map((hero) => hero.trim())
    .filter(Boolean)
  const units = mow ? [...heroes, mow] : [...heroes]
  return { heroes, mow, units }
}

/** Score 0-100; substring matching absorbs short-name vs catalog-name drift. */
export function calculateCoverage(
  teamHeroes: string[],
  roster: Set<string>
): { score: number; missing: string[] } {
  const missing: string[] = []
  let matched = 0

  for (const hero of teamHeroes) {
    const normalizedHero = hero.toLowerCase()
    let found = false
    for (const rosterHero of roster) {
      if (
        rosterHero.toLowerCase() === normalizedHero ||
        rosterHero.toLowerCase().includes(normalizedHero) ||
        normalizedHero.includes(rosterHero.toLowerCase())
      ) {
        found = true
        matched++
        break
      }
    }
    if (!found) {
      missing.push(hero)
    }
  }

  const total = teamHeroes.length
  return {
    score: total > 0 ? (matched / total) * 100 : 0,
    missing
  }
}
