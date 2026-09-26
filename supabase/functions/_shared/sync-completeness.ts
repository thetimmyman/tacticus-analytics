/** A successful request is not proof that every upstream row was persisted. */
export function isCompleteRaidWrite(input: {
  sourceEntries: number
  visitedEntries: number
  acceptedEntries: number
  upsertedEntries: number
  errors: number
  seasonValid: boolean
}): boolean {
  const counts = [
    input.sourceEntries,
    input.visitedEntries,
    input.acceptedEntries,
    input.upsertedEntries,
    input.errors
  ]
  return (
    input.seasonValid &&
    counts.every((n) => Number.isSafeInteger(n) && n >= 0) &&
    input.errors === 0 &&
    input.visitedEntries === input.sourceEntries &&
    input.acceptedEntries === input.sourceEntries &&
    input.upsertedEntries === input.sourceEntries
  )
}

/** Historical callers must never count a lock skip or a different season. */
export function isCompleteHistoricalSync(
  data: unknown,
  season: number
): boolean {
  if (!data || typeof data !== 'object') return false
  const value = data as Record<string, unknown>
  if (
    value.success !== true ||
    value.partial === true ||
    value.skipped ||
    value.error ||
    value.season !== season
  )
    return false
  const historical = value.historical as
    { requestedSeason?: unknown } | undefined
  const stats = value.stats as Record<string, unknown> | undefined
  if (historical?.requestedSeason !== season || !stats) return false
  const count = stats.totalEntries
  return (
    typeof count === 'number' &&
    Number.isSafeInteger(count) &&
    count >= 0 &&
    stats.finalValidEntries === count &&
    stats.processedEntries === count &&
    stats.upsertedEntries === count &&
    stats.errorEntries === 0
  )
}
