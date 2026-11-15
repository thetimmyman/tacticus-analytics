// Verified network/transport failures that may be suppressed only when wrapped
// by an explicit fail-closed access-verification boundary.
const ALLOWED_WRAPPER_MESSAGES = new Set(['Unable to verify account access'])

const TRANSPORT_MESSAGE_PATTERNS: readonly string[] = [
  'fetch failed',
  'Failed to fetch',
  'Load failed',
  'NetworkError when attempting to fetch resource',
  'failed to pipe response',
  'ECONNRESET',
  'ETIMEDOUT',
  'socket hang up'
]

const TRANSPORT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
])

const NON_TRANSIENT_DIAGNOSIS_PATTERN =
  /invalid signature|permission denied|access denied|unauthorized|forbidden|invalid jwt|jwt expired|row-level security|schema cache|does not exist/iu

const POSTGREST_ALLOWED_KEYS = new Set([
  'message',
  'details',
  'hint',
  'code',
  'name'
])

const MAX_CAUSE_DEPTH = 8
const MAX_FIELD_LENGTH = 16_384

function hasTransportText(text: string): boolean {
  return TRANSPORT_MESSAGE_PATTERNS.some((pattern) => text.includes(pattern))
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_FIELD_LENGTH
}

function isDisqualifiedRecord(record: Record<string, unknown>): boolean {
  if (
    'status' in record &&
    record.status !== undefined &&
    record.status !== 0
  ) {
    return true
  }

  if ('code' in record && record.code !== undefined && record.code !== '') {
    if (
      typeof record.code !== 'string' ||
      !TRANSPORT_ERROR_CODES.has(record.code)
    ) {
      return true
    }
  }

  for (const key of ['message', 'details', 'hint'] as const) {
    const value = record[key]
    if (value === undefined || value === null) continue
    if (
      !isBoundedString(value) ||
      NON_TRANSIENT_DIAGNOSIS_PATTERN.test(value)
    ) {
      return true
    }
  }

  return false
}

function isAllowedWrapperError(value: unknown): value is Error {
  if (!(value instanceof Error) || value.name !== 'Error') {
    return false
  }
  if (!ALLOWED_WRAPPER_MESSAGES.has(value.message)) {
    return false
  }
  return !isDisqualifiedRecord(value as unknown as Record<string, unknown>)
}

function isVerifiedTransportErrorInstance(error: Error): boolean {
  const record = error as unknown as Record<string, unknown>
  if (isDisqualifiedRecord(record)) {
    return false
  }
  const code = record.code
  return (
    hasTransportText(error.message) ||
    (typeof code === 'string' && TRANSPORT_ERROR_CODES.has(code))
  )
}

function isVerifiedPostgrestTransportObject(value: unknown): boolean {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    value instanceof Error
  ) {
    return false
  }

  const proto = Object.getPrototypeOf(value)
  if (
    proto !== null &&
    (typeof proto !== 'object' || Object.getPrototypeOf(proto) !== null)
  ) {
    return false
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length < 4 ||
    !keys.every((key) => POSTGREST_ALLOWED_KEYS.has(key))
  ) {
    return false
  }

  // PostgrestBuilder sets code/hint to '' and details to a string only in its
  // fetch-rejection catch path; HTTP/SQL errors carry SQLSTATE/PGRST codes or null fields.
  if (
    record.code !== '' ||
    !isBoundedString(record.message) ||
    record.message.length === 0 ||
    !isBoundedString(record.details) ||
    !isBoundedString(record.hint)
  ) {
    return false
  }

  if (isDisqualifiedRecord(record)) {
    return false
  }

  return hasTransportText(record.message) || hasTransportText(record.details)
}

/** True only when an allowlisted fail-closed wrapper wraps a verified transport failure. */
export function hasTransientCause(error: unknown): boolean {
  if (!isAllowedWrapperError(error)) {
    return false
  }

  let current: unknown = error.cause
  const seen = new Set<unknown>([error])
  let depth = 0
  let sawVerifiedTransport = false

  while (current !== undefined && current !== null) {
    if (seen.has(current) || depth >= MAX_CAUSE_DEPTH) {
      return false
    }
    seen.add(current)
    depth += 1

    if (current instanceof Error) {
      if (!sawVerifiedTransport && isAllowedWrapperError(current)) {
        current = current.cause
        continue
      }
      if (isVerifiedTransportErrorInstance(current)) {
        sawVerifiedTransport = true
        current = current.cause
        continue
      }
      return false
    }

    if (isVerifiedPostgrestTransportObject(current)) {
      return true
    }

    return false
  }

  return sawVerifiedTransport
}
