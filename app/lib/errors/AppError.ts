export enum ErrorCode {
  UNAUTHORIZED = 1001,
  FORBIDDEN = 1002,
  AUTHENTICATION_REQUIRED = 1004,
  INSUFFICIENT_PERMISSIONS = 1005,
  VALIDATION_FAILED = 2001,
  INVALID_GUILD_CODE = 2006,
  INVALID_REQUEST = 2011,
  DISCORD_WEBHOOK_INVALID = 2014,

  NOT_FOUND = 3001,
  ALREADY_EXISTS = 3002,
  CONFLICT = 3003,
  GUILD_NOT_FOUND = 3004,
  PLAYER_NOT_FOUND = 3005,
  USER_NOT_FOUND = 3006,
  GUILD_ALREADY_EXISTS = 3009,
  PROTECTED_GUILD_CODE = 3010,
  EXTERNAL_API_ERROR = 4001,
  DATABASE_ERROR = 4002,
  RATE_LIMITED = 4003,
  DISCORD_API_FAILURE = 4006,
  WEBHOOK_NOT_CONFIGURED = 4008,
  WEBHOOK_DISABLED = 4009,

  INTERNAL_ERROR = 5001,
  SYNC_FAILED = 5003,
  FETCH_FAILED = 5004,
  UPDATE_FAILED = 5005,
  NOTIFICATION_SEND_FAILED = 5011
}

export type LegacyErrorOptions = {
  statusCode?: number
  retryable?: boolean
  details?: string
  endpoint?: string
  guild_code?: string
  user_id?: string
  [key: string]: unknown
}

const LEGACY_STATUS_BY_CODE: Record<string, number> = {
  AUTHENTICATION_REQUIRED: 401,
  UNAUTHORIZED: 401,
  SESSION_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  AUTH_REQUIRED: 401,
  INVALID_API_KEY: 401,
  INSUFFICIENT_PERMISSIONS: 403,
  FORBIDDEN: 403,
  ADMIN_ACCESS_REQUIRED: 403,
  PERMISSION_DENIED: 403,

  VALIDATION_FAILED: 400,
  INVALID_REQUEST_FORMAT: 400,
  INVALID_REQUEST: 400,
  INVALID_INPUT: 400,
  INVALID_TIER: 400,
  MISSING_REQUIRED_FIELDS: 400,
  MISSING_REQUIRED: 400,
  INVALID_GUILD_CODE: 400,
  INVALID_WEBHOOK_URL: 400,
  INVALID_LEADERBOARD_TYPE: 400,
  INVALID_SEASON: 400,
  MESSAGE_TOO_LONG: 400,
  DISCORD_WEBHOOK_INVALID: 400,
  PROTECTED_GUILD_CODE: 400,

  NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  USER_PROFILE_NOT_FOUND: 404,
  PLAYER_NOT_FOUND: 404,
  GUILD_NOT_FOUND: 404,
  RESOURCE_NOT_FOUND: 404,

  ALREADY_EXISTS: 409,
  CONFLICT: 409,
  GUILD_ALREADY_EXISTS: 409,
  DUPLICATE_REQUEST: 409,

  RATE_LIMITED: 429,

  EXTERNAL_API_ERROR: 502,
  FETCH_FAILED: 502,
  LOKI_API_FAILURE: 502,
  TACTICUS_API_FAILURE: 502,
  DISCORD_API_FAILURE: 502,
  WEBHOOK_NOT_CONFIGURED: 503,
  WEBHOOK_DISABLED: 503,

  DATABASE_ERROR: 500,
  INTERNAL_ERROR: 500,
  INTERNAL_SERVER_ERROR: 500,
  UNKNOWN_ERROR: 500,
  UPDATE_FAILED: 500,
  NOTIFICATION_SEND_FAILED: 500,
  SESSION_REFRESH_FAILURE: 500,
  ENCRYPTION_ERROR: 500,
  CONFIGURATION_ERROR: 500,
  SYNC_FAILED: 500,
  SYNC_FAILURE: 500,
  EMAIL_SEND_FAILED: 500
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public retryable: boolean = false,
    public metadata?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
    Object.setPrototypeOf(this, AppError.prototype)
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.metadata && { metadata: this.metadata })
      }
    }
  }
}

export const rethrowIfAppError = (error: unknown): void => {
  if (error instanceof AppError) {
    throw error
  }
}

