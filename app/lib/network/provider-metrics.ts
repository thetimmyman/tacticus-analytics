import { AsyncLocalStorage } from 'node:async_hooks'
import { API_URLS } from '@tacticus/app-core/api-constants'
import { createProviderRuntime } from '@/supabase/functions/_shared/provider-admission'
import type { ProviderOperation } from '@/supabase/functions/_shared/provider-admission'

export interface ProviderMetrics {
  api_calls: number
  api_errors: number
  api_retry_count: number
}

interface PhysicalAttempt {
  metrics: ProviderMetrics
  started: boolean
  failed: boolean
}

const metricsScope = new AsyncLocalStorage<{
  metrics?: ProviderMetrics
  isRetry: boolean
  operation?: ProviderOperation
  attempt?: PhysicalAttempt
}>()
const providerHosts = new Set([
  'api.tacticusgame.com',
  'api-live.loki.snowprintstudios.com',
  'cdn.loki.snowprintstudios.com',
  'websocket-live.loki.snowprintstudios.com'
])

function isProviderHost(hostname: string): boolean {
  if (providerHosts.has(hostname)) return true
  try {
    return hostname === new URL(API_URLS.TACTICUS.BASE).hostname
  } catch {
    return false
  }
}

export function currentProviderMetrics(): ProviderMetrics | null {
  const metrics = metricsScope.getStore()?.metrics
  return metrics ? { ...metrics } : null
}

export async function captureProviderMetrics<T>(
  operation: () => Promise<T>,
  context?: ProviderOperation
): Promise<{ result: T; metrics: ProviderMetrics }> {
  const metrics: ProviderMetrics = {
    api_calls: 0,
    api_errors: 0,
    api_retry_count: 0
  }
  const result = await metricsScope.run(
    {
      ...metricsScope.getStore(),
      metrics,
      isRetry: false,
      ...(context && { operation: context })
    },
    operation
  )
  return { result, metrics: { ...metrics } }
}

export function withProviderRetry<T>(
  isRetry: boolean,
  operation: () => Promise<T>
): Promise<T> {
  const context = metricsScope.getStore()
  return context
    ? metricsScope.run({ ...context, isRetry }, operation)
    : operation()
}

/** Attribution shares the existing async scope with physical counters and retry state. */
export function withProviderOperation<T>(
  context: ProviderOperation,
  operation: () => Promise<T>
): Promise<T> {
  const current = metricsScope.getStore()
  return metricsScope.run(
    { ...current, isRetry: current?.isRetry ?? false, operation: context },
    operation
  )
}

const providerRuntime = createProviderRuntime({
  officialOrigin: (() => {
    try {
      return new URL(API_URLS.TACTICUS.BASE).origin
    } catch {
      return undefined
    }
  })(),
  settings: () => ({
    mode: process.env.PROVIDER_ADMISSION_MODE,
    authorityOrigin: process.env.PROVIDER_ADMISSION_ORIGIN,
    token: process.env.PROVIDER_ADMISSION_TOKEN,
    accountLabelKey: process.env.PROVIDER_ACCOUNT_LABEL_KEY
  }),
  physicalFetch: (input, init) => physicalProviderFetch(input, init),
  controlFetch: (input, init) => globalThis.fetch(input, init)
})

export function providerFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  isRetry = false,
  operation?: ProviderOperation
): Promise<Response> {
  const context = metricsScope.getStore()
  const execute = () =>
    providerRuntime.fetch(
      input,
      init,
      metricsScope.getStore()?.operation ?? operation
    )
  if (!context?.metrics)
    return withProviderRetry(isRetry || context?.isRetry === true, execute)
  const attempt: PhysicalAttempt = {
    metrics: context.metrics,
    started: false,
    failed: false
  }
  return metricsScope.run(
    { ...context, isRetry: isRetry || context.isRetry, attempt },
    async () => {
      try {
        const response = await execute()
        return attempt.started
          ? observeProviderResponse(response, attempt)
          : response
      } catch (error) {
        markAttemptFailure(attempt)
        throw error
      }
    }
  )
}

function markAttemptFailure(attempt: PhysicalAttempt | undefined): void {
  if (!attempt?.started || attempt.failed) return
  attempt.failed = true
  attempt.metrics.api_errors++
}

function observeProviderResponse(
  response: Response,
  attempt: PhysicalAttempt
): Response {
  const fail = (error: unknown): never => {
    markAttemptFailure(attempt)
    throw error
  }
  const guarded =
    (target: object, method: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      try {
        return Promise.resolve(Reflect.apply(method, target, args)).catch(fail)
      } catch (error) {
        return fail(error)
      }
    }
  const wrapReader = (reader: object) =>
    new Proxy(reader, {
      get(target, key) {
        const value = Reflect.get(target, key, target)
        if (typeof value !== 'function') return value
        return key === 'read' || key === 'cancel'
          ? guarded(target, value)
          : value.bind(target)
      }
    })
  const wrapResponse = (value: Response): Response => {
    let body: ReadableStream | null | undefined
    return new Proxy(value, {
      get(target, key) {
        const member = Reflect.get(target, key, target)
        if (key === 'body' && member) {
          body ??= new Proxy(member, {
            get(stream, streamKey) {
              const method = Reflect.get(stream, streamKey, stream)
              if (typeof method !== 'function') return method
              if (streamKey === 'getReader')
                return (...args: unknown[]) =>
                  wrapReader(Reflect.apply(method, stream, args))
              if (streamKey === 'cancel' || streamKey === 'pipeTo')
                return guarded(stream, method)
              return method.bind(stream)
            }
          })
          return body
        }
        if (typeof member !== 'function') return member
        if (key === 'clone') return () => wrapResponse(target.clone())
        if (
          ['json', 'text', 'arrayBuffer', 'blob', 'formData', 'bytes'].includes(
            String(key)
          )
        )
          return guarded(target, member)
        return member.bind(target)
      }
    })
  }
  return wrapResponse(response)
}

/** Count only the admitted physical send, excluding control exchanges. */

async function physicalProviderFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  isRetry = false
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!isProviderHost(url.hostname)) return globalThis.fetch(input, init)
  init = { ...init, redirect: 'error' }
  const signal = init.signal ?? (input instanceof Request ? input.signal : null)
  signal?.throwIfAborted()
  // Validate ordinary request configuration before recording a network attempt.
  if (!(input instanceof Request)) new Request(input, init)
  signal?.throwIfAborted()
  const context = metricsScope.getStore()
  const metrics = context?.metrics
  if (metrics) {
    metrics.api_calls++
    if (isRetry || context?.isRetry) metrics.api_retry_count++
  }
  const attempt = context?.attempt
  if (attempt) attempt.started = true
  try {
    const response = await globalThis.fetch(input, init)
    if (!response.ok) markAttemptFailure(attempt)
    return response
  } catch (error) {
    markAttemptFailure(attempt)
    throw error
  }
}
