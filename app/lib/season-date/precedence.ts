/** A non-empty URL season wins; null means no season resolved, so pages show "unavailable". */
export function resolveEffectiveSeason(
  urlSeason: string | undefined,
  fallback: string | null
): string | null {
  return urlSeason || fallback
}
