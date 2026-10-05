import assert from 'node:assert/strict'
import test from 'node:test'
import {
  brokerRequestSchema,
  canonicalJson,
  manifestSchema
} from '../../packages/addon-host/src/contract'

test('broker contract rejects authority expansion and cross-module operation', () => {
  const request = {
    schemaVersion: 1,
    addonId: 'guild-war',
    sessionHandle: 'session',
    leaseHandle: 'lease',
    operation: 'guild-war.snapshot',
    requestId: 'request'
  }
  assert.equal(brokerRequestSchema.safeParse(request).success, true)
  for (const extension of [
    { url: 'https://example.invalid' },
    { secret: 'synthetic-canary' },
    { account: 'another-account' },
    { operation: 'replay.capture' }
  ]) {
    assert.equal(
      brokerRequestSchema.safeParse({ ...request, ...extension }).success,
      false
    )
  }
})

test('manifest rejects active content, unknown fields and traversal', () => {
  assert.equal(
    manifestSchema.safeParse({ schemaVersion: 1, executable: 'entry.js' })
      .success,
    false
  )
})

test('signature canonicalization is independent of insertion order and rejects undefined', () => {
  assert.equal(
    canonicalJson({ b: [2, 1], a: 'data' }),
    canonicalJson({ a: 'data', b: [2, 1] })
  )
  assert.throws(() => canonicalJson({ a: undefined }))
})
