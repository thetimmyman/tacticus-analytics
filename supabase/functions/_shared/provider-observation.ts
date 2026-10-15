import {
  createProviderDispatchResolver,
  providerObservationPurpose,
  providerRequestDomain,
  providerRequestTarget,
  type ProviderPhysicalContext
} from './provider-admission.ts'

type Runtime = 'node' | 'edge'
type Fields = {
  schema_version: 1
  application: 'tacticus-analytics'
  runtime: Runtime
  domain: string
  endpoint: string
  purpose: string
  trigger: string
  account_label: string | null
  attribution: 'resolved' | 'unavailable'
  retry: boolean | null
}

export type ProviderObservationRecord = Readonly<
  Fields & {
    event: 'provider_dispatch' | 'provider_dispatch_result'
    correlation_id: string
    timestamp: string
    outcome?: 'fetch-resolved' | 'fetch-rejected'
    status?: number
    fetch_duration_ms?: number
    response_bytes?: null
    body_completion?: 'unknown'
    error_kind?: 'none' | 'aborted' | 'network'
  }
>

export function prepareProviderObservation(
  input: RequestInfo | URL,
  init: RequestInit,
  options: {
    runtime: Runtime
    officialOrigin?: string
    accountLabelKey?: string
    context?: ProviderPhysicalContext
    retry: boolean | null
    emit: (record: ProviderObservationRecord) => unknown
  }
) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const domain = providerRequestDomain(url, options.officialOrigin)
  if (!domain) return null
  // Snapshot attribution inputs without reading, cloning or buffering the body.
  const wireInput = input instanceof URL ? url.href : input
  const wireInit: RequestInit = {
    ...init,
    headers: new Headers(
      init.headers ?? (input instanceof Request ? input.headers : undefined)
    ),
    method: init.method ?? (input instanceof Request ? input.method : 'GET')
  }
  const signal =
    wireInit.signal ?? (input instanceof Request ? input.signal : null)
  const operation = options.context?.operation
  let endpoint = 'unknown'
  try {
    endpoint = providerRequestTarget(
      wireInput,
      wireInit,
      options.officialOrigin
    ).endpoint
  } catch {
    /* Unregistered traffic stays explicit and unlabelled. */
  }
  const fields: Fields = {
    schema_version: 1,
    application: 'tacticus-analytics',
    runtime: options.runtime,
    domain,
    endpoint,
    purpose: providerObservationPurpose(
      options.context?.dispatch?.purpose ?? operation?.purpose
    ),
    trigger:
      operation && ['scheduled', 'user', 'admin'].includes(operation.trigger)
        ? operation.trigger
        : 'unknown',
    account_label: null,
    attribution: 'unavailable',
    retry: options.retry
  }
  const emit = (record: ProviderObservationRecord) => {
    try {
      const receipt = options.emit(Object.freeze(record))
      if (receipt && typeof receipt === 'object' && 'then' in receipt)
        void Promise.resolve(receipt).catch(() => undefined)
    } catch {
      /* Observation must not change transport behavior. */
    }
  }
  const prepared = () => ({
    input: wireInput,
    init: wireInit,
    run(send: () => Promise<Response>): Promise<Response> {
      let correlation: string | undefined
      let started = 0
      try {
        correlation = `corr_${crypto.randomUUID()}`
        emit({
          ...fields,
          event: 'provider_dispatch',
          correlation_id: correlation,
          timestamp: new Date().toISOString()
        })
        started = performance.now()
      } catch {
        correlation = undefined
        /* An unavailable observer never refuses a physical request. */
      }
      const finish = (response?: Response) => {
        if (!correlation) return
        try {
          emit({
            ...fields,
            event: 'provider_dispatch_result',
            correlation_id: correlation,
            timestamp: new Date().toISOString(),
            outcome: response ? 'fetch-resolved' : 'fetch-rejected',
            status: response?.status ?? 0,
            fetch_duration_ms: Math.max(0, performance.now() - started),
            response_bytes: null,
            body_completion: 'unknown',
            error_kind: response
              ? 'none'
              : signal?.aborted
                ? 'aborted'
                : 'network'
          })
        } catch {
          /* Metadata failure does not replace a provider result. */
        }
      }
      try {
        return send().then(
          (response) => {
            finish(response)
            return response
          },
          (error) => {
            finish()
            throw error
          }
        )
      } catch (error) {
        finish()
        return Promise.reject(error)
      }
    }
  })
  const dispatch = options.context?.dispatch
  if (
    dispatch &&
    dispatch.domain === domain &&
    dispatch.endpoint === endpoint &&
    /^[0-9a-f]{64}$/.test(dispatch.account)
  ) {
    fields.account_label = dispatch.account
    fields.attribution = 'resolved'
    return prepared()
  }
  if (options.accountLabelKey && operation && endpoint !== 'unknown') {
    try {
      return createProviderDispatchResolver({
        key: options.accountLabelKey,
        officialOrigin: options.officialOrigin
      })(wireInput, wireInit, operation).then(
        (dispatch) => {
          fields.account_label = dispatch.account
          fields.attribution = 'resolved'
          return prepared()
        },
        () => prepared()
      )
    } catch {
      /* Missing attribution stays unknown, rather than becoming a raw label. */
    }
  }
  return prepared()
}
