/**
 * Retry for client-side Supabase auth calls. auth-js surfaces aborts both as
 * rejections (lock timeouts before the request is sent) and as a resolved
 * `{ error: AuthRetryableFetchError }`; both are retried, real auth errors never.
 */

export const TRANSIENT_AUTH_USER_MESSAGE =
  'The connection was interrupted before your request finished. You have NOT been locked out. We could not confirm whether the password request completed. If you were changing your password, try signing in with the new password before retrying. Otherwise, check your internet connection and try again. If you linked Discord or Google, you can also sign in with those.'

export function isTransientAuthError(err: unknown): boolean {
  if (err == null || (typeof err !== 'object' && typeof err !== 'string')) {
    return false
  }

  const e = err as { name?: unknown; message?: unknown }
  const name = (typeof e.name === 'string' ? e.name : '').toLowerCase()
  const message = (
    typeof e.message === 'string'
      ? e.message
      : typeof err === 'string'
        ? err
        : ''
  ).toLowerCase()

  // Includes "signal is aborted without reason" from the LockManager timeout.
  if (name === 'aborterror' || name === 'timeouterror') return true
  if (message.includes('aborted') || message.includes('signal is aborted')) {
    return true
  }

  // auth-js processLock acquire timeout: the request was never sent.
  if (name.includes('processlockacquiretimeout')) return true
  if (/acquiring .*lock/.test(message) && message.includes('timed out')) {
    return true
  }

  if (name === 'typeerror' && message.includes('fetch')) return true
  if (
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') // Safari's wording for a dropped fetch
  ) {
    return true
  }

  // AuthRetryableFetchError, returned as a resolved `{ error }`.
  if (name.includes('retryable')) return true

  return false
}

export function isTransientSupabaseResult(
  result: { error?: unknown } | null | undefined
): boolean {
  return isTransientAuthError(result?.error)
}

export interface TransientRetryOptions<T = unknown> {
  /** Additional attempts after the first (default 2). */
  retries?: number
  /** Doubles each attempt (default 400). */
  baseDelayMs?: number
  onRetry?: (attempt: number, errorOrResult: unknown) => void
  /** Flags a resolved value as transient; without it only rejections retry. */
  isRetryableResult?: (result: T) => boolean
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Retries transient failures with exponential backoff. When exhausted, returns
 * the last resolved value (so the caller's `{ error }` handling runs) or rethrows.
 */
export async function withTransientAuthRetry<T>(
  op: () => Promise<T>,
  options: TransientRetryOptions<T> = {}
): Promise<T> {
  const retries = Math.max(0, options.retries ?? 2)
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 400)
  const sleep = options.sleep ?? defaultSleep
  const { isRetryableResult, onRetry } = options

  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await op()
      if (attempt < retries && isRetryableResult?.(result)) {
        onRetry?.(attempt + 1, result)
        await sleep(baseDelayMs * 2 ** attempt)
        continue
      }
      return result
    } catch (err) {
      lastErr = err
      if (attempt >= retries || !isTransientAuthError(err)) throw err
      onRetry?.(attempt + 1, err)
      await sleep(baseDelayMs * 2 ** attempt)
    }
  }
  throw lastErr
}
