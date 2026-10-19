import {
  createProviderRuntime,
  ProviderAdmissionError,
  type ProviderOperation
} from './provider-admission.ts'
import { prepareProviderObservation } from './provider-observation.ts'
import { outboundHalted } from './outbound-kill-switch.ts'
import { logger } from './logger.ts'

// This edge adapter is also type-checked through Node's shared-source tests.
// Deno supplies the runtime value; its full implementation is checked by Deno.
declare const Deno: { env: { get(name: string): string | undefined } }

const runtime = createProviderRuntime({
  settings: () => ({
    mode: Deno.env.get('PROVIDER_ADMISSION_MODE'),
    authorityOrigin: Deno.env.get('PROVIDER_ADMISSION_ORIGIN'),
    token: Deno.env.get('PROVIDER_ADMISSION_TOKEN'),
    accountLabelKey: Deno.env.get('PROVIDER_ACCOUNT_LABEL_KEY')
  }),
  physicalFetch: async (input, init = {}, context) => {
    const signal =
      init.signal ?? (input instanceof Request ? input.signal : null)
    signal?.throwIfAborted()
    if (!(input instanceof Request)) new Request(input, init)
    const preparation = prepareProviderObservation(input, init, {
      runtime: 'edge',
      accountLabelKey: Deno.env.get('PROVIDER_ACCOUNT_LABEL_KEY'),
      context,
      retry: null,
      emit: (record) => logger.info(record)
    })
    const observed =
      preparation instanceof Promise ? await preparation : preparation
    signal?.throwIfAborted()
    // Operator stop, checked after the caller snapshot so a refusal cannot
    // delay or alter what this dispatch would have observed. Nothing is sent.
    if (await outboundHalted()) throw new ProviderAdmissionError()
    return observed
      ? observed.run(() => globalThis.fetch(observed.input, observed.init))
      : globalThis.fetch(input, init)
  },
  controlFetch: (input, init) => globalThis.fetch(input, init)
})

export function edgeProviderFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  operation?: ProviderOperation
): Promise<Response> {
  return runtime.fetch(input, init, operation)
}
