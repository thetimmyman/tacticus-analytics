import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { join } from 'node:path'
import { signedToken } from './native-services.mjs'

export async function nativeServices(config, { signal } = {}) {
  signal?.throwIfAborted()
  if (config.runtimeGuard)
    await mkdir(resolve(config.state), { recursive: true, mode: 0o700 })
  const owner = fork(new URL('./service-owner.mjs', import.meta.url), [], {
    // Use the bundled Node executable without inheriting proof-only tsx hooks.
    execPath: config.runtimeGuard || process.execPath,
    execArgv: config.runtimeGuard
      ? ['--owner', resolve(config.state), process.execPath]
      : [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  const children = []
  const pending = new Map()
  let nextRequest = 0
  let fault
  let readyComplete = false
  let stopping = false
  let stopPromise
  let readyResolve, readyReject
  const ready = new Promise((accept, reject) => {
    readyResolve = accept
    readyReject = reject
  })
  const exited = new Promise((accept) => {
    owner.once('exit', accept)
    owner.once('error', () => {
      if (!owner.pid) accept()
    })
  })
  const onAbort = () => {
    const error = Object.assign(new Error('Local service startup cancelled'), {
      name: 'AbortError'
    })
    fail(error)
    owner.kill('SIGTERM')
  }
  const send = (message) => {
    if (!owner.connected)
      throw new Error('Local service supervisor disconnected')
    owner.send(message, (error) => {
      if (error && (readyComplete || error.code !== 'EPIPE')) fail(error)
    })
  }
  const handle = (id, pid) => {
    const child = new EventEmitter()
    Object.assign(child, {
      pid,
      exitCode: null,
      signalCode: null,
      kill: (signal = 'SIGTERM') => {
        if (child.exitCode !== null || child.signalCode !== null) return false
        send({ type: 'kill', id, args: [signal] })
        return true
      }
    })
    child.on('error', () => {})
    children[id] = child
    return child
  }
  const fail = (error) => {
    if (!stopping) fault = error
    readyReject(error)
    for (const { reject } of pending.values()) reject(error)
    pending.clear()
  }
  owner.on('error', (error) => {
    if (readyComplete || error.code !== 'EPIPE') fail(error)
  })
  owner.on('exit', (code, exitSignal) => {
    fail(
      code === 73
        ? Object.assign(new Error('EEXIST: Workspace already in use'), {
            code: 'EEXIST'
          })
        : new Error('Local service supervisor stopped')
    )
    // The supervisor's runtime guard terminates the real processes with it, so
    // surface that on every live proxy handle instead of leaving them pending.
    for (const child of children) {
      if (!child || child.exitCode !== null || child.signalCode !== null)
        continue
      child.exitCode = code ?? null
      child.signalCode = exitSignal ?? (code == null ? 'SIGKILL' : null)
      child.emit('exit', child.exitCode, child.signalCode)
    }
    signal?.removeEventListener('abort', onAbort)
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onInterrupt)
  })
  owner.on('message', (message) => {
    const { type, id } = message
    if (type === 'ready') {
      readyComplete = true
      message.children.forEach(({ pid }, index) => handle(index, pid))
      readyResolve(message)
    } else if (type === 'startup-error') {
      fail(Object.assign(new Error(message.error), { code: message.code }))
    } else if (type === 'result') {
      const request = pending.get(id)
      pending.delete(id)
      if (message.error) request?.reject(new Error(message.error))
      else request?.resolve(message.value)
    } else if (type === 'child-start') {
      if (children[id]) children[id].pid = message.pid
    } else if (type === 'child-exit') {
      if (message.fault) fault = new Error('A local service failed')
      const child = children[id]
      if (child) {
        child.exitCode = message.code
        child.signalCode = message.signal
        child.emit('exit', message.code, message.signal)
      }
    } else if (type === 'child-error') {
      if (message.fault !== false)
        fault = new Error('Local process failed to start')
      children[id]?.emit('error', new Error('Local process failed to start'))
    }
  })
  const rpc = (type, args = []) =>
    new Promise((resolve, reject) => {
      const id = nextRequest++
      pending.set(id, { resolve, reject })
      try {
        send({ type, id, args })
      } catch (error) {
        pending.delete(id)
        reject(error)
      }
    })
  const stop = () => {
    if (stopPromise) return stopPromise
    stopping = true
    stopPromise = (async () => {
      if (owner.connected) await rpc('stop')
      await exited
    })()
    return stopPromise
  }
  const onInterrupt = () => {
    void stop().finally(() => process.exit(130))
  }
  try {
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    else send({ config })
    const metadata = await ready
    const { jwt } = JSON.parse(
      await readFile(join(metadata.state, 'credentials.json'), 'utf8')
    )
    if (signal?.aborted)
      throw Object.assign(new Error('Local service startup cancelled'), {
        name: 'AbortError'
      })
    signal?.removeEventListener('abort', onAbort)
    const lifetime = config.tokenLifetimeSeconds ?? 86400
    process.on('SIGINT', onInterrupt)
    process.on('SIGTERM', onInterrupt)
    return {
      state: metadata.state,
      ports: metadata.ports,
      fresh: metadata.fresh,
      supervisor: owner,
      serviceCredential: metadata.serviceCredential,
      children,
      token: {
        get anon() {
          return signedToken(jwt, 'anon', lifetime)
        },
        get service() {
          return signedToken(jwt, 'service_role', lifetime)
        }
      },
      psql: (sql) => rpc('psql', [sql]),
      stop,
      launch: (...args) => {
        if (stopping || fault) throw new Error('Local services are stopping')
        const id = children.length
        const child = handle(id)
        send({ type: 'launch', id, args })
        return child
      },
      get fault() {
        return fault
      }
    }
  } catch (error) {
    if (owner.connected) owner.disconnect()
    await exited
    throw error
  }
}
