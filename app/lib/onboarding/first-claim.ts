import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('onboarding.first-claim')

type SeatRow = {
  user_id: string | null
  role: string | null
  is_app_admin: boolean | null
}

/** Mirrors mint_bootstrap_seat_invite's `lower(role) IN ('leader','officer')` and the claim-seat gate. */
const INVITE_CAPABLE_ROLES = new Set(['leader', 'officer'])

// Linked app admins also close the corridor: the RPC's peer check includes `is_app_admin`.

const REGISTRATION_AUTHORITY_SOURCE_PATH =
  'onboarding/guild-registration/bootstrap-authority'

/** The server-written receipt behind the seat route's H1 gate; null when absent. */
async function findRegistrationReceipt(
  serviceClient: TypedSupabaseClient,
  userId: string,
  guildCode?: string | null
): Promise<{
  receipt: { id: number } | null
  error: { message: string } | null
}> {
  let query = serviceClient
    .from('player_claim_audit')
    .select('id')
    .eq('user_id', userId)
  if (guildCode) query = query.eq('guild_code', guildCode)
  const { data, error } = await query
    .eq('source_path', REGISTRATION_AUTHORITY_SOURCE_PATH)
    .eq('outcome', 'success')
    .limit(1)
    .maybeSingle()
  return { receipt: data as { id: number } | null, error }
}

/** Whether this account's proved guild-key custody receipt exists (fails closed). */
export async function hasGuildRegistrationReceipt(
  serviceClient: TypedSupabaseClient,
  userId: string,
  guildCode?: string | null
): Promise<boolean> {
  const { receipt, error } = await findRegistrationReceipt(
    serviceClient,
    userId,
    guildCode
  )
  if (error) {
    logger.warn(
      { userId, error: error.message },
      'Registration receipt lookup failed; treating the account as unverified'
    )
    return false
  }
  return receipt !== null
}

/** Same predicate as mint_bootstrap_seat_invite (keep in step): no linked leader/officer/admin
 * and a non-empty roster. Fails closed on lookup errors. */
export async function isGuildAwaitingFirstClaim(
  serviceClient: TypedSupabaseClient,
  guildCode: string | null,
  registrarUserId?: string
): Promise<boolean> {
  if (!guildCode) return false

  // One roster read: the DB compares `lower(role)`, which `.in()` cannot express.
  const { data, error } = await guildRosterQuery(
    serviceClient,
    guildCode,
    'user_id, role, is_app_admin'
  )

  if (error) {
    logger.warn(
      { guildCode, error: error.message },
      'First-claim roster lookup failed; treating the guild as bootstrapped'
    )
    return false
  }

  const roster = (data ?? []) as SeatRow[]
  if (roster.length === 0) return false

  // A verified registrar keeps the right to self-link. The receipt is
  // server-written; onboarding_progress is browser-editable, so it is not used.
  if (registrarUserId) {
    const { receipt, error: receiptError } = await findRegistrationReceipt(
      serviceClient,
      registrarUserId,
      guildCode
    )

    if (receiptError) {
      logger.warn(
        { guildCode, registrarUserId, error: receiptError.message },
        'Registrar authority lookup failed; hiding the self-link corridor'
      )
      return false
    }
    if (receipt) return true
  }

  return !roster.some(
    (row) =>
      row.user_id !== null &&
      (INVITE_CAPABLE_ROLES.has((row.role ?? '').toLowerCase()) ||
        row.is_app_admin === true)
  )
}
