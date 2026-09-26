const REDACTED = '[Redacted]'
const SECRET_REDACTED = '[REDACTED]'
const SECRET_PATTERN = /[A-Za-z0-9_\-=]{28,}/gu

export const PII_LOG_FIELDS = [
  'email',
  'userAgent',
  'user_agent',
  'userId',
  'user_id',
  'requesterId',
  'playerId',
  'player_id',
  'targetPlayerId',
  'profileId',
  'profile_id',
  'mappingId',
  'mapping_id',
  'mappingIds',
  'mapping_ids',
  'memberId',
  'member_id',
  'accountId',
  'account_id',
  'playerName',
  'targetPlayerName',
  'searchName',
  'player',
  'displayName',
  'display_name',
  'guildCode',
  'guild_code',
  'guild',
  'guildId',
  'guild_id',
  'guildName',
  'guild_name',
  'guildTag',
  'guild_tag',
  'previousGuildTag',
  'previous_guild_tag',
  'expectedGuildId',
  'expected_guild_id',
  'previousGuildCode',
  'previous_guild_code',
  'currentGuildCode',
  'current_guild_code',
  'previousGuildName',
  'previous_guild_name',
  'currentGuildName',
  'current_guild_name',
  'clusterCode',
  'cluster_code',
  'previousClusterCode',
  'previous_cluster_code',
  'currentClusterCode',
  'current_cluster_code',
  'cluster',
  'discordUserId',
  'discord_user_id',
  'discordUsername',
  'discord_username',
  'patreonUserId',
  'patreon_user_id',
  'officerNotes',
  'officer_notes',
  'playerNotes',
  'player_notes',
  'tacticusShareUrl',
  'tacticus_share_url',
  'ownershipAttestationId',
  'ownership_attestation_id'
] as const

export const normalizeLogFieldName = (fieldName: string): string =>
  fieldName.replace(/[_-]/gu, '').toLowerCase()

const PII_FIELD_SET = new Set<string>(PII_LOG_FIELDS.map(normalizeLogFieldName))
const CORRELATION_FIELD_SET = new Set(
  [
    'requestId',
    'request_id',
    'correlationId',
    'correlation_id',
    'traceId',
    'trace_id',
    'spanId',
    'span_id',
    'jobId',
    'job_id',
    'workerId',
    'worker_id',
    'errorId',
    'error_id'
  ].map(normalizeLogFieldName)
)
const PII_FIELD_SUFFIX =
  /(?:user|player|guild|cluster|discord|patreon)(?:id|ids|code|codes|name|names|username|usernames|tag|tags)$/u
const ERROR_FIELD_SET = new Set(['err', 'error', 'exception'])
const STACK_FIELD_SET = new Set(['stack', 'errorstack', 'exceptionstack'])
const URL_FIELD_SET = new Set(['referer', 'referrer'])
const URL_FIELD_SUFFIX = /(?:url|uri)$/u
const EMAIL_IN_TEXT = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const UUID_IN_TEXT =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu
const DISCORD_SNOWFLAKE_IN_TEXT = /\b\d{17,20}\b/gu
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const TRACE_ID = /^[0-9a-f]{32}$/iu
const SPAN_ID = /^[0-9a-f]{16}$/iu

const prefixedUuid = (prefix: string, value: string): boolean =>
  value.startsWith(prefix) && UUID.test(value.slice(prefix.length))

export function isSafeCorrelationValue(
  fieldName: string,
  value: unknown
): value is string {
  if (typeof value !== 'string') return false

  switch (normalizeLogFieldName(fieldName)) {
    case 'traceid':
      return TRACE_ID.test(value)
    case 'spanid':
      return SPAN_ID.test(value)
    case 'requestid':
      return prefixedUuid('req_', value)
    case 'correlationid':
      return prefixedUuid('corr_', value) || prefixedUuid('req_', value)
    case 'jobid':
      return prefixedUuid('job_', value)
    case 'workerid':
      return prefixedUuid('worker_', value)
    case 'errorid':
      return prefixedUuid('err_', value)
    default:
      return false
  }
}

export const PII_LOG_REDACTION_PATHS = PII_LOG_FIELDS.flatMap((field) => [
  field,
  `*.${field}`
])

function redactDirectPii(value: string): string {
  return value
    .replace(EMAIL_IN_TEXT, REDACTED)
    .replace(UUID_IN_TEXT, REDACTED)
    .replace(DISCORD_SNOWFLAKE_IN_TEXT, REDACTED)
}

