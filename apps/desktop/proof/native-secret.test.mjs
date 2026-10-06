import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { nativeSecretPrompt } from '../launcher/native-secret.mjs'
function fixture() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  const calls = [],
    kills = []
  child.kill = (signal) => {
    kills.push(signal)
    queueMicrotask(() => child.emit('close', null))
    return true
  }
  const spawn = (...args) => {
    calls.push(args)
    return child
  }
  return { child, spawn, calls, kills }
}
test('fixed native prompt receives secret output without a shell, secret arguments or secret environment', async () => {
  const f = fixture(),
    secret = randomUUID(),
    pending = nativeSecretPrompt('official-key', { spawn: f.spawn })
  assert.equal(f.calls[0][0], '/usr/bin/zenity')
  assert.equal(f.calls[0][1][0], '--entry')
  assert(f.calls[0][1].includes('--hide-text'))
  assert.deepEqual(f.calls[0][2], { stdio: ['ignore', 'pipe', 'ignore'] })
  assert(!JSON.stringify(f.calls).includes(secret))
  f.child.stdout.write(secret + '\n')
  f.child.emit('close', 0)
  assert.equal(await pending, secret)
})
test('workspace passwords preserve intentional leading and trailing spaces', async () => {
  const f = fixture(),
    pending = nativeSecretPrompt('workspace-password', { spawn: f.spawn })
  f.child.stdout.write('  synthetic password  \n')
  f.child.emit('close', 0)
  assert.equal(await pending, '  synthetic password  ')
})
test('unsupported platforms, unknown prompts and prior withdrawal create no OS child', async () => {
  const f = fixture(),
    controller = new AbortController()
  controller.abort()
  for (const options of [
    { platform: 'win32' },
    { platform: 'darwin' },
    { signal: controller.signal }
  ])
    await assert.rejects(
      nativeSecretPrompt('official-key', { spawn: f.spawn, ...options })
    )
  await assert.rejects(
    nativeSecretPrompt('arbitrary-operation', { spawn: f.spawn })
  )
  assert.equal(f.calls.length, 0)
})
test('withdrawal kills native input and late output cannot deliver a key', async () => {
  const f = fixture(),
    controller = new AbortController(),
    pending = nativeSecretPrompt('official-key', {
      spawn: f.spawn,
      signal: controller.signal
    })
  controller.abort()
  f.child.stdout.write(randomUUID() + '\n')
  await assert.rejects(pending, { code: 'ECANCEL' })
  assert.deepEqual(f.kills, ['SIGTERM'])
})
test('oversized, empty, cancelled and failed OS replies remain bounded and redact raw errors', async () => {
  for (const [contents, code] of [
    ['x'.repeat(1000), 0],
    ['\n', 0],
    ['synthetic secret', 1],
    ['synthetic secret', 2]
  ]) {
    const f = fixture(),
      pending = nativeSecretPrompt('official-key', { spawn: f.spawn })
    f.child.stdout.write(contents)
    f.child.emit('close', code)
    await assert.rejects(
      pending,
      (error) =>
        !error.message.includes(contents) &&
        ['ENATIVEDIALOG', 'ECANCEL'].includes(error.code)
    )
  }
  const f = fixture(),
    pending = nativeSecretPrompt('official-key', { spawn: f.spawn })
  f.child.emit('error', new Error(randomUUID()))
  await assert.rejects(pending, { code: 'ENATIVEDIALOG' })
})
