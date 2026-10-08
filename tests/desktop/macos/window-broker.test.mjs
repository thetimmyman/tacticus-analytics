import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  superviseWindows,
  brokerWindow
} from '../../../apps/desktop/platform/macos/window-broker.mjs'

function child() {
  const value = new EventEmitter()
  Object.assign(value, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    connected: true,
    sent: [],
    killed: [],
    send(message, done) {
      this.sent.push(message)
      done?.()
    },
    kill(signal) {
      this.killed.push(signal)
    }
  })
  return value
}
function setup(options = {}) {
  const launches = []
  const owner = superviseWindows({
    root: '/synthetic/runtime',
    state: '/synthetic/workspace',
    policy: '(version 1)(allow default)(deny network*)',
    args: ['--verify', '/synthetic/verify.json'],
    env: {
      HOME: '/synthetic/home',
      TMPDIR: '/synthetic/tmp',
      TA_MAC_GUARD_LOCK: '/synthetic/workspace/owner.lock'
    },
    ...options,
    launch(file, args, options) {
      const process = child()
      launches.push({ file, args, options, process })
      return process
    }
  })
  return { ...owner, launches }
}

test('runtime is confined and only one fixed Electron entrypoint can launch', () => {
  const owner = setup(),
    runtime = owner.runtime
  assert.equal(owner.launches[0].file, '/usr/bin/sandbox-exec')
  assert.deepEqual(owner.launches[0].args.slice(0, 4), [
    '-p',
    '(version 1)(allow default)(deny network*)',
    '/synthetic/runtime/bin/node',
    '/synthetic/runtime/apps/desktop/platform/macos/runtime.mjs'
  ])
  assert.equal(owner.launches[0].args.at(-1), '--window-broker')
  runtime.emit('message', { broker: 'launch', file: '/foreign/executable' })
  assert.equal(owner.launches.length, 1)
  runtime.emit('message', { broker: 'launch' })
  runtime.emit('message', { broker: 'launch' })
  assert.equal(owner.launches.length, 2)
  const window = owner.launches[1]
  assert.equal(
    window.file,
    '/synthetic/runtime/electron/Electron.app/Contents/MacOS/Electron'
  )
  assert.deepEqual(window.args, [
    '/synthetic/runtime/apps/desktop/platform/macos/main.cjs',
    '/synthetic/workspace/window-config.json'
  ])
  assert.equal(window.options.env.TA_MAC_WINDOW_BROKER, undefined)
  assert.equal(window.options.cwd, '/synthetic/workspace')
})

test('native replies stay on IPC and diagnostics are bounded; owner death closes Electron', () => {
  const owner = setup(),
    runtime = owner.runtime
  runtime.emit('message', { broker: 'launch' })
  const window = owner.launches[1].process
  const action = {
    requestId: 'synthetic',
    operation: 'session',
    token: 'SYNTHETIC-CANARY'
  }
  window.emit('message', action)
  assert.deepEqual(runtime.sent, [{ broker: 'message', value: action }])
  const reply = { requestId: 'synthetic', status: 'ok' }
  runtime.emit('message', { broker: 'send', value: reply })
  assert.deepEqual(window.sent, [reply])
  const largeReply = { status: 'ok', view: { cached: 'x'.repeat(30000) } }
  runtime.emit('message', { broker: 'send', value: largeReply })
  assert.deepEqual(window.sent[1], largeReply)
  window.emit('message', { operation: 'session', token: 'x'.repeat(20001) })
  assert.equal(runtime.sent.length, 1)
  window.stderr.emit('data', Buffer.from('x'.repeat(10000)))
  assert.deepEqual(
    runtime.sent.slice(1).map((message) => message.value.length),
    [4096, 4096, 1808]
  )
  runtime.emit('exit', 1, null)
  assert.deepEqual(window.killed, ['SIGTERM'])
  runtime.emit('message', { broker: 'send', value: action })
  assert.equal(window.sent.length, 2)
})

test('supervisor proxy relays only native events and reports broker interruption', () => {
  const channel = child(),
    window = brokerWindow(channel)
  assert.deepEqual(channel.sent, [{ broker: 'launch' }])
  const messages = [],
    errors = [],
    exits = [],
    stderr = []
  window.on('message', (value) => messages.push(value))
  window.on('error', (value) => errors.push(value.message))
  window.on('exit', (...value) => exits.push(value))
  window.stderr.on('data', (value) => stderr.push(value.toString()))
  channel.emit('message', {
    broker: 'message',
    value: { operation: 'session' }
  })
  channel.emit('message', { broker: 'stderr', value: 'synthetic-diagnostic' })
  channel.emit('message', { broker: 'unknown', value: 'ignored' })
  window.send({ status: 'ok' })
  assert.deepEqual(messages, [{ operation: 'session' }])
  assert.deepEqual(stderr, ['synthetic-diagnostic'])
  assert.deepEqual(channel.sent[1], { broker: 'send', value: { status: 'ok' } })
  channel.emit('message', { broker: 'exit', code: 0, signal: null })
  assert.deepEqual(exits, [[0, null]])
  assert.equal(window.connected, false)
  assert.equal(channel.listenerCount('message'), 0)
  assert.equal(channel.listenerCount('disconnect'), 0)
  const interrupted = child(),
    proxy = brokerWindow(interrupted)
  proxy.on('error', (value) => errors.push(value.message))
  interrupted.emit('disconnect')
  assert.equal(proxy.connected, false)
  assert.equal(interrupted.listenerCount('message'), 0)
  assert.equal(interrupted.listenerCount('disconnect'), 0)
  assert.deepEqual(errors, ['Native graphical broker closed'])
})

test('close stops both children once and rejects missing inherited IPC', () => {
  const owner = setup()
  owner.runtime.emit('message', { broker: 'launch' })
  owner.close()
  owner.close()
  assert.deepEqual(owner.runtime.killed, ['SIGTERM'])
  assert.deepEqual(owner.launches[1].process.killed, ['SIGTERM'])
  assert.throws(() => brokerWindow({}), /Native graphical broker unavailable/)
})

test('runtime IPC loss stops both children and escalates a stalled shutdown', () => {
  const deadlines = [],
    cleared = []
  const owner = setup({
    schedule(callback, ms) {
      deadlines.push({ callback, ms })
      return deadlines.length
    },
    cancel(value) {
      cleared.push(value)
    }
  })
  owner.runtime.emit('message', { broker: 'launch' })
  const window = owner.launches[1].process
  owner.runtime.emit('disconnect')
  assert.deepEqual(owner.runtime.killed, ['SIGTERM'])
  assert.deepEqual(window.killed, ['SIGTERM'])
  assert.deepEqual(
    deadlines.map((value) => value.ms),
    [5000, 5000]
  )
  for (const deadline of deadlines) deadline.callback()
  assert.deepEqual(owner.runtime.killed, ['SIGTERM', 'SIGKILL'])
  assert.deepEqual(window.killed, ['SIGTERM', 'SIGKILL'])
  window.emit('exit', 0, null)
  assert(cleared.includes(2))
})
