import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { workspaceGameConnection } from '../launcher/game-connection.mjs'

async function fixture(action) {
  const token = randomBytes(32).toString('hex'),
    password = randomBytes(16).toString('hex')
  const state = {
    now: 1_900_000_000_000,
    queries: 0,
    logins: 0,
    mode: 'local-file',
    subject: randomUUID(),
    loginSubject: null
  }
  const auth = createServer(async (req, res) => {
    state.logins++
    let body = ''
    for await (const chunk of req) body += chunk
    const input = JSON.parse(body)
    res.writeHead(input.password === password ? 200 : 401, {
      'content-type': 'application/json'
    })
    res.end(
      JSON.stringify({ user: { id: state.loginSubject ?? state.subject } })
    )
  })
  await new Promise((resolve) => auth.listen(0, '127.0.0.1', resolve))
  const services = {
    ports: { auth: auth.address().port },
    psql: async () => {
      state.queries++
      return JSON.stringify({
        installation: state.subject,
        guildCode: 'SYN001',
        mode: state.mode
      })
    }
  }
  const handler = workspaceGameConnection(services, {
    brokerToken: token,
    clock: () => state.now
  })
  const server = createServer(async (req, res) => {
    if (!(await handler(req, res, new URL(req.url, 'http://127.0.0.1')))) {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  const request = (path, body, capability = token) =>
    fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(capability ? { 'x-desktop-broker': capability } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  try {
    await action({ state, request, token, password })
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await new Promise((resolve) => auth.close(resolve))
  }
}
test('the separate native capability precedes body parsing, database access and password verification', async () =>
  fixture(async (f) => {
    for (const token of [null, 'invalid', 'é'.repeat(64)]) {
      const response = await f.request(
        '/desktop/broker-context',
        { password: f.password },
        token
      )
      assert.equal(response.status, 403)
    }
    assert.equal(f.state.queries, 0)
    assert.equal(f.state.logins, 0)
    assert.deepEqual(
      await (await f.request('/desktop/connection-status')).json(),
      { connected: false }
    )
  }))
test('only the current local-file installation password releases its native connection context', async () =>
  fixture(async (f) => {
    let response = await f.request('/desktop/broker-context', {
      password: randomUUID()
    })
    assert.equal(response.status, 401)
    f.state.now += 3001
    f.state.loginSubject = randomUUID()
    response = await f.request('/desktop/broker-context', {
      password: f.password
    })
    assert.equal(response.status, 401)
    f.state.now += 3001
    f.state.loginSubject = null
    response = await f.request('/desktop/broker-context', {
      password: f.password
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      installation: f.state.subject,
      guildCode: 'SYN001'
    })
    assert.equal(
      (await f.request('/desktop/broker-context', { password: f.password }))
        .status,
      429
    )
  }))
test('sample workspaces and arbitrary credential fields cannot start a game connection', async () =>
  fixture(async (f) => {
    f.state.mode = 'sample'
    assert.equal(
      (await f.request('/desktop/broker-context', { password: f.password }))
        .status,
      409
    )
    assert.equal(f.state.logins, 0)
    f.state.now += 3001
    assert.equal(
      (
        await f.request('/desktop/broker-context', {
          password: f.password,
          apiKey: randomUUID()
        })
      ).status,
      400
    )
    assert.equal(f.state.logins, 0)
    f.state.now += 3001
    assert.equal(
      (
        await f.request('/desktop/broker-context', {
          password: 'x'.repeat(17000)
        })
      ).status,
      413
    )
    assert.equal(f.state.logins, 0)
  }))
test('native status is bound to its installation/guild and expires without exposing handles or identities', async () =>
  fixture(async (f) => {
    const connected = {
      connected: true,
      installation: f.state.subject,
      guildCode: 'SYN001',
      expiresAt: f.state.now + 10000
    }
    for (const patch of [
      { installation: randomUUID() },
      { guildCode: 'SYN002' },
      { expiresAt: 1 },
      { handle: randomBytes(16).toString('hex') }
    ])
      assert.equal(
        (await f.request('/desktop/broker-status', { ...connected, ...patch }))
          .status,
        400
      )
    assert.equal(
      (await f.request('/desktop/broker-status', connected)).status,
      200
    )
    assert.deepEqual(
      await (await f.request('/desktop/connection-status')).json(),
      { connected: true, guildCode: 'SYN001', expiresAt: connected.expiresAt }
    )
    f.state.now += 10001
    assert.deepEqual(
      await (await f.request('/desktop/connection-status')).json(),
      { connected: false }
    )
    assert.equal(
      (await f.request('/desktop/broker-status', { connected: false })).status,
      200
    )
  }))
