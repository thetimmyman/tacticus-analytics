import test from 'node:test'
import assert from 'node:assert/strict'
import diagnostics from '../../../apps/desktop/platform/macos/request-diagnostics.cjs'

test('pending and failed requests retain fixed endpoint/resource labels and distinct causes', () => {
  assert.deepEqual(diagnostics.requestLabel('/api/user/activity', 'xhr'), {
    endpoint: 'activity',
    resource: 'xhr'
  })
  const pending = diagnostics.sanitizeFailure({
    stage: 'renderer-network',
    cause: 'requests-pending',
    network: {
      pending: [
        diagnostics.requestLabel('/_next/static/synthetic-secret.js', 'script')
      ]
    }
  })
  assert.equal(pending.cause, 'requests-pending')
  assert.deepEqual(pending.network.pending, [
    { endpoint: 'static-asset', resource: 'script' }
  ])
  const failed = diagnostics.sanitizeFailure({
    stage: 'renderer-network',
    cause: 'request-failed',
    network: {
      failed: [
        { ...diagnostics.requestLabel('/api/version', 'xhr'), status: 500 }
      ],
      blocked: 2
    }
  })
  assert.deepEqual(failed.network.failed, [
    { endpoint: 'version', resource: 'xhr', status: 500 }
  ])
  assert.equal(failed.network.blocked, 2)
})

test('untrusted diagnostic frames cannot copy paths, messages, cookies or arbitrary labels', () => {
  const canary = 'SYNTHETIC-SECRET-CANARY'
  const entry = {
    endpoint: canary,
    resource: canary,
    status: canary,
    path: '/' + canary,
    cookie: canary,
    phase: canary,
    networkError: canary,
    document: canary,
    frameAvailable: canary,
    method: canary,
    rsc: canary,
    prefetch: canary
  }
  const input = {
    stage: 'renderer-network',
    cause: 'request-failed',
    code: canary,
    message: canary,
    network: {
      pending: Array(1000).fill(entry),
      failed: Array(1000).fill(entry),
      blocked: canary
    }
  }
  const result = diagnostics.sanitizeFailure(input)
  assert.equal(JSON.stringify(result).includes(canary), false)
  assert.deepEqual(result.network.failed, [
    { endpoint: 'other-local', resource: 'other', status: 0 }
  ])
  assert.deepEqual(diagnostics.sanitizeFailure({ ...input, cause: canary }), {
    synthetic: true,
    stage: 'renderer-network',
    code: 'EVERIFY'
  })
  assert.equal(
    JSON.stringify(
      diagnostics.requestLabel('/private/' + canary, canary)
    ).includes(canary),
    false
  )
})

test('request start phases and known local readers survive projection without copying arbitrary paths', () => {
  const label = diagnostics.requestLabel(
    '/supabase/rest/v1/player_with_cluster',
    'xhr',
    'signed-out-check'
  )
  assert.deepEqual(label, {
    endpoint: 'cluster-profile',
    resource: 'xhr',
    phase: 'signed-out-check'
  })
  const value = diagnostics.sanitizeFailure({
    stage: 'renderer-network',
    cause: 'request-failed',
    network: { failed: [{ ...label, status: 401 }] }
  })
  assert.deepEqual(value.network.failed, [{ ...label, status: 401 }])
  assert.deepEqual(
    diagnostics.requestLabel('/unknown', 'xhr', 'SYNTHETIC-SECRET-CANARY'),
    { endpoint: 'other-local', resource: 'xhr' }
  )
})

test('renderer attachment projects calculation flags without document text or request paths', () => {
  const canary = 'SYNTHETIC-SECRET-CANARY'
  const value = diagnostics.rendererReceipt({
    observed: { text: '+58% -50% ' + canary, nodeAccess: false },
    failed: [{ path: '/private/' + canary, status: 500 }],
    blocked: 1
  })
  assert.equal(JSON.stringify(value).includes(canary), false)
  assert.deepEqual(value.observed, {
    nodeAccess: false,
    positiveScore: true,
    negativeScore: true,
    serviceDisruption: false
  })
  assert.deepEqual(value.network.failed, [
    { endpoint: 'other-local', resource: 'other', status: 500 }
  ])
  assert.equal(diagnostics.rendererReceipt({}).observed.nodeAccess, true)
  assert.equal(diagnostics.rendererReceipt({}).observed.serviceDisruption, true)
})

test('only the tagged credential holding refusal is treated as deliberate', () => {
  const tagged = { [diagnostics.holdingHeader]: ['credential-surface'] }
  assert.equal(diagnostics.holdingRefusal(403, tagged), true)
  assert.equal(
    diagnostics.holdingRefusal(403, {
      'X-Desktop-Holding': 'credential-surface'
    }),
    true
  )
  assert.equal(diagnostics.holdingRefusal(403, {}), false)
  assert.equal(diagnostics.holdingRefusal(500, tagged), false)
  assert.equal(
    diagnostics.holdingRefusal(403, { [diagnostics.holdingHeader]: ['other'] }),
    false
  )
})

