// A Loki request URL carries `userId/<id>/sessionId/<session>`, and a session
// belongs to the one account whose CONNECT minted it. The only account this
// app can CONNECT as is the shared scraper (LOKI_SCRAPER_USER_ID with
// LOKI_SCRAPER_CLIENT_SECRET), so every request is sent as that account and
// carries only a session that account minted.

export type LokiSessionRow = {
  user_id?: string | null
  session_id?: string | null
}

/** A session together with the account whose CONNECT minted it. */
export type LokiSessionPair = {
  userId: string
  sessionId: string
}

export type LokiSessionAccount = {
  /** The account every request is sent as; null when no scraper id is configured. */
  userId: string | null
  /** A session that account minted; '' forces a CONNECT. */
  sessionId: string
  /** The row names another account, so its stored session is never sent. */
  overrodeLegacyRow: boolean
}

/**
 * A guild row's own user_id is never sent: no secret for it exists here. The
 * row's stored session is reused only when the scraper owns the row (user_id
 * null or the scraper id), and a pre-minted session only when it was minted
 * for the scraper id.
 */
export function resolveLokiSessionAccount(
  row: LokiSessionRow | null | undefined,
  scraperUserId: string | null | undefined,
  mintedSession: LokiSessionPair | null = null
): LokiSessionAccount {
  const userId = scraperUserId || null
  const rowUserId = row?.user_id || null
  if (!userId) {
    return { userId: null, sessionId: '', overrodeLegacyRow: false }
  }
  const overrodeLegacyRow = rowUserId !== null && rowUserId !== userId
  if (mintedSession?.sessionId && mintedSession.userId === userId) {
    return { userId, sessionId: mintedSession.sessionId, overrodeLegacyRow }
  }
  return {
    userId,
    sessionId: overrodeLegacyRow ? '' : row?.session_id || '',
    overrodeLegacyRow
  }
}

/**
 * PostgREST `or` filter for a session mirror write: the session lands only on
 * rows the minting account owns, never on a row that names another account.
 */
export function lokiSessionOwnerFilter(userId: string): string {
  return `user_id.is.null,user_id.eq.${userId}`
}
