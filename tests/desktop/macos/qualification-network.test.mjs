import test from 'node:test'
import assert from 'node:assert/strict'
import { qualificationTarget } from '../../../apps/desktop/platform/macos/qualification-network.mjs'
import { verifyNetworkIsolation } from '../../../apps/desktop/platform/macos/network-isolation.mjs'

test('target resolution retries a transient failure before returning a numeric external target', async () => {
  let calls = 0
  assert.equal(
    await qualificationTarget({
      resolve: async (name, options) => {
        assert.equal(name, 'example.com')
        assert.deepEqual(options, { family: 4 })
        if (++calls === 1) throw new Error('synthetic-dns-detail')
        return { address: '192.0.2.20' }
      },
      wait: async () => {}
    }),
    '192.0.2.20'
  )
  assert.equal(calls, 2)
})

test('timeouts, invalid targets and failed DNS refuse qualification with bounded sanitized failure', async () => {
  for (const resolve of [
    async () => {
      throw new Error('SYNTHETIC-CANARY')
    },
    async () => ({ address: '127.0.0.1' }),
    async () => ({ address: '::1' }),
    () => new Promise(() => {})
  ])
    await assert.rejects(
      qualificationTarget({
        resolve,
        attempts: 2,
        timeout: 1,
        wait: async () => {}
      }),
      (error) => error.message === 'Qualification DNS target unavailable'
    )
  for (const target of ['127.0.0.1', 'example.com', undefined])
    await assert.rejects(
      verifyNetworkIsolation(target),
      /External IPv4 qualification target required/
    )
})
