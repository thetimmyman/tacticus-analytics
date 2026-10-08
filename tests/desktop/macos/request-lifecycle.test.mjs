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

test('dual observers correlate only unique exact private keys with terminal browser evidence', () => {
  const observer = lifecycle.createRequestLifecycle(origin, () => 'scores-view')
  observer.available()
  const canary = 'SYNTHETIC-SECRET-CANARY'
  const url = origin + '/player-stats?_rsc=' + canary
  const document = origin + '/home?key=' + canary
  const headers = { RSC: '1', 'Next-Router-Prefetch': '1' }
  const web = (id, timestamp = 1000000, value = url, referrer = document) => {
    const details = {
      id,
      timestamp,
      url: value,
      referrer,
      method: 'GET',
      resourceType: 'xhr',
      requestHeaders: headers
    }
    observer.recordWebRequest('start', details)
    observer.recordWebRequest('headers', details)
    observer.recordWebRequest('error', { ...details, error: 'net::ERR_FAILED' })
  }
  const browser = (
    id,
    wallTime = 1000,
    value = url,
    documentURL = document
  ) => {
    observer.record('Network.requestWillBeSent', {
      requestId: id,
      wallTime,
      documentURL,
      type: 'Fetch',
      request: { url: value, method: 'GET', headers }
    })
  }
  web(1)
  browser(canary)
  assert.equal(
    observer.snapshot().webRequestCorrelation.failed[0].correlation,
    'pending'
  )
  observer.record('Network.loadingFailed', {
    requestId: canary,
    errorText: 'net::ERR_ABORTED',
    canceled: true
  })
  const result = observer.snapshot().webRequestCorrelation
  assert.deepEqual(result.failed, [
    {
      endpoint: 'player-stats-page',
      resource: 'xhr',
      phase: 'scores-view',
      method: 'GET',
      rsc: true,
      prefetch: true,
      document: 'home-document',
      webRequestError: 'request-failed',
      correlation: 'unique-exact-key',
      browserOutcome: 'failed',
      browserNetworkError: 'request-canceled',
      browserCanceled: true
    }
  ])
  assert.equal(JSON.stringify(result).includes(canary), false)
  assert.equal(JSON.stringify(result).includes('1000000'), false)
  browser('duplicate', 1000.01)
  observer.record('Network.loadingFinished', { requestId: 'duplicate' })
  assert.equal(
    observer.snapshot().webRequestCorrelation.failed[0].correlation,
    'ambiguous'
  )
  web(2, 1002000)
  browser('later', 1002)
  observer.record('Network.loadingFinished', { requestId: 'later' })
  assert.equal(
    observer.snapshot().webRequestCorrelation.failed[1].correlation,
    'ambiguous'
  )
  web(3, 1002001)
  assert.equal(
    observer.snapshot().webRequestCorrelation.failed[1].correlation,
    'ambiguous'
  )
  web(4, 1004000, url + '-different-query')
  browser('different-query', 1004)
  observer.record('Network.loadingFinished', { requestId: 'different-query' })
  assert.equal(
    observer.snapshot().webRequestCorrelation.failed[3].correlation,
    'unmatched'
  )
  web(5, 1005000, url, origin + '/home?different-document')
  browser('different-document', 1005)
  observer.record('Network.loadingFinished', {
    requestId: 'different-document'
  })
  assert.equal(
    observer.snapshot().webRequestCorrelation.failed[4].correlation,
    'unmatched'
  )
  observer.unavailable('detached')
  assert.equal(
    observer.snapshot().webRequestCorrelation.failed[0].correlation,
    'unavailable'
  )
})

test('correlation rejects redirects, absent documents, bounds and missing terminal evidence', () => {
  const observer = lifecycle.createRequestLifecycle(origin, () => 'scores-view')
  observer.available()
  const start = (id, extra = {}) => {
    const details = {
      id,
      timestamp: 1000000,
      url: origin + '/home',
      referrer: origin + '/home',
      method: 'GET',
      resourceType: 'xhr',
      ...extra
    }
    observer.recordWebRequest('start', details)
    observer.recordWebRequest('error', { ...details, error: 'net::ERR_FAILED' })
  }
  const browser = (id, extra = {}) =>
    observer.record('Network.requestWillBeSent', {
      requestId: id,
      wallTime: 1000,
      documentURL: origin + '/home',
      type: 'Fetch',
      request: { url: origin + '/home', method: 'GET' },
      ...extra
    })
  start(1)
  browser('redirect')
  browser('redirect', {
    redirectResponse: {},
    request: { url: origin + '/scores', method: 'GET' }
  })
  observer.record('Network.loadingFailed', {
    requestId: 'redirect',
    errorText: 'net::ERR_ABORTED',
    canceled: true
  })
  assert.equal(
    observer.snapshot().webRequestCorrelation.failed[0].correlation,
    'redirected'
  )
  start(2, { timestamp: undefined, url: origin + '/scores' })
  browser('clock', {
    request: { url: origin + '/scores', method: 'GET' },
    wallTime: undefined
  })
  observer.record('Network.loadingFinished', { requestId: 'clock' })
  assert.equal(
    observer.snapshot().webRequestCorrelation.failed[1].browserOutcome,
    'completed'
  )
  start(3, { referrer: '' })
  assert.equal(
    observer.snapshot().webRequestCorrelation.failed[2].correlation,
    'unmatched'
  )
  start(4, { url: origin + '/home?' + 'x'.repeat(8192) })
  assert.equal(observer.snapshot().webRequestCorrelation.truncated, true)
  for (let id = 10; id < 4110; id++) start(id)
  const snapshot = observer.snapshot()
  assert.equal(snapshot.webRequestCorrelation.truncated, true)
  assert.equal(snapshot.webRequestCorrelation.failed.length, 64)
  assert.equal(
    snapshot.webRequestCorrelation.failed.every(
      (value) => value.correlation === 'unavailable'
    ),
    true
  )
  assert.equal(snapshot.productAcceptance, false)
})
