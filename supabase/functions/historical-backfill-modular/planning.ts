/** Choose the newest missing historical seasons within the supported window. */
export function planHistoricalSeasons(input: {
  currentSeason: number
  existingSeasons: number[]
  maxSeasons: number
  lookbackSeasons: number
}): number[] {
  const existing = new Set(input.existingSeasons)
  const count = Math.min(input.maxSeasons, input.lookbackSeasons)
  const start = Math.max(1, input.currentSeason - count)
  const seasons: number[] = []
  for (let season = input.currentSeason - 1; season >= start; season--) {
    if (!existing.has(season)) seasons.push(season)
  }
  return seasons
}
