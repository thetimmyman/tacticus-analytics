import { createComponentLogger } from '@/app/lib/logging'
import { withRetry, TACTICUS_API_POLICY } from '@/app/lib/resilience'
import type { WithRetryOptions } from '@/app/lib/resilience'
import { API_URLS, API_REQUEST_CONFIG } from '@tacticus/app-core/api-constants'
import { withResponseBodyTimeout } from '@/app/lib/utils/async-timeout'

export const logger = createComponentLogger('lib.sync.api-operations')

export const CONFIG = {
  api: {
    baseUrl: API_URLS.TACTICUS.BASE,
    lokiUrl: API_URLS.TACTICUS.LOKI,
    requestTimeout: API_REQUEST_CONFIG.TIMEOUTS.SHORT,
    lokiTimeout: 15000
  }
} as const

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function fetchWithAbortTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  responseLabel: string,
  behavior: { convertAbortToTimeoutError?: boolean } = {}
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    return withResponseBodyTimeout(response, timeoutMs, responseLabel, {
      onTimeout: () => controller.abort()
    })
  } catch (error) {
    if (
      behavior.convertAbortToTimeoutError &&
      error instanceof Error &&
      error.name === 'AbortError'
    ) {
      throw new Error(`Request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchWithCircuitBreaker(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  timeoutMs: number = CONFIG.api.requestTimeout
): Promise<Response> {
  const policy: WithRetryOptions = {
    ...TACTICUS_API_POLICY,
    maxAttempts: maxRetries + 1
  }
  return withRetry(async () => {
    const response = await fetchWithAbortTimeout(
      url,
      options,
      timeoutMs,
      'sync API response',
      { convertAbortToTimeoutError: true }
    )
    if (!response.ok && response.status >= 500) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return response
  }, policy)
}
