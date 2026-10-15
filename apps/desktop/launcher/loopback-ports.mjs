import { createServer } from 'node:net'

/** Hold every service address until its listener is ready to take ownership. */
export async function reserveLoopbackPorts(roles) {
  if (
    !Array.isArray(roles) ||
    roles.length === 0 ||
    roles.length > 32 ||
    new Set(roles).size !== roles.length ||
    roles.some(
      (role) => typeof role !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(role)
    )
  ) {
    throw new TypeError('Distinct loopback service names are required')
  }
  const entries = new Map()
  const ports = {}
  const release = (role) => {
    const entry = entries.get(role)
    if (!entry) return Promise.reject(new TypeError('Unknown loopback service'))
    return (entry.closing ??= new Promise((resolve, reject) => {
      entry.server.close((error) =>
        error && error.code !== 'ERR_SERVER_NOT_RUNNING'
          ? reject(error)
          : resolve()
      )
    }))
  }
  const close = async () => {
    const results = await Promise.allSettled([...entries.keys()].map(release))
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Loopback reservation cleanup failed'
      )
  }
  try {
    for (const role of roles) {
      const server = createServer((socket) => socket.destroy())
      entries.set(role, { server })
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('Loopback reservation has no address')
      ports[role] = address.port
      server.unref()
    }
    return { ports: Object.freeze(ports), release, close }
  } catch (error) {
    await close().catch(() => {})
    throw error
  }
}
