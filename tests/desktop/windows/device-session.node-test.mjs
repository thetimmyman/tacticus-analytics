import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { windowsSetup } from '../../../apps/desktop/platform/windows/setup.mjs'
import { validOwnerSession } from '../../../apps/desktop/platform/windows/services.mjs'

const subject = '00000000-0000-4000-8000-000000000001',
  key = 'synthetic-signing-key',
  capability = 'a'.repeat(64)
const jwt = () => {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'HS256' })}.${encode({ sub: subject, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 300 })}`
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`
}
for (const migrated of [false, true])
  test(`main-only bootstrap preserves the owner and data (${migrated ? 'former password workspace' : 'interrupted new setup'})`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'Windows device session ü '))
    const protectedData = {
      personal: { displayName: 'Synthetic account' },
      vaultReferences: { Player: 'b'.repeat(32) }
    }
    if (migrated) {
      await writeFile(
        join(root, 'workspace-owner.json'),
        JSON.stringify({ subject, kind: 'personal-holding' })
      )
      await writeFile(
        join(root, 'official-onboarding.json'),
        JSON.stringify(protectedData)
      )
    }
    let storedSubject = migrated ? subject : null,
      sqlCalls = 0,
      authCalls = 0,
      accepted = migrated,
      password
    const credentials = []
    const auth = createServer(async (req, res) => {
      authCalls++
      let text = ''
      for await (const chunk of req) text += chunk
      const input = JSON.parse(text)
      assert.equal(input.email, 'desktop@localhost.invalid')
      assert.match(input.password, /^[A-Za-z0-9_-]{64}$/)
      if (req.url.startsWith('/admin/users')) {
        assert.equal(req.method, storedSubject ? 'PUT' : 'POST')
        assert.equal(req.headers.authorization, 'Bearer synthetic-service')
        storedSubject = subject
        password = input.password
        credentials.push(password)
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ id: subject }))
      } else {
        assert.equal(req.url, '/token?grant_type=password')
        assert.equal(input.password, password)
        res.statusCode = accepted ? 200 : 401
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify(
            accepted
              ? {
                  access_token: jwt(),
                  refresh_token: 'synthetic-refresh',
                  user: { id: subject }
                }
              : {}
          )
        )
      }
    })
    await new Promise((accept) => auth.listen(0, '127.0.0.1', accept))
    const handler = windowsSetup(
      {
        state: root,
        ports: { auth: auth.address().port },
        token: { service: 'synthetic-service' },
        validOwnerSession: (token, owner) =>
          validOwnerSession(token, owner, key),
        psql: async (sql) => {
          sqlCalls++
          return sql.includes('json_build_object')
            ? JSON.stringify({
                subject: storedSubject,
                occupied: migrated,
                demo: false
              })
            : ''
        }
      },
      root,
      root,
      { brokerToken: capability }
    )
    const server = createServer(
      (req, res) =>
        void handler(req, res, new URL(req.url, 'http://127.0.0.1')).catch(
          () => {
            res.statusCode = 500
            res.end()
          }
        )
    )
    await new Promise((accept) => server.listen(0, '127.0.0.1', accept))
    const request = (supplied) =>
      fetch(`http://127.0.0.1:${server.address().port}/desktop/open`, {
        method: 'POST',
        headers: supplied ? { 'x-desktop-broker': supplied } : {}
      })
    try {
      for (const supplied of [undefined, 'c'.repeat(64), 'short'])
        assert.equal((await request(supplied)).status, 403)
      assert.equal(sqlCalls, 0)
      assert.equal(authCalls, 0)
      if (!migrated) {
        assert.equal((await request(capability)).status, 503)
        accepted = true
      }
      const response = await request(capability)
      assert.equal(response.status, 200)
      const grant = await response.json()
      assert.equal(grant.session.user.id, subject)
      assert.equal(
        validOwnerSession(grant.session.access_token, subject, key),
        true
      )
      assert.equal(grant.destination, '/desktop/setup')
      const owner = JSON.parse(
        await readFile(join(root, 'workspace-owner.json'), 'utf8')
      )
      assert.deepEqual(owner, { subject, kind: 'personal-holding' })
      if (migrated)
        assert.deepEqual(
          JSON.parse(
            await readFile(join(root, 'official-onboarding.json'), 'utf8')
          ),
          protectedData
        )
      assert.equal((await request(capability)).status, 200)
      assert.equal(new Set(credentials).size, credentials.length)
      assert.equal(JSON.stringify(grant).includes(capability), false)
      assert.equal(JSON.stringify(owner).includes('password'), false)
    } finally {
      await new Promise((accept) => server.close(accept))
      await new Promise((accept) => auth.close(accept))
      await rm(root, { recursive: true, force: true })
    }
  })

