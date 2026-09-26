/** Separate from the transfer corridor's test-pinned set. Unknown codes are never echoed. */

export interface RejectionMapping {
  status: number
  copy: string
}

/** RAISEd in DETAIL (PostgREST `error.details`). */
export const MINT_ERROR_CODES: Record<string, RejectionMapping> = {
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
  SUBJECT_AUTHORITY_BLOCKED: {
    status: 403,
    copy: 'Your account is not permitted to claim a player profile. Contact support.'
  },
  AUTH_SUBJECT_ABSENT: {
    status: 401,
    copy: 'Your session no longer matches a valid account. Sign in again.'
  },
  SUBJECT_ALREADY_LINKED: {
    status: 409,
    copy: 'This account already has a player profile. Use your profile settings to change it.'
  },
  REGISTRATION_AUTHORITY_REQUIRED: {
    status: 409,
    copy: 'We could not confirm this account as the guild registrar. Return to Register New Guild and verify the guild key again.'
  },
  // Also checked by the route, but reachable via a race.
  GUILD_ALREADY_BOOTSTRAPPED: {
    status: 409,
    copy: 'Someone in this guild has already linked their account, so ask a leader or officer for an invite code.'
  },
  PLAYER_NOT_ON_TRACKED_ROSTER: {
    status: 404,
    copy: 'That player is not on a tracked guild roster yet. Wait for the next roster sync, then retry.'
  },
  TARGET_ALREADY_CLAIMED: {
    status: 409,
    copy: 'That player profile has already been claimed by another account.'
  },
  TARGET_NOT_INVITE_CAPABLE: {
    status: 403,
    copy: 'Only a guild leader or officer can claim the first seat in a guild.'
  },
  BOOTSTRAP_ALREADY_IN_FLIGHT: {
    status: 409,
    copy: 'A profile-link request for this account is already in progress. Wait a few minutes and try again.'
  }
}

export const ROUTE_ERROR_CODES = {
  ALREADY_LINKED: {
    status: 409,
    copy: 'Your account is already linked to a player. Nothing to claim.'
  },
  REGISTRATION_AUTHORITY_REQUIRED: {
    status: 409,
    copy: 'We could not find a completed guild registration for this account. Return to Register New Guild and verify the guild key again.'
  },
  GUILD_NOT_FOUND: {
    status: 404,
    copy: 'The guild registered to this account is no longer available. Contact support.'
  },
  PLAYER_SCOPE_REQUIRED: {
    // Hedged: getPlayer() returns null for missing scope and errors alike.
    status: 400,
    copy: 'We could not read your player profile with that key. Confirm it has Player read access and is still active. If it does, Tacticus may be having trouble; wait a few minutes and retry the same key.'
  },
  TACTICUS_UNAVAILABLE: {
    status: 503,
    copy: 'Tacticus is not answering right now, so your key could not be checked. Nothing is wrong with the key — try again in a few minutes.'
  },
  PLAYER_LOOKUP_FAILED: {
    status: 502,
    copy: 'Tacticus returned a profile with no player name for that key. Please try again.'
  },
  GUILD_SYNC_STALE: {
    status: 409,
    copy: "Your guild's member roster has not been refreshed recently, so it cannot verify your key. Running a sync will not restore it. Check the guild's API key and integration settings, or contact support."
  },
  NO_SYNCED_ACTIVITY: {
    status: 409,
    copy: 'Your guild roster has not synced yet. Wait for the initial sync, then retry.'
  },
  POSSESSION_NAME_MISMATCH: {
    status: 403,
    copy: 'No unclaimed roster entry matches the player name on that API key.'
  },
  NAME_NOT_UNIQUE: {
    status: 409,
    copy: 'More than one roster entry carries that player name, so it cannot prove which one is yours. Ask an officer for an invite code.'
  },
  TARGET_NOT_INVITE_CAPABLE: {
    status: 403,
    copy: 'Only a guild leader or officer can claim the first seat — that seat could not invite anyone else. Ask your leader to set this up.'
  }
} as const satisfies Record<string, RejectionMapping>

export type RouteErrorCode = keyof typeof ROUTE_ERROR_CODES
