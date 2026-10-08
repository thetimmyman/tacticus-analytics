import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptedPassphrase } from '../launcher/maintenance.mjs'
import { nativeSecretPrompt } from '../launcher/native-secret.mjs'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

test('backup confirms exact input, restore asks once, and neither failure reveals passphrase', async () => {
  const secret = '  synthetic backup secret  '
  const calls = []
  const passphrase = await encryptedPassphrase('backup', async (kind) => {
    calls.push(kind)
    return secret
  })
  assert.equal(passphrase.toString(), secret)
  passphrase.fill(0)
  assert.deepEqual(calls, ['backup-passphrase', 'backup-passphrase-confirm'])
  const restore = await encryptedPassphrase('restore', async (kind) => {
    assert.equal(kind, 'restore-passphrase')
    return secret
  })
  restore.fill(0)
  let count = 0
  await assert.rejects(
    encryptedPassphrase('backup', async () =>
      ++count === 1 ? secret : 'another secret'
    ),
    (error) =>
      !error.message.includes(secret) && /did not match/.test(error.message)
  )
  await assert.rejects(
    encryptedPassphrase('backup', async () => 'short'),
    /12 to 1024/
  )
})

test('all encryption prompts collect only masked native output with no secret arguments or environment', async () => {
  for (const kind of [
    'backup-passphrase',
    'backup-passphrase-confirm',
    'restore-passphrase'
  ]) {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.kill = () => {}
    let argumentsSeen
    const pending = nativeSecretPrompt(kind, {
      spawn: (...args) => {
        argumentsSeen = args
        return child
      }
    })
    child.stdout.write('synthetic backup secret\n')
    child.emit('close', 0)
    assert.equal(await pending, 'synthetic backup secret')
    assert.ok(argumentsSeen[1].includes('--hide-text'))
    assert.equal(
      JSON.stringify(argumentsSeen).includes('synthetic backup secret'),
      false
    )
    assert.deepEqual(argumentsSeen[2], { stdio: ['ignore', 'pipe', 'ignore'] })
  }
})
