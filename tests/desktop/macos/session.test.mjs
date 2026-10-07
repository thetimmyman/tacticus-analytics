import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import {
  assertSession,
  localSessionGate
} from '../../../apps/desktop/platform/macos/session.mjs'

const key = 'synthetic-local-signature-key',
  subject = '00000000-0000-4000-8000-000000000001'
function token(claims = {}, alg = 'HS256') {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg })}.${encode({ sub: subject, role: 'authenticated', aud: 'authenticated', exp: 1000, ...claims })}`
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`
}
test('final native commit refuses expiry, forged signature, wrong owner/role/audience and future token', () => {
  assertSession(token(), subject, key, 1)
  for (const value of [
    token({ exp: 0 }),
    token({ sub: 'other' }),
    token({ role: 'service_role' }),
    token({ aud: 'other' }),
    token({ nbf: 2 }),
    token({}, 'none'),
    token().slice(0, -1) + 'X'
  ])
    assert.throws(
      () => assertSession(value, subject, key, 1),
      (error) => error.code === 'ESESSION'
    )
})
test('native authorization uses independent Auth owner validation and rechecks expiry after waiting; no password path', async () => {
  let accept = true,
    now = 1,
    expire = false
  const server = createServer((req, res) => {
    assert.equal(req.url, '/user')
    assert.equal(req.headers.authorization, `Bearer ${token()}`)
    if (expire) now = 1000001
    res.writeHead(accept ? 200 : 401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: subject }))
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const gate = localSessionGate({
    signingKey: key,
    now: () => now,
    services: {
      ports: { auth: server.address().port },
      psql: async () => subject
    }
  })
  try {
    const active = await gate.authorize(token())
    active.assert()
    accept = false
    await assert.rejects(
      gate.authorize(token()),
      (error) => error.code === 'ESESSION'
    )
    accept = true
    expire = true
    await assert.rejects(
      gate.authorize(token()),
      (error) => error.code === 'ESESSION'
    )
    assert.throws(active.assert, (error) => error.code === 'ESESSION')
  } finally {
    await new Promise((done) => server.close(done))
  }
})
