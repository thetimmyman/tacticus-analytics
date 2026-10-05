import assert from 'node:assert/strict'
import test from 'node:test'
import { BrokerError, DeviceBroker } from '../../packages/addon-host/src/broker'

function brokerFixture() {
  let current = true,
    now = 0
  const broker = new DeviceBroker(
    'linux',
    (handle, id) =>
      current && handle === 'synthetic-session' && id === 'guild-war',
    () => now
  )
  broker.setVault('available')
  const lease = broker.lease('guild-war', 'synthetic-session', true)
  const request = {
    schemaVersion: 1,
    addonId: 'guild-war',
    sessionHandle: 'synthetic-session',
    leaseHandle: lease,
    operation: 'guild-war.snapshot',
    requestId: 'synthetic-request'
  }
  return {
    broker,
    request,
    switchAccount: () => {
      current = false
    },
    expire: () => {
      now = 60_000
    }
  }
}

test('fixed broker refuses game protocol on every platform with actionable offline alternatives', () => {
  for (const platform of [
    'linux',
    'macos',
    'windows',
    'android',
    'ios'
  ] as const) {
    const broker = new DeviceBroker(platform, () => true)
    broker.setVault('available')
    const lease = broker.lease('replays', 'synthetic-session', true)
    assert.deepEqual(
      broker.request({
        schemaVersion: 1,
        addonId: 'replays',
        sessionHandle: 'synthetic-session',
        leaseHandle: lease,
        operation: 'replay.capture',
        requestId: 'synthetic-request'
      }),
      {
        schemaVersion: 1,
        status: 'unavailable',
        reason: 'protocol-unapproved',
        alternative: 'import-replay-json'
      }
    )
    assert.equal(broker.support().connected, false)
    assert.equal(broker.support().secretPersistence, false)
  }
})

test('account switching, expiry, refusal, cancellation, revoke, disable and native vault states invalidate authority', () => {
  const changed = brokerFixture()
  changed.switchAccount()
  assert.equal(
    changed.broker.request(changed.request).reason,
    'binding-changed'
  )
  const expired = brokerFixture()
  expired.expire()
  assert.equal(expired.broker.request(expired.request).reason, 'expired')
  for (const reason of [
    'cancelled',
    'revoked',
    'addon-disabled',
    'permission-refused'
  ] as const) {
    const { broker, request } = brokerFixture()
    broker.invalidate(reason)
    assert.equal(broker.request(request).reason, reason)
  }
  for (const status of ['locked', 'unavailable'] as const) {
    const { broker, request } = brokerFixture()
    broker.setVault(status)
    assert.equal(
      broker.request(request).reason,
      status === 'locked' ? 'vault-locked' : 'vault-unavailable'
    )
    broker.setVault('available')
    assert.notEqual(broker.request(request).reason, 'protocol-unapproved')
  }
  const { broker, request } = brokerFixture()
  const lease = broker.lease('guild-war', 'synthetic-session', false)
  assert.equal(
    broker.request({ ...request, leaseHandle: lease }).reason,
    'permission-refused'
  )
})

test('adversarial addons cannot broaden operation/URL/account/signature authority or leak nested canaries in errors', () => {
  const { broker, request } = brokerFixture(),
    canary = 'synthetic-forbidden-canary',
    encoded = Buffer.from(canary).toString('base64')
  const surfaces: string[] = []
  for (const payload of [
    { ...request, operation: 'sign' },
    { ...request, operation: 'replay.capture' },
    { ...request, url: 'https://example.invalid' },
    { ...request, accountHandle: 'another-account' },
    { ...request, headers: { secret: canary } },
    { ...request, body: { nested: encoded } },
    { ...request, leaseHandle: '../../another-module' }
  ]) {
    try {
      broker.request(payload)
      assert.fail('invalid broker request accepted')
    } catch (error) {
      assert.ok(error instanceof BrokerError)
      surfaces.push(String(error))
    }
  }
  surfaces.push(
    JSON.stringify(broker.request(request)),
    JSON.stringify(broker.support())
  )
  for (const surface of surfaces) {
    assert.equal(surface.includes(canary), false)
    assert.equal(surface.includes(encoded), false)
  }
})
