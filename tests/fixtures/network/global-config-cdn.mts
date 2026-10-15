import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import {
  captureProviderMetrics,
  withProviderOperation
} from '../../../app/lib/network/provider-metrics.ts'
import { getSharedFetch } from '../../../app/lib/network/undici-agent.ts'
import { logger } from '../../../app/lib/logging/logger.ts'

// Use the same empty server-only marker as the Vitest alias. All application
// transport, admission, observation and logger modules remain real.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === 'server-only'
      ? {
          url: new URL('../../mocks/server-only.ts', import.meta.url).href,
          shortCircuit: true
        }
      : nextResolve(specifier, context)
  }
})
const { discoverLatestHash, fetchGlobalConfig, postDiscordWebhook } =
  await import('../../../app/lib/loki/global-config-refresh.ts')

const scenario = process.argv[2] ?? 'success'
const hash = 'a'.repeat(32)
const config = { configVersion: hash, synthetic: ['preserved', 7, true] }
let physicalRequests = 0
let controls = 0
let siblingRequests = 0
let settledHttpErrors = 0
let permitHeld = false
let slotDenials = 0
let firstBodyCancelled = false
let rejectionElapsedMs = 0
let resolveFirstResponseClosed!: () => void
const firstResponseClosed = new Promise<void>((resolve) => {
  resolveFirstResponseClosed = resolve
})
const server = createServer((request, response) => {
  physicalRequests++
  const requestNumber = physicalRequests
  response.on('close', () => {
    if (requestNumber === 1) {
      firstBodyCancelled = !response.writableFinished
      resolveFirstResponseClosed()
    }
  })
  assert.equal(request.url, `/config/global/GlobalConfig.${hash}.json`)
  assert.equal(request.method, 'GET')
  assert.equal(
    request.headers['user-agent'],
    'tacticus-analytics/refresh-global-config'
  )
  request.resume()
  request.on('end', () => {
    if (
      scenario === 'exhausted' ||
      (scenario === 'retry' && physicalRequests < 3)
    ) {
      request.socket.destroy()
      return
    }
    response.statusCode =
      scenario.startsWith('http') &&
      (!scenario.startsWith('http-enforced') || requestNumber === 1)
        ? 429
        : 200
    response.setHeader('content-type', 'application/json')
    if (scenario === 'http-enforced-open' && requestNumber === 1) {
      response.write('{"synthetic":"unfinished error body')
      return
    }
    response.end(JSON.stringify(config))
  })
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const endpoint = `http://127.0.0.1:${address.port}`
const nativeFetch = getSharedFetch()
const streamingFetch = globalThis.fetch

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname === 'synthetic-control.invalid') {
    controls++
    const action = url.pathname.split('/').at(-1)
    const body = JSON.parse(String(init?.body))
    if (action === 'outcome' && body.settled === true) {
      permitHeld = false
      if (body.status === 429) settledHttpErrors++
    }
    if (action === 'reserve') {
      assert.equal(body.domain, 'cdn')
      assert.equal(body.endpoint, '/config/global/GlobalConfig.<hash>.json')
      assert.equal(body.purpose, 'game-config-refresh')
      assert.equal(body.timeoutMs, 15000)
      if (scenario.startsWith('http-enforced')) {
        if (permitHeld) {
          slotDenials++
          return Promise.resolve(
            Response.json({ status: 'denied', reason: 'disabled' })
          )
        }
        permitHeld = true
      }
    }
    return Promise.resolve(
      Response.json(
        scenario === 'refused'
          ? { status: 'denied', reason: 'disabled', retryAfterSeconds: 60 }
          : action === 'reserve' || action === 'dispatch'
            ? {
                status: action === 'reserve' ? 'reserved' : 'dispatch',
                attemptId: body.attemptId,
                timeoutMs: 15000,
                [action === 'reserve' ? 'claimUntil' : 'deadline']: new Date(
                  Date.now() + 15000
                ).toISOString()
              }
            : { status: 'continue' }
      )
    )
  }
  if (scenario === 'siblings') {
    siblingRequests++
    if (url.hostname === 'discord.com') {
      assert.equal(init?.method, 'POST')
      assert.equal(init?.cache, 'no-store')
      assert.equal(init?.body, JSON.stringify({ content: 'synthetic alert' }))
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    assert.equal(url.hostname, 'api-live.loki.snowprintstudios.com')
    assert.equal(init?.method, 'POST')
    assert.equal(
      JSON.parse(String(init?.body)).playerEvent.playerEventType,
      'APP_START'
    )
    return Promise.resolve(
      Response.json({ eventResult: { eventResultType: 'SUCCESS' } })
    )
  }
  assert.equal(url.hostname, 'cdn.loki.snowprintstudios.com')
  assert.equal(input instanceof Request ? input.cache : init?.cache, 'no-store')
  // The default native adapter buffers a completed body. Use Node's actual
  // streaming fetch for the never-ending-body control; both reach loopback only.
  return (scenario === 'http-enforced-open' ? streamingFetch : nativeFetch)(
    input instanceof Request
      ? new Request(endpoint + url.pathname, input)
      : endpoint + url.pathname,
    init
  )
}

try {
  const measured = await captureProviderMetrics(async () => {
    if (scenario === 'siblings') {
      assert.equal(await discoverLatestHash('synthetic-account', hash), hash)
      assert.deepEqual(
        await postDiscordWebhook(
          'https://discord.com/api/webhooks/123/PLACEHOLDER',
          'synthetic alert'
        ),
        { ok: true }
      )
      return
    }
    if (scenario === 'invalid') {
      await assert.rejects(fetchGlobalConfig('invalid'), /Invalid GlobalConfig/)
      return
    }
    const operation = () => fetchGlobalConfig(hash)
    if (scenario === 'missing') {
      await assert.rejects(operation(), { code: 'PROVIDER_ADMISSION_REFUSED' })
    } else if (scenario === 'refused') {
      await assert.rejects(
        withProviderOperation(
          {
            purpose: 'game-config-refresh',
            trigger: 'scheduled',
            timeoutMs: 15000
          },
          operation
        ),
        { code: 'PROVIDER_ADMISSION_REFUSED' }
      )
    } else if (scenario === 'exhausted' || scenario.startsWith('http')) {
      const started = performance.now()
      await assert.rejects(
        withProviderOperation(
          {
            purpose: 'game-config-refresh',
            trigger: 'scheduled',
            timeoutMs: 15000
          },
          operation
        ),
        scenario.startsWith('http')
          ? /HTTP 429/
          : /fetch failed|socket|other side closed/i
      )
      if (scenario.startsWith('http-enforced')) {
        rejectionElapsedMs = performance.now() - started
        assert.ok(
          rejectionElapsedMs < 5000,
          'HTTP rejection must settle well before its 15 second deadline'
        )
        assert.equal(
          settledHttpErrors,
          1,
          'HTTP error body must release its admission permit before rejection'
        )
        if (scenario === 'http-enforced-open') {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Error body was not cancelled promptly')),
              2000
            )
            void firstResponseClosed.then(() => {
              clearTimeout(timeout)
              resolve()
            })
          })
          assert.equal(firstBodyCancelled, true)
        }
        const nextConfig = await withProviderOperation(
          {
            purpose: 'game-config-refresh',
            trigger: 'scheduled',
            timeoutMs: 15000
          },
          operation
        )
        assert.deepEqual(nextConfig, config)
        assert.equal(
          slotDenials,
          0,
          'The next legitimate operation must acquire the one-slot permit'
        )
      }
    } else {
      const value =
        scenario === 'unknown'
          ? await operation()
          : await withProviderOperation(
              {
                purpose: 'game-config-refresh',
                trigger: 'scheduled',
                timeoutMs: 15000
              },
              operation
            )
      assert.deepEqual(value, config)
    }
  })
  logger.info(
    {
      event: 'fixture_result',
      physicalRequests,
      controls,
      siblingRequests,
      settledHttpErrors,
      permitHeld,
      slotDenials,
      firstBodyCancelled,
      rejectionElapsedMs,
      metrics: measured.metrics
    },
    'synthetic CDN result'
  )
  await new Promise<void>((resolve, reject) =>
    logger.flush((error) => (error ? reject(error) : resolve()))
  )
} finally {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
