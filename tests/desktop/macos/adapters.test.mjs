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
