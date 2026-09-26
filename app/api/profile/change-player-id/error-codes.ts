/** Exhaustive machine-code to HTTP maps; unlisted codes are never echoed (generic 500). */

export interface RejectionMapping {
  status: number
  copy: string
}

export const RPC_ERROR_CODES: Record<string, RejectionMapping> = {
  // mint_player_possession_invite (RAISE, code in DETAIL)
  MINT_ROLE_REQUIRED: {
    status: 500,
    copy: 'The server could not authorize the verification step. Please try again later.'
  },
  MINT_SUBJECT_REQUIRED: {
    status: 500,
    copy: 'The server sent an incomplete verification request. Please try again later.'
  },
  MINT_PLAYER_REQUIRED: {
    status: 500,
    copy: 'The server sent an incomplete verification request. Please try again later.'
  },
  MINT_DIGEST_REQUIRED: {
    status: 500,
    copy: 'The server sent an incomplete verification request. Please try again later.'
  },
  MINT_CODE_COLLISION: {
    status: 503,
    copy: 'The verification service is briefly busy. Please try again.'
  },
  // Shared preamble faults (mint RAISE + bind jsonb)
  SUBJECT_AUTHORITY_BLOCKED: {
    status: 403,
    copy: 'Your account is not permitted to change its player profile. Contact support.'
  },
  AUTH_SUBJECT_ABSENT: {
    status: 401,
    copy: 'Your session no longer matches a valid account. Sign in again.'
  },
  PLAYER_NOT_ON_TRACKED_ROSTER: {
    status: 404,
    copy: 'That player is not on a tracked guild roster yet. Wait for the next roster sync, then retry.'
  },
  TARGET_ALREADY_CLAIMED: {
    status: 409,
    copy: 'That player profile has already been claimed by another account.'
  },
  NO_ATTESTED_SOURCE: {
    status: 400,
    copy: 'You have no proven player profile to move. Complete onboarding first.'
  },
  SOURCE_NOT_EXACT: {
    status: 409,
    copy: 'Your account does not identify exactly one current profile. Contact support.'
  },
  SOURCE_CHANGED: {
    status: 409,
    copy: 'Your profile changed while the move was being prepared. Please try again.'
  },
  TARGET_NOT_EXACT: {
    status: 409,
    copy: 'That player does not identify exactly one roster entry. Contact support.'
  },
  MAPPING_LOCK_INCOMPLETE: {
    status: 409,
    copy: 'The profiles changed while the move was being prepared. Please try again.'
  },
  TRANSFER_CONFLICT: {
    status: 409,
    copy: 'That profile was claimed concurrently by another request. Please try again.'
  },
  RATE_LIMITED: {
    status: 429,
    copy: 'You can only move your account once every 7 days.'
  },
  // Mint and bind share a request, so these mean an internal inconsistency.
  PROOF_REQUIRED: {
    status: 500,
    copy: 'The verification proof was lost between steps. Please try again.'
  },
  PROOF_NOT_FOUND: {
    status: 500,
    copy: 'The verification proof was lost between steps. Please try again.'
  },
  PROOF_ALREADY_USED: {
    status: 409,
    copy: 'That verification was already consumed. Please try again.'
  },
  PROOF_REVOKED: {
    status: 409,
    copy: 'That verification was revoked. Please try again.'
  },
  PROOF_EXPIRED: {
    status: 409,
    copy: 'The verification window expired. Please try again.'
  },
  PROOF_NOT_POSSESSION: {
    status: 500,
    copy: 'The verification proof was malformed. Please try again.'
  },
  PROOF_SUBJECT_MISMATCH: {
    status: 403,
    copy: 'That verification belongs to another account.'
  },
  PROOF_NOT_MINTED: {
    status: 500,
    copy: 'The verification proof has no upstream receipt. Please try again.'
  },
  PROOF_PLAYER_MISMATCH: {
    status: 500,
    copy: 'The verification proof does not match its verified player. Please try again.'
  },
  // Officer corridor: unreachable here, mapped for exhaustiveness.
  INVALID_CODE: {
    status: 400,
    copy: 'Invalid or expired invite code.'
  },
  INVITE_NOT_EXACT: {
    status: 409,
    copy: 'That invite code does not identify exactly one invite.'
  },
  MAPPING_NOT_EXACT: {
    status: 409,
    copy: 'That invite does not identify one current roster entry.'
  },
  ALREADY_CLAIMED: {
    status: 409,
    copy: 'This player profile has already been claimed.'
  },
  USER_HAS_PROFILE: {
    status: 409,
    copy: 'You already have a claimed profile.'
  },
  CLAIM_CONFLICT: {
    status: 409,
    copy: 'The invite or user profile was claimed concurrently.'
  }
}

export const ROUTE_ERROR_CODES: Record<string, RejectionMapping> = {
  GUILD_SCOPE_REQUIRED: {
    status: 400,
    copy: 'That API key could not read your guild. Regenerate the key with Guild scope — Guild scope is REQUIRED for a player-ID change.'
  },
  KEY_NOT_IN_TARGET_GUILD: {
    status: 403,
    copy: "That API key belongs to a different guild than the new player's guild. Use a key for the account that is in the same guild as the new Player ID."
  },
  TARGET_NOT_IN_KEY_GUILD: {
    status: 403,
    copy: "The new Player ID was not found exactly once on that key's guild roster. Double-check the Player ID."
  },
  AMBIGUOUS_KEY_OWNERSHIP: {
    status: 409,
    copy: 'Your current profile is in the same guild as the new one, so guild membership cannot prove which account the key belongs to. Contact support to move your profile.'
  },
  NO_SYNCED_ACTIVITY: {
    status: 400,
    copy: 'The new account must appear on a synced guild roster first. Wait for the next sync or play a raid battle, then retry.'
  },
  NAME_NOT_UNIQUE: {
    status: 409,
    copy: "The new account's name is not unique on our rosters, so it cannot be verified automatically. Contact support."
  },
  GUILD_SYNC_STALE: {
    status: 409,
    copy: "This guild's roster sync is behind; contact support."
  },
  POSSESSION_NAME_MISMATCH: {
    status: 403,
    copy: "The API key's account name does not match the new player's synced roster name. Use an API key generated on the new account."
  }
}
