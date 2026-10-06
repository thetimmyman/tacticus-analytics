import { ownedNativeServices } from './native-services.mjs'

// The private IPC pipe is the coordinator's lifetime lease. Only this process
// owns ChildProcess objects and the workspace lock; no recorded PID is killed.
let services
let disconnected = false
const send = (message) => {
  if (process.connected) process.send(message, () => {})
}
const observe = (child, id) => {
  child.once('exit', (code, signal) =>
    send({
      type: 'child-exit',
      id,
      code,
      signal,
      fault: Boolean(services?.fault)
    })
  )
  child.once('error', () =>
    send({ type: 'child-error', id, fault: Boolean(services?.fault) })
  )
}
process.on('disconnect', () => {
  disconnected = true
  if (services) void services.stop().finally(() => process.exit(0))
})
process.once('message', async ({ config }) => {
  try {
    services = await ownedNativeServices(config)
    if (disconnected) {
      await services.stop()
      process.exit(0)
    }
    services.children.forEach(observe)
    process.on('message', async (message) => {
      const { type, id, args } = message
      try {
        if (type === 'launch') {
          const child = services.launch(...args)
          observe(child, id)
          send({ type: 'child-start', id, pid: child.pid })
        } else if (type === 'kill') {
          services.children[id]?.kill(args[0])
        } else if (type === 'psql') {
          const value = await services.psql(args[0])
          send({ type: 'result', id, value })
        } else if (type === 'stop') {
          await services.stop()
          send({ type: 'result', id })
          process.disconnect()
        }
      } catch {
        // SQL/logs may contain installation credentials. Keep errors generic.
        if (type === 'psql' || type === 'stop')
          send({ type: 'result', id, error: 'Local service operation failed' })
        else send({ type: 'child-error', id, fault: true })
      }
    })
    send({
      type: 'ready',
      state: services.state,
      ports: services.ports,
      fresh: services.fresh,
      serviceCredential: services.serviceCredential,
      children: services.children.map((child) => ({ pid: child.pid }))
    })
  } catch (error) {
    send({
      type: 'startup-error',
      code: /Incompatible local schema|Schema checkpoint|Schema receipt/.test(
        error.message
      )
        ? 'ESCHEMA'
        : error.code,
      error:
        error.code === 'EEXIST'
          ? 'EEXIST: Workspace already in use'
          : /Incompatible local schema/.test(error.message)
            ? 'Incompatible local schema; activation refused'
            : 'Local service startup failed; inspect private logs'
    })
    if (process.connected) process.disconnect()
  }
})
