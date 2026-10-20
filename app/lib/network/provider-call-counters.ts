import { Counter } from 'prom-client'
import { register } from '@/app/lib/metrics/registry'

/**
 * These counters cover the Node application runtime only. Dispatches made by
 * the edge functions use a separate fetch path and are not counted here.
 *
 * Labels are bounded on purpose: domain and endpoint come from the reviewed
 * route inventory, and purpose from the dispatch operation. No account label,
 * no caller-supplied path, no per-user dimension — those would explode the
 * series count and make the counter useless.
 */
export interface ProviderCallLabels {
  domain: string
  endpoint: string
  purpose: string
}

const LABEL_NAMES = ['domain', 'endpoint', 'purpose'] as const

const calls = new Counter({
  name: 'tacticus_app_provider_calls_total',
  help: 'Admitted outbound provider dispatches sent by the Node application runtime, by reviewed endpoint and purpose',
  labelNames: [...LABEL_NAMES],
  registers: [register]
})

const failures = new Counter({
  name: 'tacticus_app_provider_failures_total',
  help: 'Node application runtime provider dispatches that failed, returned an error status or failed while the body was read',
  labelNames: [...LABEL_NAMES],
  registers: [register]
})

const retries = new Counter({
  name: 'tacticus_app_provider_retries_total',
  help: 'Node application runtime provider dispatches that were retries of an earlier attempt',
  labelNames: [...LABEL_NAMES],
  registers: [register]
})

const bounded = (value: string): string => (value ? value : 'unknown')

/** Counting must never break a dispatch, so nothing here may throw. */
export function countProviderCall(labels: ProviderCallLabels): void {
  try {
    calls.inc({
      domain: bounded(labels.domain),
      endpoint: bounded(labels.endpoint),
      purpose: bounded(labels.purpose)
    })
  } catch {
    /* A lost sample must not refuse the request. */
  }
}

export function countProviderFailure(labels: ProviderCallLabels): void {
  try {
    failures.inc({
      domain: bounded(labels.domain),
      endpoint: bounded(labels.endpoint),
      purpose: bounded(labels.purpose)
    })
  } catch {
    /* A lost sample must not refuse the request. */
  }
}

export function countProviderRetry(labels: ProviderCallLabels): void {
  try {
    retries.inc({
      domain: bounded(labels.domain),
      endpoint: bounded(labels.endpoint),
      purpose: bounded(labels.purpose)
    })
  } catch {
    /* A lost sample must not refuse the request. */
  }
}
