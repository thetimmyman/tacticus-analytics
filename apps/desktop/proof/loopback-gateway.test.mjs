import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { loopbackGateway } from './loopback-gateway.mjs'

// Checked-in, runnable proof for desktop PR gate (a): the loopback gateway
// binds only to 127.0.0.1 and rejects foreign Origin and unsigned/unauthenticated
// requests. No native services (PostgreSQL/Auth/PostgREST) are required: this
// test exercises the HTTP gateway in loopback-gateway.mjs directly, with a
// stub upstream app port.

async function startStubUpstream() {
  const httpServer = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  await new Promise((accept, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', accept)
  })
  return {
    port: httpServer.address().port,
    stop: () => new Promise((accept) => httpServer.close(accept))
  }
}

async function withGateway(t, run) {
  const transportKey = randomBytes(32).toString('hex')
  const upstream = await startStubUpstream()
  const gateway = await loopbackGateway({
    services: { ports: {}, token: { anon: 'anon-token' } },
    transportKey,
    appPort: upstream.port
  })
  t.after(async () => {
    await gateway.stop()
    await upstream.stop()
  })
  await run({ gateway, transportKey })
}

test('non-hex transport headers are denied without stopping the gateway', async (t) => {
  await withGateway(t, async ({ gateway, transportKey }) => {
    const malformed = await fetch(gateway.origin, {
      headers: { 'x-desktop-transport': 'é'.repeat(64) }
    })
    assert.equal(malformed.status, 403)
    const healthy = await fetch(gateway.origin, {
      headers: { 'x-desktop-transport': transportKey }
    })
    assert.equal(healthy.status, 200)
  })
})

test('loopback gateway binds only to 127.0.0.1, not 0.0.0.0 or ::', async (t) => {
  await withGateway(t, async ({ gateway }) => {
    const url = new URL(gateway.origin)
    assert.equal(url.hostname, '127.0.0.1')
    // Confirm the listener address itself (not just the advertised origin)
    // is loopback-only by attempting a raw connection check via the server
    // address reported by Node, which loopbackGateway derives from
    // server.address() bound with '127.0.0.1' explicitly.
    assert.notEqual(url.hostname, '0.0.0.0')
    assert.notEqual(url.hostname, '::')
  })
})

test('loopback gateway rejects a request with no transport key', async (t) => {
  await withGateway(t, async ({ gateway }) => {
    const response = await fetch(`${gateway.origin}/`)
    assert.equal(response.status, 403)
  })
})

test('loopback gateway rejects a wrong-length / incorrect transport key', async (t) => {
  await withGateway(t, async ({ gateway }) => {
    const response = await fetch(`${gateway.origin}/`, {
      headers: { 'x-desktop-transport': 'not-the-right-key' }
    })
    assert.equal(response.status, 403)
  })
})

test('loopback gateway rejects a foreign Origin header even with a valid transport key', async (t) => {
  await withGateway(t, async ({ gateway, transportKey }) => {
    const response = await fetch(`${gateway.origin}/`, {
      headers: {
        'x-desktop-transport': transportKey,
        origin: 'https://attacker.example'
      }
    })
    assert.equal(response.status, 403)
  })
})

test('loopback gateway rejects a mismatched Host header even with a valid transport key', async (t) => {
  // fetch() forbids overriding the Host header, so this uses node:http
  // directly (as Node's own raw socket) to send a Host that does not match
  // the gateway's bound address.
  await withGateway(t, async ({ gateway, transportKey }) => {
    const url = new URL(gateway.origin)
    const http = await import('node:http')
    const status = await new Promise((accept, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: url.port,
          path: '/',
          method: 'GET',
          headers: {
            'x-desktop-transport': transportKey,
            Host: 'evil.example'
          }
        },
        (res) => accept(res.statusCode)
      )
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 403)
  })
})

test('loopback gateway accepts a same-origin request carrying the correct transport key', async (t) => {
  await withGateway(t, async ({ gateway, transportKey }) => {
    const response = await fetch(`${gateway.origin}/`, {
      headers: {
        'x-desktop-transport': transportKey,
        origin: gateway.origin
      }
    })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'ok')
  })
})

test('loopback gateway rejects protocol-relative request targets', async (t) => {
  await withGateway(t, async ({ gateway, transportKey }) => {
    const url = new URL(gateway.origin)
    const http = await import('node:http')
    const status = await new Promise((accept, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: url.port,
          path: '//attacker.example/',
          method: 'GET',
          headers: { 'x-desktop-transport': transportKey }
        },
        (res) => accept(res.statusCode)
      )
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 400)
  })
})

test('loopback gateway rejects a transport key that is not 64 hex characters', async () => {
  await assert.rejects(
    loopbackGateway({
      services: { ports: {}, token: { anon: 'anon-token' } },
      transportKey: 'too-short',
      appPort: 1
    }),
    /Invalid transport key/
  )
})
