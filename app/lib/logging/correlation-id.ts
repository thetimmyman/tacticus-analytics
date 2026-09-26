import {
  isSafeCorrelationValue,
  normalizeLogFieldName
} from '@tacticus/app-core/logging-sanitizer'

const REQUEST_IDS = new WeakMap<object, string>()

export const normalizeCorrelationFieldName = normalizeLogFieldName
export { isSafeCorrelationValue }

export function isSafeRequestId(value: unknown): value is string {
  return isSafeCorrelationValue('requestId', value)
}

export function associateRequestId(request: object, requestId: string): void {
  if (isSafeRequestId(requestId)) REQUEST_IDS.set(request, requestId)
}

export function associatedRequestId(request?: object): string | undefined {
  return request ? REQUEST_IDS.get(request) : undefined
}

// Correlation values bypass PII redaction only when their shape proves they are
// opaque generated IDs; a field name alone is not enough, since public headers can set it.