export const Errors = {
  unauthorized: (
    message = 'Unauthorized',
    metadata?: Record<string, unknown>
  ) => new AppError(ErrorCode.UNAUTHORIZED, message, 401, false, metadata),

  forbidden: (message = 'Forbidden', metadata?: Record<string, unknown>) =>
    new AppError(ErrorCode.FORBIDDEN, message, 403, false, metadata),

  notFound: (resource: string, message?: string) =>
    new AppError(ErrorCode.NOT_FOUND, message ?? `${resource} not found`, 404),

  validation: (message: string, metadata?: Record<string, unknown>) =>
    new AppError(ErrorCode.VALIDATION_FAILED, message, 400, false, metadata),

  internal: (
    message = 'Internal server error',
    metadata?: Record<string, unknown>
  ) => new AppError(ErrorCode.INTERNAL_ERROR, message, 500, true, metadata),

  rateLimit: (retryAfter?: number) =>
    new AppError(ErrorCode.RATE_LIMITED, 'Rate limit exceeded', 429, true, {
      retryAfter
    }),

  conflict: (message = 'Conflict', metadata?: Record<string, unknown>) =>
    new AppError(ErrorCode.CONFLICT, message, 409, false, metadata),

  alreadyExists: (resource = 'Resource', metadata?: Record<string, unknown>) =>
    new AppError(
      ErrorCode.ALREADY_EXISTS,
      `${resource} already exists`,
      409,
      false,
      metadata
    ),

  gone: (
    message = 'Resource no longer available',
    metadata?: Record<string, unknown>
  ) => new AppError(ErrorCode.NOT_FOUND, message, 410, false, metadata),

  unprocessable: (
    message = 'Unprocessable entity',
    metadata?: Record<string, unknown>
  ) => new AppError(ErrorCode.VALIDATION_FAILED, message, 422, false, metadata),

  timeout: (
    message = 'Request timed out',
    metadata?: Record<string, unknown>
  ) => new AppError(ErrorCode.EXTERNAL_API_ERROR, message, 408, true, metadata),

  external: (
    message = 'External service error',
    statusCode: number = 502,
    metadata?: Record<string, unknown>
  ) =>
    new AppError(
      ErrorCode.EXTERNAL_API_ERROR,
      message,
      statusCode,
      true,
      metadata
    ),

  database: (message = 'Database error', metadata?: Record<string, unknown>) =>
    new AppError(ErrorCode.DATABASE_ERROR, message, 500, true, metadata),

  authenticationRequired: (
    message = 'Authentication required',
    metadata?: Record<string, unknown>
  ) =>
    new AppError(
      ErrorCode.AUTHENTICATION_REQUIRED,
      message,
      401,
      false,
      metadata
    ),

  insufficientPermissions: (
    message = 'Insufficient permissions',
    metadata?: Record<string, unknown>
  ) =>
    new AppError(
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      message,
      403,
      false,
      metadata
    ),

  invalidRequest: (
    message = 'Invalid request',
    metadata?: Record<string, unknown>
  ) => new AppError(ErrorCode.INVALID_REQUEST, message, 400, false, metadata),

  invalidGuildCode: (guildCode: string) =>
    new AppError(
      ErrorCode.INVALID_GUILD_CODE,
      `Invalid guild code: ${guildCode}`,
      400,
      false,
      { guildCode }
    ),

  protectedGuildCode: (guildCode: string) =>
    new AppError(
      ErrorCode.PROTECTED_GUILD_CODE,
      `Guild code ${guildCode} is reserved`,
      400,
      false,
      { guildCode }
    ),

  discordWebhookInvalid: (
    message = 'Discord webhook is invalid',
    metadata?: Record<string, unknown>
  ) =>
    new AppError(
      ErrorCode.DISCORD_WEBHOOK_INVALID,
      message,
      400,
      false,
      metadata
    ),

  webhookNotConfigured: (guildCode: string, webhookType: string) =>
    new AppError(
      ErrorCode.WEBHOOK_NOT_CONFIGURED,
      `No ${webhookType} webhook configured for this guild`,
      503,
      false,
      { guildCode, webhookType }
    ),

  webhookDisabled: (guildCode: string, webhookType: string) =>
    new AppError(
      ErrorCode.WEBHOOK_DISABLED,
      `${webhookType} webhook is disabled for this guild`,
      503,
      false,
      { guildCode, webhookType }
    ),

  guildNotFound: (guildCode: string) =>
    new AppError(ErrorCode.GUILD_NOT_FOUND, 'Guild not found', 404, false, {
      guildCode
    }),

  // Ids stay in metadata, never in the message (UUID leak).
  playerNotFound: (playerId: string) =>
    new AppError(ErrorCode.PLAYER_NOT_FOUND, 'Player not found', 404, false, {
      playerId
    }),

  userNotFound: (userId?: string) =>
    new AppError(
      ErrorCode.USER_NOT_FOUND,
      'User not found',
      404,
      false,
      userId ? { userId } : undefined
    ),

  guildAlreadyExists: (guildCode: string) =>
    new AppError(
      ErrorCode.GUILD_ALREADY_EXISTS,
      'Guild already exists',
      409,
      false,
      { guildCode }
    ),

  discordApiFailure: (
    message = 'Discord API failure',
    metadata?: Record<string, unknown>
  ) =>
    new AppError(ErrorCode.DISCORD_API_FAILURE, message, 502, true, metadata),

  notificationSendFailed: (
    message = 'Failed to send notification',
    metadata?: Record<string, unknown>
  ) =>
    new AppError(
      ErrorCode.NOTIFICATION_SEND_FAILED,
      message,
      500,
      true,
      metadata
    ),

  syncFailed: (message = 'Sync failed', metadata?: Record<string, unknown>) =>
    new AppError(ErrorCode.SYNC_FAILED, message, 500, true, metadata),

  updateFailed: (
    message = 'Update failed',
    metadata?: Record<string, unknown>
  ) => new AppError(ErrorCode.UPDATE_FAILED, message, 500, true, metadata),

  fetchFailed: (message = 'Fetch failed', metadata?: Record<string, unknown>) =>
    new AppError(ErrorCode.FETCH_FAILED, message, 502, true, metadata),

  /** @deprecated Use specific factory methods instead (e.g., Errors.unauthorized()) */
  fromLegacyCode: (
    legacyCode: string,
    message: string,
    options: LegacyErrorOptions = {}
  ) => {
    const { statusCode, retryable, ...rest } = options
    const resolvedStatus =
      statusCode ?? LEGACY_STATUS_BY_CODE[legacyCode] ?? 500
    const appError = Errors.fromResponse(resolvedStatus, {
      error: message,
      code: legacyCode,
      ...rest
    })
    if (typeof retryable === 'boolean' && retryable !== appError.retryable) {
      return new AppError(
        appError.code,
        appError.message,
        appError.statusCode,
        retryable,
        appError.metadata
      )
    }
    return appError
  },

  fromResponse: (
    statusCode: number,
    payload: unknown,
    fallbackMessage = 'Unexpected error'
  ) => {
    let message = fallbackMessage
    let metadata: Record<string, unknown> | undefined

    if (payload && typeof payload === 'object') {
      const body = payload as Record<string, unknown>
      if (typeof body.error === 'string') {
        message = body.error
      } else if (body.error && typeof body.error === 'object') {
        const errorObject = body.error as Record<string, unknown>
        if (typeof errorObject.message === 'string') {
          message = errorObject.message
        }
      } else if (typeof body.message === 'string') {
        message = body.message
      }
      metadata = { ...body }
    } else if (typeof payload === 'string') {
      message = payload
    }

    return Errors.fromStatus(statusCode, message, metadata)
  },

  /** Omitted or invalid status defaults to 500. */
  fromStatus: (
    statusCode?: number,
    message = 'Unexpected error',
    metadata?: Record<string, unknown>
  ) => {
    const code = statusCode || 500
    switch (code) {
      case 400:
        return Errors.validation(message, metadata)
      case 401:
        return Errors.unauthorized(message, metadata)
      case 403:
        return Errors.forbidden(message, metadata)
      case 404:
        return Errors.notFound('Resource', message)
      case 408:
        return Errors.timeout(message, metadata)
      case 409:
        return Errors.conflict(message, metadata)
      case 410:
        return Errors.gone(message, metadata)
      case 422:
        return Errors.unprocessable(message, metadata)
      case 429:
        return new AppError(
          ErrorCode.RATE_LIMITED,
          message,
          429,
          true,
          metadata
        )
      case 502:
      case 503:
      case 504:
        return Errors.external(message, code, metadata)
      case 500:
      default:
        return new AppError(
          ErrorCode.INTERNAL_ERROR,
          message,
          code,
          code >= 500,
          metadata
        )
    }
  }
}
