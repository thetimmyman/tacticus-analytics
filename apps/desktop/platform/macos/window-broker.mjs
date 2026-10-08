import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// This broker has no HTTP client or renderer bridge. It launches two fixed
// installed entrypoints and relays only their inherited native IPC channel.
export function superviseWindows({
  root,
  state,
  policy,
  args,
  env,
  launch = spawn,
  schedule = setTimeout,
  cancel = clearTimeout
}) {
  const here = join(root, 'apps/desktop/platform/macos')
  const runtime = launch(
    '/usr/bin/sandbox-exec',
    ['-p', policy, join(root, 'bin/node'), join(here, 'runtime.mjs'), ...args],
    {
      env: { ...env, TA_MAC_WINDOW_BROKER: '1' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    }
  )
  let window,
    launched = false,
    windowExited = false,
    stopping = false
  const terminating = new WeakSet()
  const send = (child, value) => {
    if (child?.connected) child.send(value, () => {})
  }
  const terminate = (child) => {
    if (
      !child ||
      terminating.has(child) ||
      (child.exitCode !== null && child.exitCode !== undefined) ||
      child.signalCode
    )
      return
    terminating.add(child)
    child.kill('SIGTERM')
    const deadline = schedule(() => child.kill('SIGKILL'), 5000)
    deadline.unref?.()
    child.once('exit', () => cancel(deadline))
  }
  const close = () => {
    if (stopping) return
    stopping = true
    terminate(runtime)
    terminate(window)
  }
  runtime.on('message', (message) => {
    if (
      stopping ||
      !message ||
      JSON.stringify(message).length > 8 * 1024 * 1024
    )
      return
    if (
      message.broker === 'launch' &&
      !launched &&
      Object.keys(message).length === 1
    ) {
      launched = true
      window = launch(
        join(root, 'electron/Electron.app/Contents/MacOS/Electron'),
        [join(here, 'main.cjs'), join(state, 'window-config.json')],
        {
          cwd: state,
          env: {
            PATH: join(root, 'bin'),
            LANG: 'en_US.UTF-8',
            HOME: env.HOME,
            TMPDIR: env.TMPDIR
          },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        }
      )
      window.on('message', (action) => {
        if (action && JSON.stringify(action).length <= 20000)
          send(runtime, { broker: 'message', value: action })
      })
      for (const stream of ['stdout', 'stderr'])
        window[stream].on('data', (bytes) => {
          const value = bytes.toString('utf8')
          for (let index = 0; index < value.length; index += 4096)
            send(runtime, {
              broker: stream,
              value: value.slice(index, index + 4096)
            })
        })
      window.once('error', () => send(runtime, { broker: 'error' }))
      window.once('exit', (code, signal) => {
        windowExited = true
        send(runtime, { broker: 'exit', code, signal })
      })
    } else if (message.broker === 'send' && window) send(window, message.value)
  })
  runtime.once('disconnect', () => {
    if (!windowExited) close()
  })
  runtime.once('error', close)
  runtime.once('exit', (code, signal) => {
    stopping = true
    terminate(window)
    runtime.emit('broker-exit', code, signal)
  })
  return { runtime, close }
}

export function brokerWindow(channel = process) {
  if (typeof channel.send !== 'function' || !channel.connected)
    throw new Error('Native graphical broker unavailable')
  const window = new EventEmitter()
  window.stdout = new EventEmitter()
  window.stderr = new EventEmitter()
  window.connected = true
  window.send = (value) => channel.send({ broker: 'send', value })
  let finished = false
  const detach = () => {
    finished = true
    window.connected = false
    channel.removeListener('message', observe)
    channel.removeListener('disconnect', disconnect)
  }
  const observe = (message) => {
    if (!message || typeof message.broker !== 'string') return
    if (
      ['stdout', 'stderr'].includes(message.broker) &&
      typeof message.value === 'string'
    )
      window[message.broker].emit('data', Buffer.from(message.value))
    else if (message.broker === 'message') window.emit('message', message.value)
    else if (message.broker === 'error')
      window.emit('error', new Error('Native window failed'))
    else if (message.broker === 'exit') {
      detach()
      window.emit('exit', message.code, message.signal)
    }
  }
  const disconnect = () => {
    if (finished) return
    detach()
    window.emit('error', new Error('Native graphical broker closed'))
    window.emit('exit', null, 'SIGTERM')
  }
  channel.on('message', observe)
  channel.once('disconnect', disconnect)
  channel.send({ broker: 'launch' })
  return window
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.platform !== 'darwin' || !process.env.TA_MAC_GUARD_LOCK)
    throw new Error('Native macOS owner required')
  const args = process.argv.slice(2),
    index = args.indexOf('--verify')
  if (index < 0) throw new Error('Synthetic graphical qualification required')
  const verify = JSON.parse(await readFile(args[index + 1], 'utf8'))
  if (
    verify.synthetic !== true ||
    typeof verify.networkPolicy !== 'string' ||
    !verify.networkPolicy.startsWith('(version 1)') ||
    !verify.networkPolicy.includes('(deny network*)')
  )
    throw new Error('Synthetic network policy required')
  const { runtime, close } = superviseWindows({
    root: resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'),
    state: dirname(process.env.TA_MAC_GUARD_LOCK),
    policy: verify.networkPolicy,
    args,
    env: process.env
  })
  process.once('SIGTERM', close)
  process.once('SIGINT', close)
  runtime.once('error', () => {
    close()
    process.exitCode = 1
  })
  runtime.once('broker-exit', (code) => {
    process.exitCode = code === 0 ? 0 : 1
  })
}