test('Electron bootstrap uses a distinct fixed-endpoint partition and installs only Auth cookies', async () => {
  const require = createRequire(import.meta.url)
  const deviceSession = require('../../../apps/desktop/platform/windows/device-session.cjs')
  let requestGuard,
    headerGuard,
    calls = 0,
    release
  const storedCookies = []
  const pending = new Promise((accept) => {
    release = accept
  })
  const coordinator = {
    webRequest: {
      onBeforeRequest(fn) {
        requestGuard = fn
      },
      onBeforeSendHeaders(fn) {
        headerGuard = fn
      }
    },
    async fetch(url, options) {
      assert.equal(url, 'http://127.0.0.1:5000/desktop/open')
      assert.equal(options.redirect, 'error')
      calls++
      await pending
      return {
        ok: true,
        json: async () => ({
          session: {
            access_token: jwt(),
            refresh_token: 'synthetic-refresh',
            user: { id: subject }
          },
          destination: '/desktop/setup'
        })
      }
    }
  }
  const cookies = {
    get: async () => [{ name: 'tacticus-auth-token', value: 'old' }],
    remove: async (_origin, name) => assert.equal(name, 'tacticus-auth-token'),
    set: async (value) => storedCookies.push(value)
  }
  const config = {
    url: 'http://127.0.0.1:5000/desktop/setup',
    transportKey: 'b'.repeat(64),
    brokerToken: capability
  }
  const device = deviceSession(
    { webContents: { session: { cookies } } },
    config,
    {
      electron: {
        session: {
          fromPartition(name) {
            assert.match(name, /^device-session-[a-f0-9]{32}$/)
            return coordinator
          }
        }
      }
    }
  )
  for (const url of [
    'http://127.0.0.1:5000/desktop/open?x=1',
    'http://127.0.0.1:5000/api/auth/login',
    'https://foreign.invalid/desktop/open'
  ])
    requestGuard({ url }, (result) => assert.equal(result.cancel, true))
  headerGuard(
    { url: 'http://127.0.0.1:5000/desktop/open', requestHeaders: {} },
    (result) => {
      assert.equal(result.requestHeaders['x-desktop-broker'], capability)
      assert.equal(
        result.requestHeaders['x-desktop-transport'],
        config.transportKey
      )
    }
  )
  const first = device.open(),
    second = device.open()
  release()
  assert.equal(await first, '/desktop/setup')
  assert.equal(await second, '/desktop/setup')
  assert.equal(calls, 1)
  assert.ok(storedCookies.length)
  for (const cookie of storedCookies) {
    assert.match(cookie.name, /^tacticus-auth-token/)
    assert.equal(cookie.value.includes(capability), false)
  }
  const decoded = JSON.parse(
    Buffer.from(
      storedCookies
        .map((value) => value.value)
        .join('')
        .slice(7),
      'base64url'
    ).toString()
  )
  assert.equal(decoded.user.id, subject)
  assert.equal(decoded.brokerToken, undefined)
})

