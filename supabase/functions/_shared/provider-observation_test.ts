import {
  deepStrictEqual,
  strictEqual,
  rejects,
  match,
  doesNotMatch
} from 'node:assert'
import { edgeProviderFetch } from './provider-fetch.ts'

const url = 'https://api.tacticusgame.com/api/v1/player'
const operation = {
  purpose: 'roster-fetch',
  trigger: 'user' as const,
  timeoutMs: 5000
}

async function fixture(run: (lines: string[]) => Promise<void>) {
  const names = ['PROVIDER_ADMISSION_MODE', 'PROVIDER_ACCOUNT_LABEL_KEY']
  const previous = names.map((name) => Deno.env.get(name))
  const fetch = globalThis.fetch
  const log = console.log
  const lines: string[] = []
  try {
    Deno.env.set(names[0], 'off')
    Deno.env.delete(names[1])
    console.log = (line) => {
      lines.push(String(line))
    }
    await run(lines)
  } finally {
    globalThis.fetch = fetch
    console.log = log
    names.forEach((name, i) =>
      previous[i] === undefined
        ? Deno.env.delete(name)
        : Deno.env.set(name, previous[i]!)
    )
  }
}

const records = (lines: string[]) =>
  lines.map(
    (line) =>
      JSON.parse(line.slice(line.indexOf('{'))) as Record<string, unknown>
  )

Deno.test('edge fetch duration excludes synchronous observer work', () =>
  fixture(async (lines) => {
    const descriptor = Object.getOwnPropertyDescriptor(performance, 'now')
    const capture = console.log
    let clock = 0
    try {
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => clock
      })
      console.log = (line) => {
        capture(line)
        clock += 100
      }
      globalThis.fetch = () => {
        clock += 7
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      await edgeProviderFetch(url)
      strictEqual(records(lines)[1].fetch_duration_ms, 7)
    } finally {
      if (descriptor) Object.defineProperty(performance, 'now', descriptor)
      else Reflect.deleteProperty(performance, 'now')
    }
  })
)

Deno.test(
  'edge logger records fetch completion without pulling or cloning a response body',
  () =>
    fixture(async (lines) => {
      let pulls = 0,
        cancelled = 0,
        sends = 0
      const response = new Response(
        new ReadableStream(
          {
            pull() {
              pulls++
            },
            cancel() {
              cancelled++
            }
          },
          { highWaterMark: 0 }
        ),
        { headers: { 'content-length': '9000' } }
      )
      globalThis.fetch = () => {
        sends++
        return Promise.resolve(response)
      }
      const result = await edgeProviderFetch(url)
      strictEqual(result, response)
      strictEqual(result.bodyUsed, false)
      strictEqual(pulls, 0)
      strictEqual(sends, 1)
      const events = records(lines)
      strictEqual(events.length, 2)
      deepStrictEqual(
        events.map((r) => r.event),
        ['provider_dispatch', 'provider_dispatch_result']
      )
      strictEqual(events[0].runtime, 'edge')
      strictEqual(events[0].purpose, 'unknown')
      strictEqual(events[0].account_label, null)
      strictEqual(events[0].attribution, 'unavailable')
      strictEqual(events[0].retry, null)
      match(String(events[0].correlation_id), /^corr_[0-9a-f-]{36}$/)
      strictEqual(events[1].correlation_id, events[0].correlation_id)
      strictEqual(events[1].outcome, 'fetch-resolved')
      strictEqual(events[1].response_bytes, null)
      strictEqual(events[1].body_completion, 'unknown')
      await result.body!.cancel()
      strictEqual(cancelled, 1)
      strictEqual(records(lines).length, 2)
    })
)

Deno.test(
  'edge attribution uses keyed snapshots and never emits raw credentials or unknown paths and purposes',
  () =>
    fixture(async (lines) => {
      Deno.env.set('PROVIDER_ACCOUNT_LABEL_KEY', 'K'.repeat(32))
      const seen: string[] = []
      globalThis.fetch = (input, init) => {
        seen.push(
          new Headers(
            init?.headers ??
              (input instanceof Request ? input.headers : undefined)
          ).get('x-api-key') ?? ''
        )
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      const headers = new Headers({ 'x-api-key': 'synthetic-player-key' })
      const target = new URL(url)
      const pending = edgeProviderFetch(target, { headers }, operation)
      headers.set('x-api-key', 'synthetic-mutated-key')
      target.pathname = '/synthetic-private-path'
      await pending
      await edgeProviderFetch(
        'https://api.tacticusgame.com/synthetic-private-path?session=synthetic-session',
        {},
        { ...operation, purpose: 'synthetic-private-purpose' }
      )
      const events = records(lines).filter(
        (r) => r.event === 'provider_dispatch'
      )
      strictEqual(events.length, 2)
      strictEqual(seen[0], 'synthetic-player-key')
      strictEqual(events[0].endpoint, '/api/v1/player')
      strictEqual(events[0].purpose, 'roster-fetch')
      strictEqual(events[0].attribution, 'resolved')
      match(String(events[0].account_label), /^[0-9a-f]{64}$/)
      strictEqual(events[1].endpoint, 'unknown')
      strictEqual(events[1].purpose, 'unknown')
      strictEqual(events[1].account_label, null)
      doesNotMatch(
        lines.join('\n'),
        /synthetic-(?:player-key|mutated-key|private-path|session|private-purpose|observation-label-key)/
      )
    })
)

Deno.test(
  'edge failures retain original errors and cancellation while observer failures cannot refuse sends',
  () =>
    fixture(async (lines) => {
      const abort = new AbortController()
      const failure = new Error('synthetic-private-error')
      let sends = 0
      globalThis.fetch = () => {
        sends++
        abort.abort()
        return Promise.reject(failure)
      }
      await rejects(
        () => edgeProviderFetch(new Request(url, { signal: abort.signal })),
        (error) => error === failure
      )
      strictEqual(sends, 1)
      const events = records(lines)
      strictEqual(events.length, 2)
      strictEqual(events[1].error_kind, 'aborted')
      strictEqual(events[1].outcome, 'fetch-rejected')
      doesNotMatch(lines.join('\n'), /synthetic-private-error/)
      await rejects(() => edgeProviderFetch(url, { signal: abort.signal }))
      strictEqual(sends, 1)
      strictEqual(records(lines).length, 2)
      const response = new Response(null, { status: 204 })
      globalThis.fetch = () => {
        sends++
        return Promise.resolve(response)
      }
      console.log = () => {
        throw new Error('synthetic-observer-failure')
      }
      strictEqual(await edgeProviderFetch(url), response)
      strictEqual(sends, 2)
    })
)
