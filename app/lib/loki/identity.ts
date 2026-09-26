// `LOKI_SCRAPER_USER_ID` is authoritative: a legacy per-guild user_id with the shared secret gets
// HTTP 500 on every call, so the legacy row's session is blanked to force a fresh CONNECT.
type LokiIdentityRow = {
  user_id?: string | null
  session_id?: string | null
}

type LokiIdentity = {
  userId: string | null
  /** '' forces CONNECT; null/'' both mean "no usable stored session". */
  sessionId: string
  overrodeLegacyRow: boolean
}

export function resolveLokiIdentity(
  row: LokiIdentityRow | null | undefined,
  env: { userId?: string | null } = {
    userId: process.env.LOKI_SCRAPER_USER_ID
  }
): LokiIdentity {
  const envUserId = env.userId || null
  const rowUserId = row?.user_id || null
  const storedSession = row?.session_id || ''

  if (envUserId) {
    const overrodeLegacyRow = rowUserId !== null && rowUserId !== envUserId
    return {
      userId: envUserId,
      sessionId: overrodeLegacyRow ? '' : storedSession,
      overrodeLegacyRow
    }
  }
  return {
    userId: rowUserId,
    sessionId: storedSession,
    overrodeLegacyRow: false
  }
}
