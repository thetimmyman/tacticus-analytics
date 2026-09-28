import { describe, it, expect, vi } from 'vitest'
import {
  isTransientAuthError,
  isTransientSupabaseResult,
  TRANSIENT_AUTH_USER_MESSAGE,
  withTransientAuthRetry
} from '@/app/lib/auth/retry-transient'

// What the browser throws when an AbortSignal fires with no reason.
const abortError = () => {
  const e = new Error('signal is aborted without reason')
  e.name = 'AbortError'
  return e
}

// Supabase resolves (never rejects) transient failures as { error }.
const retryableResult = () => ({
  data: { user: null },
  error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' }
})
const cleanResult = () => ({ data: { user: { id: '1' } }, error: null })

describe('isTransientAuthError', () => {
  it('does not overstate password state in the residual user message', () => {
    expect(TRANSIENT_AUTH_USER_MESSAGE).toContain('NOT been locked out')
    expect(TRANSIENT_AUTH_USER_MESSAGE).toContain('could not confirm')
    expect(TRANSIENT_AUTH_USER_MESSAGE).not.toContain('was not changed')
  })

  it('treats fetch aborts as transient', () => {
    expect(isTransientAuthError(abortError())).toBe(true)
    expect(
      isTransientAuthError({ name: 'AbortError', message: 'aborted' })
    ).toBe(true)
    expect(isTransientAuthError({ name: 'TimeoutError', message: '' })).toBe(
      true
    )
    expect(isTransientAuthError(new Error('The operation was aborted'))).toBe(
      true
    )
  })

  it('treats the auth-js processLock acquire timeout as transient', () => {
    expect(
      isTransientAuthError(
        new Error(
          'Acquiring process lock with name "lock:tacticus-auth-token" timed out'
        )
      )
    ).toBe(true)
    expect(
      isTransientAuthError({
        name: 'ProcessLockAcquireTimeoutError',
        message: ''
      })
    ).toBe(true)
    expect(
      isTransientAuthError({
        name: 'processlockacquiretimeouterror',
        message: 'x'
      })
    ).toBe(true)
    // 'timed out' WITHOUT the lock wording is not this signature.
    expect(isTransientAuthError(new Error('Request timed out'))).toBe(false)
  })

  it('treats network-level fetch failures as transient', () => {
    expect(isTransientAuthError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isTransientAuthError(new Error('NetworkError'))).toBe(true)
    expect(isTransientAuthError(new Error('Load failed'))).toBe(true)
    expect(
      isTransientAuthError({ name: 'AuthRetryableFetchError', message: 'x' })
    ).toBe(true)
  })

  it('does NOT treat real credential/auth errors as transient', () => {
    expect(
      isTransientAuthError(
        Object.assign(new Error('Invalid login credentials'), {
          name: 'AuthApiError'
        })
      )
    ).toBe(false)
    expect(
      isTransientAuthError({
        name: 'AuthApiError',
        message: 'email rate limit exceeded'
      })
    ).toBe(false)
    expect(
      isTransientAuthError({
        name: 'AuthApiError',
        message: 'New password should be different from the old password'
      })
    ).toBe(false)
    expect(isTransientAuthError(new Error('Password too short'))).toBe(false)
  })

  it('is null/garbage safe', () => {
    expect(isTransientAuthError(null)).toBe(false)
    expect(isTransientAuthError(undefined)).toBe(false)
    expect(isTransientAuthError(42)).toBe(false)
    expect(isTransientAuthError({})).toBe(false)
  })
})

describe('isTransientSupabaseResult', () => {
  it('is true only for a resolved { error } that is transient', () => {
    expect(isTransientSupabaseResult(retryableResult())).toBe(true)
    expect(isTransientSupabaseResult(cleanResult())).toBe(false)
    expect(
      isTransientSupabaseResult({
        error: { name: 'AuthApiError', message: 'Invalid login credentials' }
      })
    ).toBe(false)
    expect(isTransientSupabaseResult(null)).toBe(false)
    expect(isTransientSupabaseResult(undefined)).toBe(false)
  })
})

describe('withTransientAuthRetry', () => {
  const noSleep = () => Promise.resolve()

  it('returns the value on first success without retrying', async () => {
    const op = vi.fn().mockResolvedValue('ok')
    await expect(withTransientAuthRetry(op, { sleep: noSleep })).resolves.toBe(
      'ok'
    )
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('retries a transient REJECTION then succeeds', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(abortError())
      .mockResolvedValue('recovered')
    const onRetry = vi.fn()
    await expect(
      withTransientAuthRetry(op, { sleep: noSleep, onRetry })
    ).resolves.toBe('recovered')
    expect(op).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error))
  })

  it('exhausts retries on a persistent transient rejection and rethrows', async () => {
    const op = vi.fn().mockRejectedValue(abortError())
    await expect(
      withTransientAuthRetry(op, { retries: 2, sleep: noSleep })
    ).rejects.toThrow('signal is aborted without reason')
    expect(op).toHaveBeenCalledTimes(3) // 1 + 2 retries
  })

  it('does NOT retry a non-transient rejection', async () => {
    const op = vi.fn().mockRejectedValue(new Error('Invalid login credentials'))
    await expect(
      withTransientAuthRetry(op, { sleep: noSleep })
    ).rejects.toThrow('Invalid login credentials')
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('retries a RESOLVED transient { error } (Supabase path) then succeeds', async () => {
    const ok = cleanResult()
    const op = vi
      .fn()
      .mockResolvedValueOnce(retryableResult())
      .mockResolvedValue(ok)
    await expect(
      withTransientAuthRetry(op, {
        sleep: noSleep,
        isRetryableResult: isTransientSupabaseResult
      })
    ).resolves.toBe(ok)
    expect(op).toHaveBeenCalledTimes(2)
  })

  it('returns the last resolved { error } (not throw) when transient retries are exhausted', async () => {
    const op = vi.fn().mockResolvedValue(retryableResult())
    const result = (await withTransientAuthRetry(op, {
      retries: 2,
      sleep: noSleep,
      isRetryableResult: isTransientSupabaseResult
    })) as ReturnType<typeof retryableResult>
    expect(result.error?.name).toBe('AuthRetryableFetchError')
    expect(op).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry a resolved NON-transient { error }', async () => {
    const result = {
      data: null,
      error: { name: 'AuthApiError', message: 'rate limited' }
    }
    const op = vi.fn().mockResolvedValue(result)
    await expect(
      withTransientAuthRetry(op, {
        sleep: noSleep,
        isRetryableResult: isTransientSupabaseResult
      })
    ).resolves.toBe(result)
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('passes a resolved value through unretried when no isRetryableResult is given', async () => {
    const result = retryableResult()
    const op = vi.fn().mockResolvedValue(result)
    await expect(withTransientAuthRetry(op, { sleep: noSleep })).resolves.toBe(
      result
    )
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('applies exponential backoff via the injected sleep', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(abortError())
      .mockRejectedValueOnce(abortError())
      .mockResolvedValue('ok')
    const sleeps: number[] = []
    const sleep = (ms: number) => {
      sleeps.push(ms)
      return Promise.resolve()
    }
    await expect(
      withTransientAuthRetry(op, { baseDelayMs: 100, sleep })
    ).resolves.toBe('ok')
    expect(sleeps).toEqual([100, 200])
  })
})
