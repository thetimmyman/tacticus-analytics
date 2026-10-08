import { createConnection, createServer, isIP } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function verifyNetworkIsolation(target) {
  if (isIP(target ?? '') !== 4 || target.startsWith('127.'))
    throw new Error('External IPv4 qualification target required')

  // Keep the Unix path short enough for Darwin's sockaddr_un limit. Only this
  // private disposable directory is removed; no workspace data is touched.
  const directory = await mkdtemp('/tmp/ta-ipc-')
  const socketPath = join(directory, 'socket')
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    let message = ''
    socket.setTimeout(5000, () => socket.destroy())
    socket.on('error', () => socket.destroy())
    socket.on('data', (data) => {
      if (message.length + data.length > 14) socket.destroy()
      else message += data.toString()
    })
    socket.once('end', () => {
      if (message === 'synthetic-ping') socket.end('synthetic-pong')
      else socket.destroy()
    })
  })
  try {
    await new Promise((accept, reject) => {
      server.once('error', () =>
        reject(new Error('Local IPC listener refused'))
      )
      server.listen(socketPath, accept)
    })
    await new Promise((accept, reject) => {
      const socket = createConnection(socketPath)
      let message = ''
      const deadline = setTimeout(() => {
        socket.destroy()
        reject(new Error('Local IPC qualification timed out'))
      }, 5000)
      socket.once('connect', () => socket.end('synthetic-ping'))
      socket.on('data', (data) => {
        if (message.length + data.length > 14) socket.destroy()
        else message += data.toString()
      })
      socket.once('end', () => {
        clearTimeout(deadline)
        socket.destroy()
        if (message === 'synthetic-pong') accept()
        else reject(new Error('Local IPC response invalid'))
      })
      socket.once('error', () => {
        clearTimeout(deadline)
        socket.destroy()
        reject(new Error('Local IPC connection refused'))
      })
    })
  } finally {
    if (server.listening) await new Promise((accept) => server.close(accept))
    await rm(directory, { recursive: true, force: true })
  }

  // A timeout or remote refusal proves nothing about the sandbox. Require the
  // OS permission error from a direct numeric, non-loopback TCP connection.
  await new Promise((accept, reject) => {
    const socket = createConnection({ host: target, port: 443 })
    const deadline = setTimeout(() => {
      socket.destroy()
      reject(new Error('External TCP denial was not established'))
    }, 5000)
    socket.once('connect', () => {
      clearTimeout(deadline)
      socket.destroy()
      reject(new Error('Qualification policy allowed external TCP'))
    })
    socket.once('error', (error) => {
      clearTimeout(deadline)
      socket.destroy()
      if (error.code === 'EPERM' || error.code === 'EACCES') accept()
      else
        reject(new Error('External TCP denial was not an OS permission error'))
    })
  })
  return {
    synthetic: true,
    localUnixIPC: true,
    nonLoopbackTCPDenied: true
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(JSON.stringify(await verifyNetworkIsolation(process.argv[2])))
