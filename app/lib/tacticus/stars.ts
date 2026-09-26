const PROGRESSION_TO_STARS = [
  0, // 0: unlock
  1,
  2,
  2, // 3: Uncommon promotion, no star
  3,
  4,
  4, // 6: Rare promotion, no star
  5,
  6,
  6, // 9: Epic promotion, no star
  7,
  8,
  8, // 12: Legendary promotion, no star
  9,
  10,
  11,
  11, // 16: Mythic promotion, no star
  12,
  13,
  14
] as const

export function getStarsFromProgressionIndex(progressionIndex: number): number {
  if (progressionIndex < 0) return 0
  if (progressionIndex > 19) return 13
  return PROGRESSION_TO_STARS[progressionIndex] ?? 0
}

/** The API's starLevel is authoritative; older snapshots omit it, and
 *  progressionIndex is lossless for 0-19. */
export function resolveRosterStars(
  starLevel: unknown,
  progressionIndex: unknown
): number {
  if (typeof starLevel === 'number' && Number.isFinite(starLevel)) {
    return starLevel
  }
  return getStarsFromProgressionIndex(
    typeof progressionIndex === 'number' && Number.isFinite(progressionIndex)
      ? progressionIndex
      : 0
  )
}
