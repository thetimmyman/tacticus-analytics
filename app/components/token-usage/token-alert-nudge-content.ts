/** Copy and slide synthesis for the token-alert nudge, framework-free for tests. */

import type { NewsItem } from '@/app/components/landing/NewsBanner'

/** Embla keys slides by `item.id`; a changing id remounts the slide. */
export const TOKEN_ALERT_NUDGE_ID = 'wi4000-token-alert-nudge'

export const ALERT_SETTINGS_HREF = '/profile'

/** Discord OAuth on /profile, not /profile/edit (read-only mirror once linked). */
export const DISCORD_LINK_HREF = '/profile#connected-accounts'

/** Must survive `truncate` on the slide. */
export const TOKEN_ALERT_NUDGE_TITLE = "Get DM'd before your tokens cap"

export function tokenAlertNudgeDescription(linked: boolean): string {
  return linked
    ? 'Turn on token alerts in your profile'
    : 'Link Discord to enable token alerts'
}

export function tokenAlertNudgeCta(linked: boolean): string {
  return linked ? 'Turn on token alerts' : 'Link your Discord account'
}

export function tokenAlertNudgeHref(linked: boolean): string {
  return linked ? ALERT_SETTINGS_HREF : DISCORD_LINK_HREF
}

/** `type: 'feature'` gets the "New feature" label. */
export function buildTokenAlertNewsItem(linked: boolean): NewsItem {
  return {
    id: TOKEN_ALERT_NUDGE_ID,
    type: 'feature',
    title: TOKEN_ALERT_NUDGE_TITLE,
    description: tokenAlertNudgeDescription(linked),
    href: tokenAlertNudgeHref(linked)
  }
}

/**
 * Append after admin items (time-sensitive, keep slide 1). Always an array; all
 * fields are required so `dismissed` cannot be forgotten.
 */
export function withTokenAlertSlide(
  items: NewsItem[] | undefined,
  {
    eligible,
    linked,
    dismissed
  }: { eligible: boolean; linked: boolean; dismissed: boolean }
): NewsItem[] {
  const base = items ?? []
  if (!eligible || dismissed) return base
  return [...base, buildTokenAlertNewsItem(linked)]
}
