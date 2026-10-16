// Requests go out only as `LOKI_SCRAPER_USER_ID`: a legacy per-guild user_id has no secret here
// (with the shared one LOKI 500s every call), so its row's session is blanked to force a fresh CONNECT.
import {
  resolveLokiSessionAccount,
  type LokiSessionAccount,
  type LokiSessionRow
} from '@/supabase/functions/_shared/loki-session-account'

export function resolveLokiIdentity(
  row: LokiSessionRow | null | undefined,
  env: { userId?: string | null } = {
    userId: process.env.LOKI_SCRAPER_USER_ID
  }
): LokiSessionAccount {
  return resolveLokiSessionAccount(row, env.userId)
}
