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
    cookie: canary
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
