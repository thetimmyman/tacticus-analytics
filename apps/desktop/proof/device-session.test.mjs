import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  deviceSessionRequest,
  workspaceDeviceSession
} from '../launcher/device-session.mjs'
import { browserWorkspaceToken } from '../launcher/workspace-session.mjs'
test('only an exact main-process capability can bootstrap the local owner session', async () => {
  const capability = randomBytes(32).toString('hex')
  for (const supplied of [
    undefined,
    '',
    'x'.repeat(64),
    randomBytes(32).toString('hex')
  ])
    assert.equal(
      deviceSessionRequest(
        { headers: { 'x-desktop-broker': supplied } },
        capability
      ),
      false
    )
  assert.equal(
    deviceSessionRequest(
      { headers: { 'x-desktop-broker': capability } },
      capability
    ),
    true
  )
  let queries = 0,
    status,
    body
  const handler = workspaceDeviceSession(
    {
      psql: async () => {
        queries++
        throw new Error('secret-bearing failure')
      }
    },
    { brokerToken: capability }
  )
  const response = {
    writeHead(value) {
      status = value
    },
    end(value) {
      body = JSON.parse(value)
    }
  }
  await handler(
    { method: 'POST', headers: {} },
    response,
    new URL('http://127.0.0.1:1234/desktop/open')
  )
  assert.equal(status, 403)
  assert.equal(queries, 0)
  await handler(
    { method: 'POST', headers: { 'x-desktop-broker': capability } },
    response,
    new URL('http://127.0.0.1:1234/desktop/open')
  )
  assert.equal(status, 503)
  assert(!JSON.stringify(body).includes('secret-bearing'))
})
test('file import session lookup rejects absent and malformed cookies; signed tokens still require Auth verification', () => {
  assert.equal(browserWorkspaceToken({ headers: {} }), null)
  assert.equal(
    browserWorkspaceToken({
      headers: { cookie: 'tacticus-auth-token=broken' }
    }),
    null
  )
  const value =
    'base64-' +
    Buffer.from(
      JSON.stringify({ access_token: 'synthetic.payload.signature' })
    ).toString('base64url')
  assert.equal(
    browserWorkspaceToken({
      headers: { cookie: `other=value; tacticus-auth-token=${value}` }
    }),
    'synthetic.payload.signature'
  )
})
