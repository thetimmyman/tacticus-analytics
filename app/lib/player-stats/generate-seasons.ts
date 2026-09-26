/** Up to `count` seasons back from the current one, skipping any <= 0. */
export function generateSeasons(currentSeason: string, count = 10): string[] {
  const currentSeasonNum = parseInt(currentSeason, 10)
  const seasons: string[] = []
  for (let i = 0; i < count; i += 1) {
    const seasonNum = currentSeasonNum - i
    if (seasonNum > 0) {
      seasons.push(seasonNum.toString())
    }
  }
  return seasons
}
