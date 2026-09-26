/** INVALID_CODE covers missing/used/revoked/expired alike so the endpoint is not an oracle for live codes. */

export interface RejectionMapping {
  status: number
  copy: string
}

export const CLAIM_ERROR_CODES = {
  INVALID_CODE: {
    status: 400,
    copy: 'That invite code is not valid. Ask your guild leader or officer for a fresh one.'
  },
  API_KEY_REQUIRED: {
    status: 400,
    copy: 'A Tacticus API key is required to claim this profile.'
  },
  TACTICUS_UNAVAILABLE: {
    status: 503,
    copy: 'Tacticus is not answering right now. Please try again in a few minutes.'
  },
  GUILD_SCOPE_REQUIRED: {
    status: 400,
    copy: 'That API key was not accepted for guild access. A key with Player read access is all you need — create one at api.tacticusgame.com, then try again.'
  },
  PLAYER_SCOPE_REQUIRED: {
    status: 400,
    copy: 'That API key was not accepted for player access. Create a key with Player read access at api.tacticusgame.com, then try again.'
  },
  PLAYER_LOOKUP_FAILED: {
    status: 502,
    copy: 'Tacticus did not return a player name for that key. Please try again.'
  },
  KEY_NOT_IN_TARGET_GUILD: {
    status: 403,
    copy: 'That API key belongs to a different guild than this invite code. Use the key for the account the invite was issued to.'
  },
  GUILD_NOT_REGISTERED: {
    status: 404,
    copy: 'That API key belongs to a guild that is not registered here. Ask your guild leader to register it first.'
  },
  TARGET_NOT_ON_ROSTER: {
    status: 409,
    copy: 'The player this invite was issued for is no longer on the synced roster. Ask for a fresh invite code.'
  },
  GUILD_SYNC_STALE: {
    // Sync can succeed on the raid leg while the roster refresh this gate measures fails.
    status: 409,
    copy: "We could not verify this invite: this guild's member roster has not been refreshed recently. Retrying, or running a sync, will not change that. Ask a guild leader to check the guild's API key and integration settings, or contact support."
  },
  NAME_NOT_UNIQUE: {
    status: 409,
    copy: 'More than one player in this guild uses that name, so we cannot verify the invite by name. Contact a guild leader.'
  },
  POSSESSION_NAME_MISMATCH: {
    status: 403,
    copy: 'That API key does not belong to the player this invite was issued for. Use your own Tacticus API key.'
  },
  TARGET_NOT_IN_KEY_GUILD: {
    status: 403,
    copy: 'The player this invite was issued for is not on the roster your API key returns. Use the key for the account the invite was issued to.'
  },
  AUTHORITY_LOOKUP_FAILED: {
    status: 503,
    copy: 'Unable to verify the invite right now. Please try again.'
  }
} as const satisfies Record<string, RejectionMapping>

export type ClaimErrorCode = keyof typeof CLAIM_ERROR_CODES

/** The column has a CHECK constraint, so every code must appear here or the probe row is lost. */
export const CLAIM_AUDIT_OUTCOMES: Record<ClaimErrorCode, string> = {
  INVALID_CODE: 'rejected_not_found',
  API_KEY_REQUIRED: 'rejected_invalid_input',
  TACTICUS_UNAVAILABLE: 'rejected_invalid_input',
  GUILD_SCOPE_REQUIRED: 'rejected_invalid_input',
  PLAYER_SCOPE_REQUIRED: 'rejected_invalid_input',
  PLAYER_LOOKUP_FAILED: 'rejected_invalid_input',
  KEY_NOT_IN_TARGET_GUILD: 'rejected_user_mismatch',
  GUILD_NOT_REGISTERED: 'rejected_invalid_input',
  TARGET_NOT_ON_ROSTER: 'rejected_not_found',
  GUILD_SYNC_STALE: 'rejected_invalid_input',
  NAME_NOT_UNIQUE: 'rejected_invalid_input',
  POSSESSION_NAME_MISMATCH: 'rejected_user_mismatch',
  TARGET_NOT_IN_KEY_GUILD: 'rejected_user_mismatch',
  AUTHORITY_LOOKUP_FAILED: 'rejected_database_error'
}
