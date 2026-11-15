const NON_TRANSIENT_DIAGNOSIS_PATTERN =
  /invalid signature|permission denied|access denied|unauthorized|forbidden|invalid jwt|jwt expired|row-level security|schema cache|does not exist|violates|syntax error|duplicate key|null value in column|foreign key|unique constraint|check constraint|authentication|not found|status code [45]\d\d|\bhttp [45]\d\d\b|cannot read properties|is not a function|is not defined|unexpected token/iu

const BROWSER_NETWORK_TYPE_ERROR_PATTERNS: readonly RegExp[] = [
  /^Failed to fetch(?:\s*\([^)]*\))?\.?$/iu,
  /^Load failed(?:\s*\([^)]*\))?\.?$/iu,
  /^NetworkError when attempting to fetch resource\.?$/iu,
  /^fetch failed$/iu
]

const TRANSPORT_MESSAGE_PATTERNS: readonly string[] = [
  'fetch failed',
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

const ALLOWED_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'AbortError',
  'DOMException'
])

const DISQUALIFYING_STRUCTURAL_KEYS = [
  'isAppError',
  'isPermanent',
  'sqlState',
  'constraint',
  'table',
  'column',
  'schema',
  'routine',
  'severity'
] as const

const POSTGREST_TRANSPORT_KEYS = new Set([
  'message',
  'details',
  'hint',
  'code',
  'name',
  'cause'
])

const DOM_ABORT_ERR_CODE = 20
const MAX_CAUSE_DEPTH = 8
const MAX_MESSAGE_LENGTH = 16_384

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_MESSAGE_LENGTH
}

function hasTransportText(text: string): boolean {
  return TRANSPORT_MESSAGE_PATTERNS.some((pattern) => text.includes(pattern))
}

function isAllowedCodeForRecord(record: Record<string, unknown>): boolean {
  if (!('code' in record) || record.code === undefined || record.code === '') {
    return true
  }
  const code = record.code
  if (record.name === 'AbortError') {
    return (
      code === DOM_ABORT_ERR_CODE ||
      code === 'ABORT_ERR' ||
      code === 'AbortError'
    )
  }
  return typeof code === 'string' && TRANSPORT_ERROR_CODES.has(code)
}

function hasDisqualifyingMetadata(record: Record<string, unknown>): boolean {
  if (
    'status' in record &&
    record.status !== undefined &&
    record.status !== 0
  ) {
    return true
  }
  if (
    'statusCode' in record &&
    record.statusCode !== undefined &&
    record.statusCode !== 0
  ) {
    return true
  }
  if (!isAllowedCodeForRecord(record)) {
    return true
  }

  if (
    'name' in record &&
    record.name !== undefined &&
    (typeof record.name !== 'string' || !ALLOWED_ERROR_NAMES.has(record.name))
  ) {
    return true
  }

  for (const key of DISQUALIFYING_STRUCTURAL_KEYS) {
    if (
      key in record &&
      record[key] !== undefined &&
      record[key] !== false &&
      record[key] !== ''
    ) {
      return true
    }
  }

  for (const key of [
    'message',
    'details',
    'hint',
    'reason',
    'statusText'
  ] as const) {
    if (!(key in record) || record[key] === undefined) continue
    const value = record[key]
    if (!isBoundedString(value) || NON_TRANSIENT_DIAGNOSIS_PATTERN.test(value)) {
      return true
    }
  }

  return false
}

function isErrorOrDomException(value: unknown): value is Error {
  if (value instanceof Error) return true
  return (
    typeof DOMException !== 'undefined' && value instanceof DOMException
  )
}

function isAbortErrorInstance(error: Error): boolean {
  if (error.name !== 'AbortError') return false
  return !hasDisqualifyingMetadata(error as unknown as Record<string, unknown>)
}

