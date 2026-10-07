import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import {
  deviceSessionRequest,
  projectDeviceSession,
  readDeviceSessionJSON,
  workspaceDeviceSession
} from '../../../apps/desktop/platform/macos/device-session.mjs'
import { currentWorkspaceToken } from '../../../apps/desktop/launcher/workspace-session.mjs'

const deviceSession = createRequire(import.meta.url)(
  '../../../apps/desktop/platform/macos/device-session.cjs'
)
const owner = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const broker = 'a'.repeat(64),
  transport = 'b'.repeat(64)
const signingKey = 'synthetic-device-session-signing-key'
function grant(claims = {}) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const payload = {
    sub: owner,
    role: 'authenticated',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims
  }
  const body = `${encode({ alg: 'HS256' })}.${encode(payload)}`
  return {
    access_token: `${body}.${createHmac('sha256', signingKey).update(body).digest('base64url')}`,
    refresh_token: 'synthetic-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    user: {
      id: owner,
      brokerToken: broker,
      password: 'synthetic-account-password'
    },
    brokerToken: broker,
    credential: 'synthetic-transient-credential'
  }
}
async function authFixture() {
  const calls = [],
    account = {
      subject: owner,
      password: 'synthetic-prior-workspace-password'
    }
  const control = {
    grant: () => grant(),
    verified: () => owner,
    verifyStatus: 200
  }
  let issuedToken
  const server = createServer(async (req, res) => {
    const body =
      req.method === 'POST' || req.method === 'PUT'
        ? JSON.parse(Buffer.concat(await Array.fromAsync(req)).toString())
        : null
    calls.push({
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization,
      body
    })
    res.setHeader('content-type', 'application/json')
    if (req.url === `/admin/users/${owner}` && req.method === 'PUT') {
      assert.equal(req.headers.authorization, 'Bearer synthetic-service-role')
      assert.deepEqual(Object.keys(body), ['password'])
      account.password = body.password
      res.end(JSON.stringify({ id: owner }))
    } else if (
      req.url === '/token?grant_type=password' &&
      req.method === 'POST'
    ) {
      assert.equal(body.email, 'desktop@localhost.invalid')
      assert.equal(body.password, account.password)
      assert.equal(req.headers.authorization, undefined)
      const issued = control.grant()
      issuedToken = issued.access_token
      res.end(JSON.stringify(issued))
    } else if (req.url === '/user' && req.method === 'GET') {
      assert.equal(req.headers.authorization, `Bearer ${issuedToken}`)
      res.writeHead(control.verifyStatus)
      res.end(JSON.stringify({ id: control.verified() }))
    } else {
      res.writeHead(404)
      res.end('{}')
    }
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return {
    calls,
    account,
    control,
    port: server.address().port,
    close: () =>
      new Promise((done) => {
        server.close(done)
        server.closeAllConnections()
      })
  }
}
function workspace(auth, options = {}) {
  const data = {
    subject: owner,
    fixtureRows: 8,
    vaultReferences: [
      'synthetic-player-vault-reference',
      'synthetic-guild-vault-reference'
    ]
  }
  const snapshot = JSON.stringify(data),
    queries = []
  const handler = workspaceDeviceSession(
    {
      ports: { auth: auth.port },
      token: { service: 'synthetic-service-role' },
      psql: async (sql) => {
        queries.push(sql)
        assert.match(sql, /^SELECT /)
        assert.match(sql, /JOIN auth\.users u ON u\.id=s\.subject_user_id/)
        assert.match(sql, /u\.email='desktop@localhost\.invalid'/)
        assert(!sql.includes('identity_mode'))
        return options.query
          ? options.query(queries.length)
          : JSON.stringify({ subject: data.subject })
      }
    },
    { brokerToken: broker, synthetic: options.synthetic }
  )
  const invoke = async (
    headers = {},
    method = 'POST',
    suffix = '/desktop/open'
  ) => {
    const url = new URL('http://127.0.0.1:34567' + suffix)
    let status, responseHeaders, body
    const handled = await handler(
      {
        method,
        headers: { origin: url.origin, 'x-desktop-broker': broker, ...headers }
      },
      {
        writeHead(value, headers_) {
          status = value
          responseHeaders = headers_
        },
        end(value) {
          body = JSON.parse(value)
        }
      },
      url
    )
    assert.equal(JSON.stringify(data), snapshot)
    return { handled, status, headers: responseHeaders, body }
  }
  return { invoke, queries, data }
}
test('main-only exact capability, origin and POST endpoint reject before SQL or Auth', async () => {
  const auth = await authFixture()
  try {
    const state = workspace(auth)
    for (const supplied of [
      undefined,
      '',
      'x'.repeat(64),
      'c'.repeat(64),
      broker + 'extra',
      [broker],
      {},
      'é'.repeat(64)
    ]) {
      assert.equal(
        deviceSessionRequest(
          { headers: { 'x-desktop-broker': supplied } },
          broker
        ),
        false
      )
      assert.equal(
        (
          await state.invoke({
            'x-desktop-broker': supplied,
            'x-desktop-transport': transport
          })
        ).status,
        403
      )
    }
    assert.equal((await state.invoke({}, 'GET')).status, 403)
    assert.equal(
      (await state.invoke({}, 'POST', '/desktop/open?next=/home')).status,
      403
    )
    assert.equal(
      (await state.invoke({ origin: 'https://example.invalid' })).status,
      403
    )
    assert.equal(
      (await state.invoke({}, 'POST', '/desktop/open/other')).handled,
      false
    )
    assert.equal(state.queries.length, 0)
    assert.equal(auth.calls.length, 0)
  } finally {
    await auth.close()
  }
})
test('absent and malformed legacy owner never create, overwrite or delete workspace data', async () => {
  const auth = await authFixture()
  try {
    const absent = workspace(auth, { query: () => 'null' })
    const response = await absent.invoke()
    assert.equal(response.status, 409)
    assert.equal(response.body.code, 'WORKSPACE_NOT_CREATED')
    const invalid = workspace(auth, {
      query: () => JSON.stringify({ subject: "not-an-owner'" })
    })
    assert.equal((await invalid.invoke()).status, 503)
    const failure = workspace(auth, {
      query: () => {
        throw new Error('synthetic-secret-bearing-db-failure')
      }
    })
    const failed = await failure.invoke()
    assert.equal(failed.status, 503)
    assert(!JSON.stringify(failed.body).includes('secret-bearing'))
    assert.equal(auth.calls.length, 0)
  } finally {
    await auth.close()
  }
})
test('legacy password migration and reopen preserve subject, fixture rows and API-vault bindings', async () => {
  const auth = await authFixture()
  try {
    const state = workspace(auth)
    const first = await state.invoke(),
      priorCredential = auth.account.password
    assert.equal(first.status, 200)
    assert.equal(first.body.destination, '/desktop/personal')
    assert.equal(first.body.session.user.id, owner)
    assert.equal(first.headers['cache-control'], 'no-store')
    assert.equal(priorCredential.length, 64)
    assert.notEqual(priorCredential, 'synthetic-prior-workspace-password')
    const second = await state.invoke()
    assert.equal(second.status, 200)
    assert.notEqual(auth.account.password, priorCredential)
    assert.deepEqual(state.data.vaultReferences, [
      'synthetic-player-vault-reference',
      'synthetic-guild-vault-reference'
    ])
    assert.equal(state.data.fixtureRows, 8)
    assert.equal(state.queries.length, 4)
    assert.deepEqual(
      auth.calls.map((call) => call.path),
      [0, 1].flatMap(() => [
        `/admin/users/${owner}`,
        '/token?grant_type=password',
        '/user'
      ])
    )
    for (const response of [first, second]) {
      const text = JSON.stringify(response.body)
      assert(
        !text.includes(broker) &&
          !text.includes(transport) &&
          !text.includes('synthetic-service-role') &&
          !text.includes('synthetic-transient-credential') &&
          !text.includes('synthetic-account-password')
      )
      assert(!text.includes(auth.account.password))
      assert.deepEqual(Object.keys(response.body.session.user), ['id'])
    }
    const demo = workspace(auth, { synthetic: true })
    assert.equal((await demo.invoke()).body.destination, '/home')
  } finally {
    await auth.close()
  }
})
test('malformed, expired and wrong-owner Auth grants fail; independent Auth verification and final owner recheck are required', async () => {
  const auth = await authFixture()
  try {
    for (const makeGrant of [
      () => ({ ...grant(), user: { id: other } }),
      () => grant({ sub: other }),
      () => grant({ exp: 1 }),
      () => ({ ...grant(), access_token: 'malformed' }),
      () => ({ ...grant(), refresh_token: '' }),
      () => grant({ role: 'service_role' })
    ]) {
      auth.control.grant = makeGrant
      assert.equal((await workspace(auth).invoke()).status, 503)
    }
    auth.control.grant = () => grant()
    auth.control.verified = () => other
    assert.equal((await workspace(auth).invoke()).status, 503)
    auth.control.verified = () => owner
    auth.control.verifyStatus = 401
    assert.equal((await workspace(auth).invoke()).status, 503)
    auth.control.verifyStatus = 200
    const changed = workspace(auth, {
      query: (count) => JSON.stringify({ subject: count === 1 ? owner : other })
    })
    assert.equal((await changed.invoke()).status, 503)
  } finally {
    await auth.close()
  }
})
test('busy bootstrap refuses a second credential rotation and clears busy after failure', async () => {
  const auth = await authFixture()
  let release
  try {
    const blocked = new Promise((done) => {
      release = done
    })
    const state = workspace(auth, {
      query: async (count) => {
        if (count === 1) {
          await blocked
          throw new Error('synthetic-failure')
        }
        return JSON.stringify({ subject: owner })
      }
    })
    const pending = state.invoke()
    await delay(0)
    const busy = await state.invoke()
    assert.equal(busy.status, 409)
    assert.equal(busy.body.code, 'WORKSPACE_OPENING')
    assert.equal(state.queries.length, 1)
    assert.equal(auth.calls.length, 0)
    release()
    assert.equal((await pending).status, 503)
    assert.equal((await state.invoke()).status, 200)
  } finally {
    release?.()
    await auth.close()
  }
})
test('bounded session input drops unexpected grant fields and rejects oversized or inconsistent Auth responses', async () => {
  const projected = projectDeviceSession(grant())
  assert.deepEqual(Object.keys(projected), [
    'access_token',
    'refresh_token',
    'token_type',
    'expires_in',
    'expires_at',
    'user'
  ])
  assert.deepEqual(projected.user, { id: owner })
  assert.throws(
    () => projectDeviceSession({ ...grant(), expires_at: 1 }),
    /Invalid local session/
  )
  await assert.rejects(
    readDeviceSessionJSON(new Response('x'.repeat(65537))),
    /Invalid local session response/
  )
  await assert.rejects(
    readDeviceSessionJSON(new Response('synthetic-malformed-secret')),
    (error) => error.message === 'Invalid local session response'
  )
})
function mainFixture(
  responses,
  sessionGrant = grant({ padding: 'x'.repeat(6000) })
) {
  const origin = 'http://127.0.0.1:34567',
    calls = [],
    loaded = [],
    partitions = []
  const cookies = [
    { name: 'tacticus-auth-token', value: 'stale' },
    { name: 'tacticus-auth-token.9', value: 'stale' },
    { name: 'unrelated', value: 'retained' }
  ]
  const window = new EventEmitter(),
    webContents = new EventEmitter()
  let beforeRequest, beforeHeaders
  const removed = []
  window.webContents = webContents
  webContents.session = {
    cookies: {
      async get() {
        return [...cookies]
      },
      async remove(_url, name) {
        removed.push(name)
        const index = cookies.findIndex((cookie) => cookie.name === name)
        if (index >= 0) cookies.splice(index, 1)
      },
      async set(cookie) {
        cookies.push(cookie)
      }
    }
  }
  window.loadURL = async (url) => {
    loaded.push(url)
    webContents.emit('did-navigate', {}, url)
  }
  const config = {
    url: origin + '/desktop/setup',
    brokerToken: broker,
    transportKey: transport
  }
  const electron = {
    session: {
      fromPartition(name) {
        partitions.push(name)
        return {
          webRequest: {
            onBeforeRequest(callback) {
              beforeRequest = callback
            },
            onBeforeSendHeaders(callback) {
              beforeHeaders = callback
            }
          },
          async fetch(url, options) {
            const call = { url, options }
            calls.push(call)
            const next = responses?.[calls.length - 1]
            if (typeof next === 'function') return next(call)
            return new Response(
              JSON.stringify(
                next?.body ?? {
                  session: sessionGrant,
                  destination: '/desktop/personal'
                }
              ),
              { status: next?.status ?? 200 }
            )
          }
        }
      }
    }
  }
  const device = deviceSession(window, config, { electron })
  return {
    device,
    window,
    origin,
    config,
    electron,
    cookies,
    removed,
    calls,
    loaded,
    partitions,
    webContents,
    beforeRequest: (...args) => beforeRequest(...args),
    beforeHeaders: (...args) => beforeHeaders(...args)
  }
}
test('ephemeral main transport allows only exact local POST and overwrites private headers; malformed URLs do not throw', () => {
  const main = mainFixture()
  assert.equal(main.partitions.length, 1)
  assert(!main.partitions[0].startsWith('persist:'))
  for (const url of [
    'broken-url',
    undefined,
    main.origin + '/desktop/open?next=foreign',
    main.origin + '/desktop/open#fragment',
    main.origin + '/desktop/open/extra',
    'https://example.invalid/desktop/open',
    'http://user@127.0.0.1:34567/desktop/open'
  ]) {
    main.beforeRequest({ url, method: 'POST' }, (result) =>
      assert.equal(result.cancel, true)
    )
    main.beforeHeaders({ url, method: 'POST' }, (result) =>
      assert.equal(result.cancel, true)
    )
    assert.doesNotThrow(() => main.webContents.emit('did-navigate', {}, url))
  }
  main.beforeRequest(
    { url: main.origin + '/desktop/open', method: 'GET' },
    (result) => assert.equal(result.cancel, true)
  )
  main.beforeRequest(
    { url: main.origin + '/desktop/open', method: 'POST' },
    (result) => assert.equal(result.cancel, false)
  )
  main.beforeHeaders(
    {
      url: main.origin + '/desktop/open',
      method: 'POST',
      requestHeaders: {
        'X-Desktop-Broker': 'foreign',
        Origin: 'foreign',
        Cookie: 'foreign',
        Authorization: 'foreign',
        Accept: 'application/json'
      }
    },
    (result) => {
      assert.deepEqual(result.requestHeaders, {
        Accept: 'application/json',
        origin: main.origin,
        'x-desktop-transport': transport,
        'x-desktop-broker': broker
      })
    }
  )
  assert.throws(
    () =>
      deviceSession(
        {},
        { ...main.config, url: 'broken-url' },
        { electron: main.electron }
      ),
    /Invalid local session destination/
  )
})
test('coalesced opens install contiguous normal Auth chunks decoded by the existing session helper without capability leakage', async () => {
  const sessionGrant = grant({ padding: 'x'.repeat(6000) })
  const main = mainFixture(undefined, sessionGrant)
  const first = main.device.open(),
    second = main.device.open()
  assert.equal(first, second)
  assert.equal(await first, true)
  assert.equal(main.calls.length, 1)
  assert.deepEqual(main.loaded, [main.origin + '/desktop/personal'])
  const request = main.calls[0]
  assert.equal(request.url, main.origin + '/desktop/open')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.credentials, 'omit')
  assert.equal(request.options.redirect, 'error')
  assert.deepEqual(request.options.headers, {
    origin: main.origin,
    'x-desktop-transport': transport,
    'x-desktop-broker': broker
  })
  assert.deepEqual(main.removed, [
    'tacticus-auth-token',
    'tacticus-auth-token.9'
  ])
  const authCookies = main.cookies.filter((cookie) =>
    cookie.name.startsWith('tacticus-auth-token')
  )
  assert(authCookies.length > 1 && authCookies.length <= 16)
  assert(
    authCookies.every(
      (cookie, index) => cookie.name === `tacticus-auth-token.${index}`
    )
  )
  assert.equal(currentWorkspaceToken(main.cookies), sessionGrant.access_token)
  const encoded = authCookies.map((cookie) => cookie.value).join('')
  const saved = JSON.parse(Buffer.from(encoded.slice(7), 'base64url'))
  assert.deepEqual(Object.keys(saved), [
    'access_token',
    'refresh_token',
    'token_type',
    'expires_in',
    'expires_at',
    'user'
  ])
  assert(
    !JSON.stringify(saved).includes(broker) &&
      !JSON.stringify(saved).includes(transport) &&
      !JSON.stringify(saved).includes('synthetic-transient-credential')
  )
  assert.deepEqual(saved.user, { id: owner })
  assert.deepEqual(
    main.cookies.find((cookie) => cookie.name === 'unrelated'),
    { name: 'unrelated', value: 'retained' }
  )
})
test('main rejects invalid session or destination before replacing cookies and sanitizes transport failures', async () => {
  for (const body of [
    { session: grant(), destination: '/desktop/setup' },
    { session: grant(), destination: 'https://example.invalid/home' },
    { session: { ...grant(), access_token: 'invalid' }, destination: '/home' },
    { session: grant({ sub: other }), destination: '/home' }
  ]) {
    const main = mainFixture([{ body }])
    await assert.rejects(
      main.device.open(),
      /The local workspace could not open/
    )
    assert.equal(main.removed.length, 0)
    assert.equal(main.loaded.length, 0)
  }
  const failed = mainFixture([
    () => {
      throw new Error('synthetic-transport-secret-' + broker)
    }
  ])
  await assert.rejects(
    failed.device.open(),
    (error) =>
      !error.message.includes(broker) &&
      !error.message.includes('synthetic-transport-secret')
  )
})
test('main retries explicit busy only once; fresh setup and denied recovery do not create navigation loops', async () => {
  const busy = { status: 409, body: { code: 'WORKSPACE_OPENING' } }
  const success = mainFixture([busy])
  assert.equal(await success.device.open(), true)
  assert.equal(success.calls.length, 2)
  const exhausted = mainFixture([busy, busy])
  assert.equal(await exhausted.device.open(), false)
  assert.equal(exhausted.calls.length, 2)
  const absent = mainFixture([
    { status: 409, body: { code: 'WORKSPACE_NOT_CREATED' } }
  ])
  let prevented = false
  absent.webContents.emit(
    'will-navigate',
    {
      preventDefault() {
        prevented = true
      }
    },
    absent.origin + '/desktop/setup'
  )
  absent.webContents.emit(
    'will-navigate',
    { preventDefault() {} },
    absent.origin + '/desktop/setup'
  )
  for (let i = 0; i < 100 && absent.loaded.length === 0; i++) await delay(1)
  await delay(5)
  assert(prevented)
  assert.equal(absent.calls.length, 1)
  assert.deepEqual(absent.loaded, [absent.origin + '/desktop/setup'])
})
test('failed cookie installation removes partial Auth chunks and preserves unrelated cookies', async () => {
  const main = mainFixture()
  const cookies = main.webContents.session.cookies
  const set = cookies.set
  let installed = 0
  cookies.set = async (cookie) => {
    if (++installed === 2) throw new Error('synthetic-cookie-secret-' + broker)
    return set(cookie)
  }
  await assert.rejects(
    main.device.open(),
    (error) =>
      !error.message.includes('synthetic-cookie-secret') &&
      !error.message.includes(broker)
  )
  assert.equal(installed, 2)
  assert.deepEqual(main.cookies, [{ name: 'unrelated', value: 'retained' }])
  assert.equal(main.loaded.length, 0)
  assert.throws(() => currentWorkspaceToken(main.cookies), { code: 'ESESSION' })
})
test('closed windows reject new and pending bootstrap before installing cookies or navigating', async () => {
  const closed = mainFixture()
  closed.window.emit('closed')
  await assert.rejects(
    closed.device.open(),
    /The local workspace could not open/
  )
  assert.equal(closed.calls.length, 0)
  let began, deliver
  const started = new Promise((done) => {
    began = done
  })
  const response = new Promise((done) => {
    deliver = done
  })
  const pending = mainFixture([
    () => {
      began()
      return response
    }
  ])
  const opening = pending.device.open()
  await started
  pending.window.emit('closed')
  assert.equal(pending.calls[0].options.signal.aborted, true)
  deliver(
    new Response(JSON.stringify({ session: grant(), destination: '/home' }))
  )
  await assert.rejects(opening, /The local workspace could not open/)
  assert.equal(pending.removed.length, 0)
  assert.equal(pending.loaded.length, 0)
})