for (const scenario of [
  {
    name: 'a retained owner that differs from the local Auth account',
    owner: subject,
    stored: '00000000-0000-4000-8000-000000000002',
    occupied: true
  },
  {
    name: 'retained data without any owner binding',
    owner: null,
    stored: null,
    occupied: true
  }
])
  test(`bootstrap refuses ${scenario.name} before any Auth credential write`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'Windows device refusal ü '))
    const ownerFile = join(root, 'workspace-owner.json')
    if (scenario.owner)
      await writeFile(
        ownerFile,
        JSON.stringify({ subject: scenario.owner, kind: 'personal-holding' })
      )
    let authCalls = 0
    const auth = createServer((_req, res) => {
      authCalls++
      res.statusCode = 500
      res.end()
    })
    await new Promise((accept) => auth.listen(0, '127.0.0.1', accept))
    const handler = windowsSetup(
      {
        state: root,
        ports: { auth: auth.address().port },
        token: { service: 'synthetic-service' },
        validOwnerSession: () => false,
        psql: async (sql) =>
          sql.includes('json_build_object')
            ? JSON.stringify({
                subject: scenario.stored,
                occupied: scenario.occupied,
                demo: false
              })
            : ''
      },
      root,
      root,
      { brokerToken: capability }
    )
    const server = createServer(
      (req, res) => void handler(req, res, new URL(req.url, 'http://127.0.0.1'))
    )
    await new Promise((accept) => server.listen(0, '127.0.0.1', accept))
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/desktop/open`,
        { method: 'POST', headers: { 'x-desktop-broker': capability } }
      )
      assert.equal(response.status, 503)
      assert.equal(
        JSON.stringify(await response.json()).includes('Owner'),
        false
      )
      assert.equal(authCalls, 0)
      if (scenario.owner)
        assert.deepEqual(JSON.parse(await readFile(ownerFile, 'utf8')), {
          subject: scenario.owner,
          kind: 'personal-holding'
        })
      else await assert.rejects(readFile(ownerFile), { code: 'ENOENT' })
    } finally {
      await new Promise((accept) => server.close(accept))
      await new Promise((accept) => auth.close(accept))
      await rm(root, { recursive: true, force: true })
    }
  })

test('the page state read and a setup change queue instead of refusing each other', async () => {
  const root = await mkdtemp(join(tmpdir(), 'Windows setup queue ü '))
  await writeFile(
    join(root, 'workspace-owner.json'),
    JSON.stringify({ subject, kind: 'personal-holding' })
  )
  let active = 0,
    overlapped = false
  const handler = windowsSetup(
    {
      state: root,
      ports: { auth: 1 },
      token: { service: 'synthetic-service' },
      validOwnerSession: () => false,
      psql: async () => ''
    },
    root,
    root,
    {
      brokerToken: capability,
      async currentToken() {
        if (++active > 1) overlapped = true
        await new Promise((accept) => setTimeout(accept, 50))
        active--
        return null
      }
    }
  )
  const server = createServer(
    (req, res) => void handler(req, res, new URL(req.url, 'http://127.0.0.1'))
  )
  await new Promise((accept) => server.listen(0, '127.0.0.1', accept))
  const call = (path) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }).then((response) => response.status)
  try {
    assert.deepEqual(
      await Promise.all([
        call('/desktop/official-state'),
        call('/desktop/demo-setup')
      ]),
      [401, 401]
    )
    assert.deepEqual(
      (
        await Promise.all([
          call('/desktop/demo-setup'),
          call('/desktop/skip-optional')
        ])
      ).sort(),
      [401, 409]
    )
    assert.equal(overlapped, false)
  } finally {
    await new Promise((accept) => server.close(accept))
    await rm(root, { recursive: true, force: true })
  }
})

test('the dashboard access summary requires the owner session and reports the sample workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'Windows access status ü '))
  await writeFile(
    join(root, 'workspace-owner.json'),
    JSON.stringify({ subject, kind: 'personal-holding' })
  )
  const auth = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: subject }))
  })
  await new Promise((accept) => auth.listen(0, '127.0.0.1', accept))
  let live = true
  const handler = windowsSetup(
    {
      state: root,
      ports: { auth: auth.address().port },
      token: { service: 'synthetic-service' },
      validOwnerSession: (token, owner) =>
        live && validOwnerSession(token, owner, key),
      psql: async (sql) => (sql.includes("identity_mode='sample'") ? 't' : '')
    },
    root,
    root,
    { brokerToken: capability, currentToken: async () => jwt() }
  )
  const server = createServer(
    (req, res) => void handler(req, res, new URL(req.url, 'http://127.0.0.1'))
  )
  await new Promise((accept) => server.listen(0, '127.0.0.1', accept))
  const status = () =>
    fetch(`http://127.0.0.1:${server.address().port}/desktop/onboarding-status`)
  try {
    const response = await status()
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      demo: true,
      playerReady: false,
      guildReady: false,
      tokens: null,
      bombs: null,
      updatedAt: null
    })
    live = false
    assert.equal((await status()).status, 401)
  } finally {
    await new Promise((accept) => server.close(accept))
    await new Promise((accept) => auth.close(accept))
    await rm(root, { recursive: true, force: true })
  }
})
