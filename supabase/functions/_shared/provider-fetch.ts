import {
  createProviderRuntime,
  type ProviderOperation
} from './provider-admission.ts'

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
  physicalFetch: (input, init) => globalThis.fetch(input, init),
  controlFetch: (input, init) => globalThis.fetch(input, init)
})

export function edgeProviderFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  operation?: ProviderOperation
): Promise<Response> {
  return runtime.fetch(input, init, operation)
}
