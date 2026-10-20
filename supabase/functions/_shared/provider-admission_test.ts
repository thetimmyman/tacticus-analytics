import { deepStrictEqual, strictEqual, rejects } from 'node:assert'
import {
  createProviderAdmission,
  createProviderRuntime,
  ProviderAdmissionError
} from './provider-admission.ts'

const dispatch = {
  domain: 'official' as const,
  account: 'a'.repeat(64),
  endpoint: '/api/v1/player',
  purpose: 'roster-fetch',
  priority: 'background' as const,
  timeoutMs: 5000
}
const url = 'https://api.tacticusgame.com/api/v1/player'

function authority(outcome: (body: Record<string, unknown>) => void) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const operation = String(input).split('/').at(-1)
    const body = JSON.parse(String(init?.body))
    if (operation === 'reserve' || operation === 'dispatch')
      return Promise.resolve(
        Response.json({
          status: operation === 'reserve' ? 'reserved' : 'dispatch',
          attemptId: body.attemptId,
          timeoutMs: dispatch.timeoutMs,
          [operation === 'reserve' ? 'claimUntil' : 'deadline']: new Date(
            Date.now() + 5000
          ).toISOString()
        })
      )
    if (operation === 'outcome') outcome(body)
    return Promise.resolve(Response.json({ status: 'continue' }))
  }
}

Deno.test(
  'admitted Deno bodies retain ownership until actual EOF',
  async () => {
    const outcomes: Record<string, unknown>[] = []
    let resolveOutcome!: () => void
    const done = new Promise<void>((resolve) => {
      resolveOutcome = resolve
    })
    let source!: ReadableStreamDefaultController<Uint8Array>
    let sends = 0
    const client = createProviderAdmission({
      authorityOrigin: 'http://authority.example.invalid',
      token: 'synthetic-control',
      controlFetch: authority((body) => {
        outcomes.push(body)
        resolveOutcome()
      }),
      physicalFetch: () => {
        sends++
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                source = controller
                controller.enqueue(new TextEncoder().encode('synthetic'))
              }
            })
          )
        )
      }
    })
    const response = await client.fetch(url, {}, dispatch)
    strictEqual(sends, 1)
    strictEqual(outcomes.length, 0)
    source.close()
    strictEqual(await response.text(), 'synthetic')
    await done
    strictEqual(outcomes.length, 1)
    strictEqual(outcomes[0].settled, true)
  }
)

Deno.test(
  'Deno refuses missing enrollment and retains full denied holds',
  async () => {
    let sends = 0,
      controls = 0
    const runtime = createProviderRuntime({
      settings: () => ({
        mode: 'enforce',
        authorityOrigin: 'http://authority.example.invalid',
        token: 'synthetic-control',
        accountLabelKey: 'K'.repeat(32)
      }),
      physicalFetch: () => {
        sends++
        return Promise.resolve(new Response('unexpected'))
      },
      controlFetch: () => {
        controls++
        return Promise.resolve(
          Response.json({
            status: 'denied',
            reason: 'provider-hold',
            retryAfterSeconds: 1e100
          })
        )
      }
    })
    await rejects(() => runtime.fetch(url), ProviderAdmissionError)
    strictEqual(controls, 0)
    await rejects(
      () =>
        runtime.fetch(
          url,
          { headers: { 'x-api-key': 'synthetic-key' } },
          {
            purpose: 'roster-fetch',
            trigger: 'scheduled',
            timeoutMs: 5000
          }
        ),
      (error) => {
        deepStrictEqual(
          (error as ProviderAdmissionError).retryAfterSeconds,
          1e100
        )
        return error instanceof ProviderAdmissionError
      }
    )
    strictEqual(sends, 0)
    strictEqual(controls, 1)
  }
)

Deno.test(
  'Deno refuses a stopped dispatch before any admission exchange',
  async () => {
    let controls = 0
    let stopped = true
    const runtime = createProviderRuntime({
      settings: () => ({
        mode: 'enforce',
        authorityOrigin: 'http://authority.example.invalid',
        token: 'synthetic-control',
        accountLabelKey: 'K'.repeat(32)
      }),
      outboundStopped: () => Promise.resolve(stopped),
      physicalFetch: () => Promise.resolve(new Response('unexpected')),
      controlFetch: () => {
        controls++
        return Promise.resolve(Response.json({ status: 'denied' }))
      }
    })
    const call = () =>
      runtime.fetch(
        url,
        { headers: { 'x-api-key': 'synthetic-key' } },
        { purpose: 'roster-fetch', trigger: 'scheduled', timeoutMs: 5000 }
      )

    await rejects(call, ProviderAdmissionError)
    strictEqual(controls, 0)
    stopped = false
    await rejects(call, ProviderAdmissionError)
    strictEqual(controls, 1, 'control: an open stop reaches admission')
  }
)
