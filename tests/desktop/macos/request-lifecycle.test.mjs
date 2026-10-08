import test from 'node:test'
import assert from 'node:assert/strict'
import lifecycle from '../../../apps/desktop/platform/macos/request-lifecycle.cjs'

const origin = 'http://127.0.0.1:12345'
test('browser cancellation, CORS and blocking observations retain fixed labels without URLs, IDs or values', () => {
  const canary = 'SYNTHETIC-SECRET-CANARY'
  const observer = lifecycle.createRequestLifecycle(origin, () => 'scores-view')
  observer.available()
  observer.record('Network.requestWillBeSent', {
    requestId: canary,
    type: 'Fetch',
    documentURL: origin + '/home?key=' + canary,
    request: {
      url: origin + '/dashboard?_rsc=' + canary,
      method: 'GET',
      headers: { RSC: '1', 'Next-Router-Prefetch': '1', Authorization: canary },
      postData: canary
    }
  })
  observer.record('Network.requestWillBeSent', {
    requestId: canary,
    redirectResponse: { url: origin + '/dashboard?_rsc=' + canary },
    request: { url: 'http://127.0.0.1:54321/private?' + canary, method: 'GET' }
  })
  observer.record('Network.loadingFailed', {
    requestId: canary,
    errorText: 'net::ERR_FAILED',
    canceled: true,
    blockedReason: canary,
    corsErrorStatus: {
      corsError: 'PreflightInvalidStatus',
      failedParameter: canary
    }
  })
  const result = observer.snapshot()
  assert.equal(JSON.stringify(result).includes(canary), false)
  assert.deepEqual(result.failed, [
    {
      endpoint: 'raid-dashboard-page',
      resource: 'xhr',
      phase: 'scores-view',
      method: 'GET',
      rsc: true,
      prefetch: true,
      document: 'home-document',
      redirected: true,
      crossOriginRedirect: true,
      networkError: 'request-failed',
      canceled: true,
      blockedReason: 'other',
      corsCategory: 'preflight-policy'
    }
  ])
  assert.equal(result.accepted, false)
  assert.equal(result.productAcceptance, false)
  observer.record('Network.requestWillBeSent', {
    requestId: 'second',
    type: 'XHR',
    documentURL: origin + '/home',
    request: { url: origin + '/home', method: 'GET' }
  })
  observer.record('Network.loadingFailed', {
    requestId: 'second',
    errorText: 'net::ERR_ABORTED',
    canceled: false,
    corsErrorStatus: { corsError: canary }
  })
  assert.deepEqual(observer.snapshot().failed[1], {
    endpoint: 'home-page',
    resource: 'xhr',
    phase: 'scores-view',
    method: 'GET',
    document: 'home-document',
    networkError: 'request-canceled',
    canceled: false,
    corsCategory: 'other'
  })
})

test('lifecycle diagnostics ignore foreign traffic, remove completed requests and bound retained failures', () => {
  const observer = lifecycle.createRequestLifecycle(
    origin,
    () => 'recovered-open'
  )
  const start = (id, url = origin + '/home') =>
    observer.record('Network.requestWillBeSent', {
      requestId: id,
      type: 'Fetch',
      request: { url, method: 'GET' }
    })
  start('foreign', 'https://example.com/private')
  observer.record('Network.loadingFailed', {
    requestId: 'foreign',
    errorText: 'net::ERR_FAILED'
  })
  start('complete')
  observer.record('Network.loadingFinished', { requestId: 'complete' })
  assert.equal(observer.snapshot().trackedRequestCount, 0)
  assert.deepEqual(observer.snapshot().failed, [])
  for (let id = 0; id < 70; id++) {
    start(String(id))
    observer.record('Network.loadingFailed', {
      requestId: String(id),
      errorText: 'net::ERR_FAILED'
    })
  }
  assert.equal(observer.snapshot().failed.length, 64)
  assert.equal(observer.snapshot().truncated, true)
  assert.equal('canceled' in observer.snapshot().failed[0], false)
  for (let id = 0; id < 4100; id++) start('pending-' + id)
  assert.equal(observer.snapshot().trackedRequestCount, 4096)
  assert.equal(observer.snapshot().truncated, true)
})

test('unavailable browser diagnostics are explicit and cannot become product acceptance', async () => {
  const observer = await lifecycle.observeRequestLifecycle(
    {
      debugger: {
        attach() {
          throw new Error('SYNTHETIC-SECRET-CANARY')
        }
      }
    },
    origin,
    () => 'initial-open'
  )
  assert.equal(observer.snapshot().available, false)
  assert.equal(observer.snapshot().reason, 'attach-unavailable')
  assert.equal(observer.snapshot().productAcceptance, false)
  assert.equal(
    JSON.stringify(observer.snapshot()).includes('SYNTHETIC-SECRET-CANARY'),
    false
  )
})
