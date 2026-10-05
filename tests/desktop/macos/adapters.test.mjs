import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nativeVault } from '../../../apps/desktop/platform/macos/vault.mjs'

test('native vault sends capability input through native prompt and returns only opaque handles', async () => {
  const requests = []
  const vault = nativeVault('/native/helper', {
    run: async (_file, request) => {
      requests.push(request)
      return {
        status: 'ok',
        ...(request.operation === 'read'
          ? { value: 'SYNTHETIC-CANARY-MAC' }
          : {})
      }
    }
  })
  const handle = await vault.promptAndStoreOfficialRead({
    requestedCapabilities: ['Player', 'Guild', 'Guild Raid']
  })
  assert.match(handle, /^[a-f0-9-]{36}$/)
  assert.equal(await vault.withOfficialRead(handle, (key) => key.length), 20)
  await vault.remove(handle)
  assert.deepEqual(
    requests.map((request) => request.operation),
    ['prompt-store', 'read', 'remove']
  )
  assert.ok(!JSON.stringify(requests).includes('SYNTHETIC-CANARY'))
})

test('refusal and unavailable Keychain cannot fall back to plaintext', async () => {
  for (const status of ['cancelled', 'vault-unavailable']) {
    const vault = nativeVault('/native/helper', {
      run: async () => ({ status })
    })
    await assert.rejects(
      vault.promptAndStoreOfficialRead({ requestedCapabilities: ['Player'] }),
      /Native vault unavailable/
    )
    await assert.rejects(
      vault.withOfficialRead('opaque', () => assert.fail('must not run')),
      /Native vault unavailable/
    )
    assert.equal(
      await vault.confirmPlayer({ displayName: 'Example Player' }),
      false
    )
  }
})

test('interrupted native setup retains only opaque pending references and recovery cannot delete committed access', async () => {
  let saved = {},
    unlocked = true
  const removed = [],
    pending = {
      read: () => structuredClone(saved),
      write: (value) => {
        saved = structuredClone(value)
      }
    }
  const first = nativeVault('/native/helper', {
    pending,
    authorize: () => {
      if (!unlocked)
        throw Object.assign(new Error('Unlock'), { code: 'ESESSION' })
    },
    run: async (_file, request) => {
      if (request.operation === 'remove') removed.push(request.handle)
      return { status: 'ok' }
    }
  })
  const committed = await first.promptAndStoreOfficialRead({
    requestedCapabilities: ['Player']
  })
  const interrupted = await first.promptAndStoreOfficialRead({
    requestedCapabilities: ['Guild']
  })
  assert.deepEqual(saved.handles, [committed, interrupted])
  unlocked = false
  await assert.rejects(
    first.withOfficialRead(committed, () => assert.fail()),
    (error) => error.code === 'ESESSION'
  )
  unlocked = true
  await first.recover([committed])
  assert.deepEqual(removed, [interrupted])
  assert.deepEqual(saved.handles, [])
  assert.equal(JSON.stringify(saved).includes('SYNTHETIC-CANARY'), false)
})
