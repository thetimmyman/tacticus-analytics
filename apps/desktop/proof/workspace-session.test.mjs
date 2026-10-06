import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import {
  currentWorkspaceToken,
  nativeSessionRequest,
  workspaceAuthorized
} from '../launcher/workspace-session.mjs'
test('whole and contiguous split owner-session cookies yield a token lookup, while malformed and missing cookies refuse', () => {
  const token = 'synthetic.payload.signature',
    value =
      'base64-' +
      Buffer.from(JSON.stringify({ access_token: token })).toString('base64url')
  assert.equal(
    currentWorkspaceToken([{ name: 'tacticus-auth-token', value }]),
    token
  )
  assert.equal(
    currentWorkspaceToken([
      { name: 'tacticus-auth-token.1', value: value.slice(20) },
      { name: 'tacticus-auth-token.0', value: value.slice(0, 20) }
    ]),
    token
  )
  for (const cookies of [
    [],
    [{ name: 'tacticus-auth-token.1', value }],
    [{ name: 'tacticus-auth-token', value: 'malformed' }],
    [{ name: 'unrelated', value }],
    [
      {
        name: 'tacticus-auth-token',
        value: JSON.stringify({ access_token: 'not-a-token' })
      }
    ]
  ])
    assert.throws(
      () => currentWorkspaceToken(cookies),
      (error) => error.code === 'ESESSION'
    )
})
test('session authorization requires the separate native capability as well as the owner token', () => {
  const capability = randomBytes(32).toString('hex')
  assert.equal(
    nativeSessionRequest(
      {
        headers: {
          authorization: 'Bearer synthetic.payload.signature',
          'x-desktop-broker': capability
        }
      },
      capability
    ),
    true
  )
  for (const headers of [
    { authorization: 'Bearer synthetic.payload.signature' },
    { 'x-desktop-broker': capability },
    {
      authorization: 'Bearer synthetic.payload.signature',
      'x-desktop-broker': 'forged'
    }
  ])
    assert.equal(nativeSessionRequest({ headers }, capability), false)
})

const capability = 'a'.repeat(64)
const owner = 'synthetic-owner'
const nativeToken = 'native.payload.signature'
const browserToken = 'browser.payload.signature'
const cookie = (token) =>
  'tacticus-auth-token=base64-' +
  Buffer.from(JSON.stringify({ access_token: token })).toString('base64url')

async function authFixture(action) {
  const calls = []
  let identity = owner
  let status = 200
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const part of req) body += part
    calls.push({
      path: req.url,
      authorization: req.headers.authorization,
      body
    })
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify(
        req.url === '/user' ? { id: identity } : { user: { id: identity } }
      )
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await action({
      services: { ports: { auth: server.address().port } },
      calls,
      identity: (value) => {
        identity = value
      },
      status: (value) => {
        status = value
      }
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('cookie-only and forged-capability requests cannot authorize native callers', async () =>
  authFixture(async (f) => {
    for (const headers of [
      { cookie: cookie(browserToken) },
      { authorization: `Bearer ${nativeToken}`, cookie: cookie(browserToken) },
      {
        authorization: `Bearer ${nativeToken}`,
        'x-desktop-broker': 'b'.repeat(64),
        cookie: cookie(browserToken)
      }
    ])
      assert.equal(
        await workspaceAuthorized(
          f.services,
          { headers },
          {},
          owner,
          capability
        ),
        false
      )
    assert.equal(f.calls.length, 0)
  }))

test('browser import opts in explicitly and still requires Auth identity verification', async () =>
  authFixture(async (f) => {
    const req = { headers: { cookie: cookie(browserToken) } }
    assert.equal(
      await workspaceAuthorized(f.services, req, {}, owner, capability, {
        allowBrowserSession: 'true'
      }),
      false
    )
    assert.equal(f.calls.length, 0)
    assert.equal(
      await workspaceAuthorized(f.services, req, {}, owner, capability, {
        allowBrowserSession: true
      }),
      true
    )
    assert.equal(f.calls[0].authorization, `Bearer ${browserToken}`)
    f.identity('different-owner')
    assert.equal(
      await workspaceAuthorized(f.services, req, {}, owner, capability, {
        allowBrowserSession: true
      }),
      false
    )
    f.identity(owner)
    f.status(401)
    assert.equal(
      await workspaceAuthorized(f.services, req, {}, owner, capability, {
        allowBrowserSession: true
      }),
      false
    )
  }))

test('a valid native capability and owner bearer take precedence over browser cookies', async () =>
  authFixture(async (f) => {
    const req = {
      headers: {
        authorization: `Bearer ${nativeToken}`,
        'x-desktop-broker': capability,
        cookie: cookie(browserToken)
      }
    }
    for (const options of [undefined, { allowBrowserSession: true }])
      assert.equal(
        await workspaceAuthorized(
          f.services,
          req,
          {},
          owner,
          capability,
          options
        ),
        true
      )
    assert.deepEqual(
      f.calls.map((call) => call.authorization),
      [`Bearer ${nativeToken}`, `Bearer ${nativeToken}`]
    )
  }))

test('the existing internal password fallback still checks the current owner', async () =>
  authFixture(async (f) => {
    const input = { password: 'synthetic-internal-password' }
    assert.equal(
      await workspaceAuthorized(
        f.services,
        { headers: {} },
        input,
        owner,
        capability
      ),
      true
    )
    f.identity('different-owner')
    assert.equal(
      await workspaceAuthorized(
        f.services,
        { headers: {} },
        input,
        owner,
        capability
      ),
      false
    )
    assert(f.calls.every((call) => call.path === '/token?grant_type=password'))
  }))
