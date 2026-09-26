import {
  isSafeCorrelationValue,
  normalizeCorrelationFieldName
} from '@/app/lib/logging/correlation-id'

const REDACTED = '[Redacted]'
const EMAIL_IN_TEXT = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const UUID_IN_TEXT =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu
const DISCORD_SNOWFLAKE_IN_TEXT = /\b\d{17,20}\b/gu

const SENSITIVE_FIELD_NAMES = new Set([
  'email',
  'userid',
  'requesterid',
  'playerid',
  'targetplayerid',
  'profileid',
  'mappingid',
  'mappingids',
  'memberid',
  'accountid',
  'playername',
  'targetplayername',
  'displayname',
  'searchname',
  'guild',
  'guildid',
  'guildcode',
  'guildname',
  'guildtag',
  'previousguildtag',
  'expectedguildid',
  'previousguildcode',
  'currentguildcode',
  'previousguildname',
  'currentguildname',
  'cluster',
  'clustercode',
  'previousclustercode',
  'currentclustercode',
  'discorduserid',
  'discordusername',
  'patreonuserid',
  'username',
  'officernotes',
  'playernotes',
  'tacticusshareurl',
  'ownershipattestationid',
  'contactdiscord',
  'apiowner',
  'player'
])

const CORRELATION_FIELD_NAMES = new Set([
  'requestid',
  'correlationid',
  'traceid',
  'spanid',
  'jobid',
  'workerid',
  'errorid'
])
const SAFE_TAG_NAMES = new Set([
  'auth_event',
  'chunk_reload',
  'auth_flow',
  'auth_error_code',
  'component',
  'operation',
  'error_code',
  'status_code',
  'level',
  'source',
  'feature',
  'job_type',
  'runtime',
  'environment'
])
const SAFE_TAG_VALUE = /^[A-Za-z0-9_.:-]{1,80}$/u
const PII_FIELD_SUFFIX =
  /(?:user|player|guild|cluster|discord|patreon)(?:id|ids|code|codes|name|names|username|usernames|tag|tags)$/u
const ERROR_FIELD_NAMES = new Set(['err', 'error'])
const SAFE_FINGERPRINTS = new Set(['supabase-auth-processlock-timeout'])
const SAFE_EVENT_MESSAGES = new Set([
  'Slow boss calculation detected',
  'Boss calculation failed',
  'Fetch pool degraded — liveness probe timeout after 3s',
  'auth_login_redirect_error',
  'auth_login_failed',
  'auth_login_exception'
])

const normalizeFieldName = (fieldName: string): string =>
  normalizeCorrelationFieldName(fieldName)

const isSensitiveFieldName = (fieldName: string): boolean => {
  const normalized = normalizeFieldName(fieldName)
  return (
    SENSITIVE_FIELD_NAMES.has(normalized) || PII_FIELD_SUFFIX.test(normalized)
  )
}

export function redactObservabilityText(value: string): string {
  return value
    .replace(EMAIL_IN_TEXT, REDACTED)
    .replace(UUID_IN_TEXT, REDACTED)
    .replace(DISCORD_SNOWFLAKE_IN_TEXT, REDACTED)
}

export function sanitizeObservabilityValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  fieldName?: string
): unknown {
  if (typeof value === 'string') {
    if (
      fieldName &&
      CORRELATION_FIELD_NAMES.has(normalizeFieldName(fieldName))
    ) {
      return isSafeCorrelationValue(fieldName, value) ? value : REDACTED
    }
    return redactObservabilityText(value)
  }
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (value instanceof Error) {
    const sanitized = new Error('Application error')
    sanitized.name = value.name
    if (value.stack) {
      const stackLines = value.stack.split('\n')
      sanitized.stack = [
        `${value.name}: Application error`,
        ...stackLines.slice(1).map(redactObservabilityText)
      ].join('\n')
    }
    sanitized.cause = sanitizeObservabilityValue(value.cause, seen)
    return sanitized
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeObservabilityValue(entry, seen))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const normalized = normalizeFieldName(key)
      return [
        key,
        isSensitiveFieldName(normalized)
          ? REDACTED
          : ERROR_FIELD_NAMES.has(normalized) && !(entry instanceof Error)
            ? REDACTED
            : sanitizeObservabilityValue(entry, seen, key)
      ]
    })
  )
}

/** Final boundary: every capture passes beforeSend, so scrub the whole event. */
export function sanitizeSentryEvent<T>(event: T): T {
  const sanitized = sanitizeObservabilityValue(event) as T & {
    user?: unknown
    request?: { method?: string }
    message?: string
    transaction?: string
    fingerprint?: unknown
    extra?: unknown
    tags?: Record<string, unknown>
    contexts?: Record<string, unknown>
    breadcrumbs?: Array<Record<string, unknown>>
    exception?: { values?: Array<{ value?: string }> }
  }

  if (sanitized && typeof sanitized === 'object') {
    const safeFingerprint =
      Array.isArray(sanitized.fingerprint) &&
      sanitized.fingerprint.length === 1 &&
      typeof sanitized.fingerprint[0] === 'string' &&
      SAFE_FINGERPRINTS.has(sanitized.fingerprint[0])
        ? [sanitized.fingerprint[0]]
        : undefined
    const safeMessage =
      typeof sanitized.message === 'string' &&
      SAFE_EVENT_MESSAGES.has(sanitized.message)
        ? sanitized.message
        : sanitized.message
          ? 'Application message'
          : undefined

    sanitized.user = undefined
    sanitized.request = sanitized.request?.method
      ? { method: sanitized.request.method }
      : undefined
    sanitized.message = safeMessage
    sanitized.transaction = undefined
    // Only static app-owned keys: caller fingerprints can carry PII or explode cardinality.
    sanitized.fingerprint = safeFingerprint
    sanitized.extra = undefined

    sanitized.tags = Object.fromEntries(
      Object.entries(sanitized.tags ?? {}).flatMap(([key, value]) => {
        if (
          CORRELATION_FIELD_NAMES.has(normalizeFieldName(key)) &&
          isSafeCorrelationValue(key, value)
        ) {
          return [[key, value]]
        }
        if (
          SAFE_TAG_NAMES.has(key) &&
          typeof value === 'string' &&
          SAFE_TAG_VALUE.test(value)
        ) {
          return [[key, value]]
        }
        return []
      })
    )

    const trace = sanitized.contexts?.trace
    sanitized.contexts =
      trace && typeof trace === 'object'
        ? {
            trace: Object.fromEntries(
              Object.entries(trace as Record<string, unknown>).filter(
                ([key, value]) =>
                  (key === 'trace_id' &&
                    isSafeCorrelationValue('trace_id', value)) ||
                  (key === 'span_id' &&
                    isSafeCorrelationValue('span_id', value)) ||
                  (['op', 'status', 'origin'].includes(key) &&
                    typeof value === 'string' &&
                    SAFE_TAG_VALUE.test(value)) ||
                  (key === 'sampled' && typeof value === 'boolean')
              )
            )
          }
        : undefined

    sanitized.breadcrumbs = sanitized.breadcrumbs?.map((breadcrumb) =>
      Object.fromEntries(
        Object.entries(breadcrumb).filter(
          ([key, value]) =>
            ['type', 'category', 'level'].includes(key) &&
            typeof value === 'string' &&
            SAFE_TAG_VALUE.test(value)
        )
      )
    )
    for (const exception of sanitized.exception?.values ?? []) {
      if (exception.value) exception.value = 'Application error'
    }
  }

  return sanitized
}
