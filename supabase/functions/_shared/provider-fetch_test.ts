import { strictEqual, rejects } from 'node:assert'
import { ProviderAdmissionError } from './provider-admission.ts'
import { edgeProviderFetch } from './provider-fetch.ts'
import {
  timeoutFetch,
  retryWithTimeout,
  type EdgeFunctionTimeouts
} from './timeout-utils.ts'

Deno.test(
  'edge enrollment refuses locally without retrying or losing caller cancellation',
  async () => {
    const names = [
      'PROVIDER_ADMISSION_MODE',
      'PROVIDER_ADMISSION_ORIGIN',
      'PROVIDER_ADMISSION_TOKEN',
      'PROVIDER_ACCOUNT_LABEL_KEY'
    ]
    const previous = names.map((name) => Deno.env.get(name))
    const original = globalThis.fetch
    let calls = 0
    try {
      names.forEach((name, i) =>
        Deno.env.set(
          name,
          [
            'enforce',
            'http://authority.example.invalid',
            'synthetic-token',
            'K'.repeat(32)
          ][i]
        )
      )
      globalThis.fetch = () => {
        calls++
        return Promise.resolve(
          Response.json({
            status: 'denied',
            reason: 'disabled',
            retryAfterSeconds: 1e100
          })
        )
      }
      const operation = {
        purpose: 'guild-sync',
        trigger: 'scheduled' as const,
        timeoutMs: 5000
      }
      const url = 'https://api.tacticusgame.com/api/v1/guild'
      await rejects(
        () =>
          edgeProviderFetch(
            url,
            { headers: { 'x-api-key': 'synthetic-key' } },
            operation
          ),
        ProviderAdmissionError
      )
      strictEqual(calls, 1)
      const timeouts = {
        createSignal: () => new AbortController().signal,
        canStartOperation: () => true,
        getTimeout: () => 5000,
        getMetrics: () => ({ remaining: 60000 })
      } as unknown as EdgeFunctionTimeouts
      let attempts = 0
      const refusal = new ProviderAdmissionError(1e100)
      await rejects(
        () =>
          retryWithTimeout(
            () => {
              attempts++
              return Promise.reject(refusal)
            },
            'api_request',
            timeouts,
            1
          ),
        (error) => error === refusal
      )
      strictEqual(attempts, 1)
      const abort = new AbortController()
      abort.abort(new Error('synthetic-stop'))
      await rejects(
        () =>
          timeoutFetch(
            url,
            { headers: { 'x-api-key': 'synthetic-key' }, signal: abort.signal },
            'api_request',
            timeouts,
            operation
          ),
        /synthetic-stop/
      )
      strictEqual(calls, 1)
    } finally {
      globalThis.fetch = original
      names.forEach((name, i) =>
        previous[i] === undefined
          ? Deno.env.delete(name)
          : Deno.env.set(name, previous[i]!)
      )
    }
  }
)
