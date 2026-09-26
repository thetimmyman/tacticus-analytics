export type ErrorPayload = {
  error?: string | { message?: string }
  message?: string
}

/**
 * Not the utils/error-message.ts helper and must not delegate to it: this one
 * skips whitespace-only `error` strings and falls through to `message`.
 */
export const extractErrorMessage = (
  payload: ErrorPayload | null,
  fallback: string
): string => {
  if (!payload) return fallback
  if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
    return payload.error
  }
  if (
    payload.error &&
    typeof payload.error === 'object' &&
    typeof payload.error.message === 'string'
  ) {
    return payload.error.message
  }
  if (
    typeof payload.message === 'string' &&
    payload.message.trim().length > 0
  ) {
    return payload.message
  }
  return fallback
}

export interface FetchJsonOptions<T> {
  params?: URLSearchParams
  /** Thrown when `response.ok` is false and the body has no error message. */
  errorFallback: string
  invalidMessage: string
  validate: (payload: unknown) => payload is T
}

export async function fetchJson<T>(
  endpoint: string,
  options: FetchJsonOptions<T>
): Promise<T> {
  const { params, errorFallback, invalidMessage, validate } = options
  const url = params ? `${endpoint}?${params.toString()}` : endpoint

  const response = await fetch(url)
  const payload = (await response.json().catch(() => null)) as unknown

  if (!response.ok) {
    throw new Error(
      extractErrorMessage(payload as ErrorPayload | null, errorFallback)
    )
  }

  if (!validate(payload)) {
    throw new Error(invalidMessage)
  }

  return payload
}

export interface PostJsonOptions<T> {
  errorFallback: string
  /** Defaults to `errorFallback`. */
  invalidMessage?: string
  validate?: FetchJsonOptions<T>['validate']
  method?: 'POST' | 'PUT' | 'PATCH'
}

/** JSON-body sibling of {@link fetchJson}, with the same error extraction; `validate` is optional. */
export async function postJson<T = unknown>(
  endpoint: string,
  body: object,
  options: PostJsonOptions<T>
): Promise<T> {
  const { errorFallback, invalidMessage, validate, method = 'POST' } = options

  const response = await fetch(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const payload = (await response.json().catch(() => null)) as unknown

  if (!response.ok) {
    throw new Error(
      extractErrorMessage(payload as ErrorPayload | null, errorFallback)
    )
  }

  if (validate && !validate(payload)) {
    throw new Error(invalidMessage ?? errorFallback)
  }

  return payload as T
}
