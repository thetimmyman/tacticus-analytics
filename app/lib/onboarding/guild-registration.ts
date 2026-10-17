export type GuildRegistrationRow = {
  onboarding_source?: string | null
  onboarding_completed?: boolean | null
}

/**
 * True when a guild_config row holds its code for good, so create-config must refuse it. A scraped
 * leaderboard row may be claimed, and a standard row whose onboarding never finished may be retried.
 */
export function isGuildRegistrationFinal(
  row: GuildRegistrationRow | null | undefined
): boolean {
  if (!row) return false
  const source = row.onboarding_source
  if (source === 'scraped_leaderboard') return false
  const isIncompleteOnboarding =
    !row.onboarding_completed && (source === 'standard' || source === null)
  return !isIncompleteOnboarding
}
