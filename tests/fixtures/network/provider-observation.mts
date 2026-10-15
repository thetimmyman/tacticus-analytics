import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import {
  captureProviderMetrics,
  providerFetch,
  withProviderOperation
} from '../../../app/lib/network/provider-metrics.ts'
import { getSharedFetch } from '../../../app/lib/network/undici-agent.ts'
import { logger } from '../../../app/lib/logging/logger.ts'

let physicalRequests = 0
let controls = 0
const scenario = process.argv[2] ?? 'unavailable'
const receivedKeys: string[] = []
const server = createServer((request, response) => {
  physicalRequests++
  receivedKeys.push(String(request.headers['x-api-key'] ?? ''))
  request.resume()
  request.on('end', () => {
    response.setHeader('content-type', 'application/json')
    response.end(scenario === 'decode' ? '{' : '{"synthetic":true}')
  })
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const endpoint = `http://127.0.0.1:${address.port}`
const nativeFetch = getSharedFetch()

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname === 'synthetic-control.invalid') {
    controls++
    const action = url.pathname.split('/').at(-1)
    const body = JSON.parse(String(init?.body))
    return Promise.resolve(
      Response.json(
        scenario === 'refused'
          ? { status: 'denied', reason: 'disabled', retryAfterSeconds: 60 }
          : action === 'reserve' || action === 'dispatch'
            ? {
                status: action === 'reserve' ? 'reserved' : 'dispatch',
                attemptId: body.attemptId,
                timeoutMs: 5000,
                [action === 'reserve' ? 'claimUntil' : 'deadline']: new Date(
                  Date.now() + 5000
                ).toISOString()
              }
            : { status: 'continue' }
      )
    )
  }
  if (url.hostname === 'discord.com' || url.hostname === 'synthetic.invalid')
    return Promise.resolve(new Response(null, { status: 204 }))
  assert.equal(url.hostname, 'api.tacticusgame.com')
  return nativeFetch(
    input instanceof Request ? new Request(endpoint, input) : endpoint,
    init
  )
}

try {
  logger.info({ event: 'fixture_ready' }, 'synthetic provider fixture')
  const measured = await captureProviderMetrics(async () => {
    const operation = {
      purpose: 'roster-fetch',
      trigger: 'user' as const,
      timeoutMs: 5000
    }
    const fetchPlayer = (key = 'synthetic-player-key', retry = false) =>
      providerFetch(
        'https://api.tacticusgame.com/api/v1/player',
        {
          headers: { 'x-api-key': key }
        },
        retry,
        operation
      )
    if (scenario === 'attributed') {
      const url = new URL('https://api.tacticusgame.com/api/v1/player')
      const headers = new Headers({ 'x-api-key': 'synthetic-player-key' })
      const pending = withProviderOperation(operation, () =>
        providerFetch(url, { headers })
      )
      headers.set('x-api-key', 'synthetic-mutated-key')
      url.pathname = '/unregistered'
      const [first, second] = await Promise.all([
        pending,
        withProviderOperation(
          { ...operation, purpose: 'credential-check' },
          () => fetchPlayer('synthetic-second-key', true)
        )
      ])
      await Promise.all([first.json(), second.json()])
      assert.deepEqual(receivedKeys.slice().sort(), [
        'synthetic-player-key',
        'synthetic-second-key'
      ])
      return
    }
    if (scenario === 'excluded') {
      await providerFetch('https://discord.com/api/webhooks/synthetic')
      await providerFetch('https://synthetic.invalid/internal')
      const abort = new AbortController()
      abort.abort(new Error('synthetic-stop'))
      await assert.rejects(
        providerFetch('https://api.tacticusgame.com/api/v1/player', {
          signal: abort.signal
        })
      )
      await assert.rejects(
        providerFetch('https://api.tacticusgame.com/api/v1/player', {
          method: 'invalid method'
        })
      )
      return
    }
    if (scenario === 'refused') {
      await assert.rejects(fetchPlayer())
      return
    }
    if (scenario === 'decode') {
      const response = await fetchPlayer()
      const clone = response.clone()
      await assert.rejects(response.json())
      await assert.rejects(clone.json())
      return
    }
    const response =
      scenario === 'enforced'
        ? await fetchPlayer()
        : await providerFetch('https://api.tacticusgame.com/api/v1/player', {
            headers: { 'x-api-key': 'synthetic-player-key' }
          })
    await response.json()
  })
  logger.info(
    {
      event: 'fixture_result',
      physicalRequests,
      controls,
      metrics: measured.metrics
    },
    'synthetic provider result'
  )
  await new Promise<void>((resolve, reject) =>
    logger.flush((error) => (error ? reject(error) : resolve()))
  )
} finally {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
