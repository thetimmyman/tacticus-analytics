export async function readGuildSeasons(
  fetchSeasons: () => Promise<{
    data: unknown
    error: { message: string } | null
  }>
): Promise<number[]> {
  const { data, error } = await fetchSeasons()
  if (error) throw new Error(`Could not read guild seasons: ${error.message}`)
  if (!Array.isArray(data)) {
    throw new Error('Could not read guild seasons: response was not an array')
  }

  const seasons: number[] = []
  for (const value of data) {
    if (
      typeof value !== 'number' &&
      !(typeof value === 'string' && /^\d+$/.test(value))
    ) {
      throw new Error(
        'Could not read guild seasons: response contained an invalid season'
      )
    }
    const season = Number(value)
    if (!Number.isSafeInteger(season) || season <= 0) {
      throw new Error(
        'Could not read guild seasons: response contained an invalid season'
      )
    }
    seasons.push(season)
  }
  return [...new Set(seasons)].sort((a, b) => b - a)
}
