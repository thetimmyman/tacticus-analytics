import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { reserveLoopbackPorts } from '../../../apps/desktop/launcher/loopback-ports.mjs'

async function bind(port) {
  const server = createServer((socket) => socket.destroy())
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    return server
  } catch (error) {
    server.close()
    throw error
  }
}
const close = (server) =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )

test('service ports stay distinct and reserved until their owner takes over', async () => {
  const reservation = await reserveLoopbackPorts(['db', 'auth', 'rest'])
  const services = []
  try {
    assert.equal(new Set(Object.values(reservation.ports)).size, 3)
    for (const port of Object.values(reservation.ports)) {
      await assert.rejects(bind(port), { code: 'EADDRINUSE' })
    }
    await reservation.release('db')
    services.push(await bind(reservation.ports.db))
    for (const role of ['auth', 'rest'])
      await assert.rejects(bind(reservation.ports[role]), {
        code: 'EADDRINUSE'
      })
    await reservation.release('auth')
    services.push(await bind(reservation.ports.auth))
    await assert.rejects(bind(reservation.ports.rest), { code: 'EADDRINUSE' })
    await reservation.release('rest')
    services.push(await bind(reservation.ports.rest))
  } finally {
    await reservation.close()
    await Promise.all(services.map(close))
  }
})

test('cancelled startup releases every reservation and close is idempotent', async () => {
  const reservation = await reserveLoopbackPorts(['db', 'auth', 'rest'])
  await reservation.close()
  await reservation.close()
  const services = []
  try {
    for (const port of Object.values(reservation.ports))
      services.push(await bind(port))
  } finally {
    await Promise.all(services.map(close))
  }
})

test('duplicate or invalid service names are rejected before allocation', async () => {
  await assert.rejects(reserveLoopbackPorts(['db', 'db']), TypeError)
  await assert.rejects(reserveLoopbackPorts([]), TypeError)
  await assert.rejects(reserveLoopbackPorts(['']), TypeError)
})
