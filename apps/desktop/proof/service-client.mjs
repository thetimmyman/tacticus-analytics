import { fork } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { signedToken } from './native-services.mjs'

export async function nativeServices(config) {
  const owner = fork(new URL('./service-owner.mjs', import.meta.url), [], {
    // Use the bundled Node executable without inheriting proof-only tsx hooks.
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  const children = []
  const pending = new Map()
  let nextRequest = 0
  let fault
  let stopping = false
  let stopPromise
  let readyResolve, readyReject
  const ready = new Promise((accept, reject) => {
    readyResolve = accept
    readyReject = reject
  })
  const exited = new Promise((accept) => owner.once('exit', accept))
  const send = (message) => {
    if (!owner.connected)
      throw new Error('Local service supervisor disconnected')
    owner.send(message, (error) => {
      if (error) fail(error)
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
  owner.on('error', fail)
  owner.on('exit', () => {
    fail(new Error('Local service supervisor stopped'))
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onInterrupt)
  })
  owner.on('message', (message) => {
    const { type, id } = message
    if (type === 'ready') {
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
    send({ config })
    const metadata = await ready
    const { jwt } = JSON.parse(
      await readFile(join(metadata.state, 'credentials.json'), 'utf8')
    )
    const lifetime = config.tokenLifetimeSeconds ?? 86400
    process.on('SIGINT', onInterrupt)
    process.on('SIGTERM', onInterrupt)
    return {
      state: metadata.state,
      ports: metadata.ports,
      fresh: metadata.fresh,
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