function isBrowserFetchNetworkTypeError(error: Error): boolean {
  if (error.name !== 'TypeError' && !(error instanceof TypeError)) {
    return false
  }
  if (hasDisqualifyingMetadata(error as unknown as Record<string, unknown>)) {
    return false
  }
  const trimmed = error.message.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH) {
    return false
  }
  return BROWSER_NETWORK_TYPE_ERROR_PATTERNS.some((pattern) =>
    pattern.test(trimmed)
  )
}

function isVerifiedTransportErrorInstance(error: Error): boolean {
  const record = error as unknown as Record<string, unknown>
  if (hasDisqualifyingMetadata(record)) {
    return false
  }
  const code = record.code
  return (
    hasTransportText(error.message) ||
    (typeof code === 'string' && TRANSPORT_ERROR_CODES.has(code))
  )
}

function isVerifiedPostgrestTransportObject(
  value: Record<string, unknown>
): boolean {
  if (Array.isArray(value) || isErrorOrDomException(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  if (
    proto !== null &&
    (typeof proto !== 'object' || Object.getPrototypeOf(proto) !== null)
  ) {
    return false
  }
  const keys = Object.keys(value)
  if (
    keys.length < 4 ||
    !keys.every((key) => POSTGREST_TRANSPORT_KEYS.has(key))
  ) {
    return false
  }
  if (
    value.code !== '' ||
    !isBoundedString(value.message) ||
    value.message.length === 0 ||
    !isBoundedString(value.details) ||
    !isBoundedString(value.hint)
  ) {
    return false
  }
  if (hasDisqualifyingMetadata(value)) {
    return false
  }
  return hasTransportText(value.message) || hasTransportText(value.details)
}

function isAllowedOuterWrapperError(error: Error): boolean {
  if (error.name !== 'Error') return false
  if (!isBoundedString(error.message) || error.message.trim().length === 0) {
    return false
  }
  return !hasDisqualifyingMetadata(error as unknown as Record<string, unknown>)
}

/**
 * True when a React error boundary caught a client request abort or browser
 * native fetch network disconnect and the entire `.cause` chain is free of
 * actionable HTTP, SQL, auth, or application failure metadata.
 */
export function isTransientBrowserBoundaryError(error: unknown): boolean {
  try {
    return inspectTransientBrowserBoundaryError(error)
  } catch {
    // Unreadable metadata cannot establish that an error is transient.
    return false
  }
}

function inspectTransientBrowserBoundaryError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false
  }

  let current: unknown = error
  const seen = new Set<unknown>()
  let depth = 0
  let sawVerifiedTransient = false
  let lastNodeWasTransient = false

  while (current !== undefined && current !== null) {
    if (
      seen.has(current) ||
      depth >= MAX_CAUSE_DEPTH ||
      typeof current !== 'object'
    ) {
      return false
    }
    seen.add(current)
    depth += 1

    const record = current as Record<string, unknown>
    if (hasDisqualifyingMetadata(record)) {
      return false
    }

    if (isErrorOrDomException(current)) {
      const isTransientError =
        isAbortErrorInstance(current) ||
        isBrowserFetchNetworkTypeError(current) ||
        isVerifiedTransportErrorInstance(current)

      if (isTransientError) {
        sawVerifiedTransient = true
        lastNodeWasTransient = true
        current = record.cause
        continue
      }

      // Non-transient Error wrappers may only appear outside the transient
      // cause, never as a root cause beneath a transient error.
      if (
        !sawVerifiedTransient &&
        record.cause !== undefined &&
        record.cause !== null &&
        isAllowedOuterWrapperError(current)
      ) {
        lastNodeWasTransient = false
        current = record.cause
        continue
      }

      return false
    }

    if (isVerifiedPostgrestTransportObject(record)) {
      sawVerifiedTransient = true
      lastNodeWasTransient = true
      current = record.cause
      continue
    }

    return false
  }

  return sawVerifiedTransient && lastNodeWasTransient
}