function stripUrlQueryAndFragment(value: string): string {
  const queryOrFragment = value.search(/[?#]/u)
  return queryOrFragment === -1 ? value : value.slice(0, queryOrFragment)
}

function redactSensitiveRouteSegments(value: string): string {
  return value
    .replace(
      /\/player-stats\/search\/[^/\s]+/giu,
      '/player-stats/search/[Redacted]'
    )
    .replace(/\/roster\/[^/\s]+/giu, '/roster/[Redacted]')
    .replace(/\/api\/gdpr\/my-data\/[^/\s]+/giu, '/api/gdpr/my-data/[Redacted]')
    .replace(/\/profile\/(?!edit(?:\/|$))[^/\s]+/giu, '/profile/[Redacted]')
}

function sanitizeUrlCandidate(value: string): string {
  return redactSensitiveRouteSegments(stripUrlQueryAndFragment(value))
}

function sanitizeAbsoluteUrlsInText(value: string): string {
  const lowerValue = value.toLowerCase()
  let cursor = 0
  let output = ''

  while (cursor < value.length) {
    const httpStart = lowerValue.indexOf('http://', cursor)
    const httpsStart = lowerValue.indexOf('https://', cursor)
    const urlStart =
      httpStart === -1
        ? httpsStart
        : httpsStart === -1
          ? httpStart
          : Math.min(httpStart, httpsStart)

    if (urlStart === -1) {
      output += value.slice(cursor)
      break
    }

    output += value.slice(cursor, urlStart)
    let urlEnd = urlStart
    while (urlEnd < value.length) {
      const character = value[urlEnd]
      if (
        character === ' ' ||
        character === '\n' ||
        character === '\r' ||
        character === '\t' ||
        character === '\f' ||
        character === '\v'
      ) {
        break
      }
      urlEnd += 1
    }
    output += sanitizeUrlCandidate(value.slice(urlStart, urlEnd))
    cursor = urlEnd
  }

  return output
}

export function redactPiiText(value: string): string {
  return redactDirectPii(sanitizeAbsoluteUrlsInText(value))
}

export function sanitizeLogUrl(value: string): string {
  return redactDirectPii(sanitizeUrlCandidate(value))
}

function sanitizeStack(value: string): string {
  const [, ...frames] = value.split('\n')
  return ['Error: Application error', ...frames.map(redactPiiText)].join('\n')
}

export function sanitizeLogValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  fieldName?: string
): unknown {
  if (typeof value === 'string') {
    if (
      fieldName &&
      CORRELATION_FIELD_SET.has(normalizeLogFieldName(fieldName))
    ) {
      return isSafeCorrelationValue(fieldName, value) ? value : REDACTED
    }
    const normalizedFieldName = fieldName
      ? normalizeLogFieldName(fieldName)
      : undefined
    if (
      normalizedFieldName &&
      (URL_FIELD_SET.has(normalizedFieldName) ||
        URL_FIELD_SUFFIX.test(normalizedFieldName))
    ) {
      return sanitizeLogUrl(value)
    }
    if (normalizedFieldName && STACK_FIELD_SET.has(normalizedFieldName)) {
      return sanitizeStack(value)
    }
    return redactPiiText(value)
  }
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (value instanceof Error) {
    const stackFrames = value.stack?.split('\n').slice(1).map(redactPiiText)
    return {
      type: value.name,
      message: 'Application error',
      stack: stackFrames
        ? [`${value.name}: Application error`, ...stackFrames].join('\n')
        : undefined,
      cause: sanitizeLogValue(value.cause, seen)
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, seen))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const normalized = normalizeLogFieldName(key)
      const sanitizedError =
        ERROR_FIELD_SET.has(normalized) && entry instanceof Error
          ? sanitizeLogValue(entry, seen, key)
          : REDACTED
      return [
        key,
        PII_FIELD_SET.has(normalized) || PII_FIELD_SUFFIX.test(normalized)
          ? REDACTED
          : ERROR_FIELD_SET.has(normalized)
            ? sanitizedError
            : sanitizeLogValue(entry, seen, key)
      ]
    })
  )
}

function maskString(value: string): string {
  return value.replace(SECRET_PATTERN, SECRET_REDACTED)
}

export function maskSensitive(value: unknown): unknown {
  if (typeof value === 'string') return maskString(value)
  if (Array.isArray(value)) return value.map((item) => maskSensitive(item))
  if (value && typeof value === 'object') return sanitizeErrorForLog(value)
  return value
}

/** API-key validation sanitizer keeping the historical `[REDACTED]` marker. */
export function sanitizeErrorForLog(
  error: unknown,
  seen: WeakSet<object> = new WeakSet()
): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: maskString(error.message),
      stack: error.stack ? maskString(error.stack) : undefined
    }
  }

  if (typeof error === 'object' && error !== null) {
    if (seen.has(error)) return { message: '[Circular reference]' }
    seen.add(error)
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(error)) {
      if (/api[_-]?key/iu.test(key)) {
        result[key] = SECRET_REDACTED
      } else if (typeof value === 'string') {
        result[key] = maskString(value)
      } else if (typeof value === 'object' && value !== null) {
        result[key] = sanitizeErrorForLog(value, seen)
      } else {
        result[key] = value
      }
    }

    if (!('message' in result)) {
      try {
        const stringified = String(error)
        result.message =
          stringified && stringified !== '[object Object]'
            ? maskString(stringified)
            : 'Unknown error'
      } catch {
        result.message = 'Unknown error'
      }
    }
    return result
  }

  if (typeof error === 'string') return { message: maskString(error) }
  if (typeof error === 'number' || typeof error === 'boolean') {
    return { value: error }
  }
  return { message: 'Unknown error' }
}