test('authorization failures are expected only while deliberately signed out', () => {
  const failure = (path, status, phase) => ({ path, status, phase })
  for (const expected of [
    failure('/desktop/open', 403, 'renderer-refusal'),
    failure('/api/guild-tokens', 403, 'scores-view'),
    failure('/supabase/rest/v1/guild_config', 401, 'signed-out-check')
  ])
    assert.equal(diagnostics.unexpectedFailure(expected), false)
  for (const unexpected of [
    failure('/supabase/rest/v1/guild_config', 401, 'scores-view'),
    failure('/supabase/rest/v1/guild_config', 401, 'recovered-open'),
    failure('/supabase/rest/v1/guild_config', 401, 'initial-open'),
    failure('/profile', 403, 'scores-view'),
    failure('/player-performance', 500, 'scores-view'),
    failure('/api/guild-tokens', 0, 'scores-view')
  ])
    assert.equal(diagnostics.unexpectedFailure(unexpected), true)
})

test('fixed health and raid readers distinguish failures without disclosing variable paths', () => {
  assert.equal(
    diagnostics.requestLabel('/api/health/telemetry', 'xhr').endpoint,
    'health-telemetry'
  )
  assert.equal(
    diagnostics.requestLabel('/supabase/rest/v1/EOT_GR_data', 'xhr').endpoint,
    'raid-data'
  )
  assert.equal(
    diagnostics.requestLabel('/private/SYNTHETIC-CANARY', 'xhr').endpoint,
    'other-local'
  )
})

test('transport failure diagnostics retain only fixed error labels and still fail qualification', () => {
  const networkError = diagnostics.networkErrorLabel(
    'net::ERR_CONNECTION_RESET'
  )
  assert.equal(networkError, 'connection-reset')
  assert.equal(diagnostics.networkErrorLabel('constructor'), 'other')
  assert.equal(
    diagnostics.networkErrorLabel('SYNTHETIC-SECRET-CANARY'),
    'other'
  )
  const label = diagnostics.requestLabel(
    '/api/sync/freshness',
    'xhr',
    'scores-view'
  )
  const failure = { ...label, status: 0, networkError }
  const receipt = diagnostics.sanitizeFailure({
    stage: 'renderer-network',
    cause: 'request-failed',
    network: { failed: [failure] }
  })
  assert.deepEqual(receipt.network.failed, [failure])
  assert.equal(diagnostics.unexpectedFailure(failure), true)
})

test('failed requests retain fixed originating document and frame availability without URLs or identifiers', () => {
  const canary = 'SYNTHETIC-SECRET-CANARY'
  const document = diagnostics.requestDocumentLabel(
    'http://127.0.0.1:1234/home?private=' + canary
  )
  assert.equal(document, 'home-document')
  assert.equal(
    diagnostics.requestDocumentLabel('http://127.0.0.1:1234/private/' + canary),
    'other-document'
  )
  assert.equal(diagnostics.requestDocumentLabel(canary), 'other-document')
  assert.equal(
    diagnostics.requestLabel('/desktop/onboarding-status', 'xhr').endpoint,
    'onboarding-status'
  )
  assert.equal(
    diagnostics.requestLabel(
      '/supabase/rest/v1/rpc/get_distinct_seasons_for_guild',
      'xhr'
    ).endpoint,
    'distinct-seasons'
  )
  const failure = {
    endpoint: 'onboarding-status',
    resource: 'xhr',
    document,
    status: 0,
    networkError: 'request-failed',
    frameAvailable: false
  }
  const value = diagnostics.sanitizeFailure({
    stage: 'renderer-network',
    cause: 'request-failed',
    network: { failed: [failure] }
  })
  assert.deepEqual(value.network.failed, [failure])
  assert.equal(JSON.stringify(value).includes(canary), false)
  assert.equal(diagnostics.unexpectedFailure(failure), true)
})

test('request metadata retains only a bounded method and observed RSC/prefetch flags', () => {
  const canary = 'SYNTHETIC-SECRET-CANARY'
  assert.deepEqual(diagnostics.requestMetadata(canary), { method: 'other' })
  assert.deepEqual(
    diagnostics.requestMetadata('POST', {
      RSC: '1',
      'Next-Router-Prefetch': '1',
      Authorization: canary,
      Cookie: canary
    }),
    { method: 'POST', rsc: true, prefetch: true }
  )
  const label = diagnostics.requestLabel(
    '/api/briefing/seen',
    'xhr',
    'scores-view'
  )
  const result = diagnostics.sanitizeFailure({
    stage: 'renderer-network',
    cause: 'request-failed',
    network: {
      failed: [
        {
          ...label,
          ...diagnostics.requestMetadata('POST', {}),
          status: 0,
          document: 'home-document',
          frameAvailable: true,
          headers: { Authorization: canary }
        }
      ]
    }
  })
  assert.equal(JSON.stringify(result).includes(canary), false)
  assert.deepEqual(result.network.failed[0], {
    endpoint: 'briefing-seen',
    resource: 'xhr',
    phase: 'scores-view',
    document: 'home-document',
    method: 'POST',
    rsc: false,
    prefetch: false,
    status: 0,
    frameAvailable: true
  })
  assert.equal(
    diagnostics.unexpectedFailure({
      path: '/api/briefing/seen',
      status: 0,
      phase: 'scores-view'
    }),
    true
  )
})
