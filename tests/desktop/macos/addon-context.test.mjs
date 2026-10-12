import test from 'node:test'
import assert from 'node:assert/strict'
import { macAddonContext } from '../../../apps/desktop/platform/macos/addon-context.mjs'

const brokerToken = 'a'.repeat(64)
function exchange(
  handler,
  { method = 'POST', path, headers = {}, body = '{}' }
) {
  let queries = 0
  const res = {
    status: null,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(value) {
      this.body = value ?? ''
    }
  }
  const req = {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body)
    }
  }
  return { req, res, queries: () => queries }
}

function setup() {
  let queries = 0
  const services = {
    ports: { auth: 1 },
    psql: async () => {
      queries++
      return 'null'
    }
  }
  return {
    handler: macAddonContext(services, { brokerToken }),
    queries: () => queries
  }
}

test('macOS gateway declines every route except the fixed add-on context', async () => {
  const { handler, queries } = setup()
  for (const path of [
    '/desktop/broker-context',
    '/desktop/broker-status',
    '/desktop/connection-status',
    '/desktop/addon-context/extra'
  ]) {
    const { req, res } = exchange(handler, { path })
    assert.equal(
      await handler(req, res, new URL('http://127.0.0.1' + path)),
      false
    )
  }
  const { req, res } = exchange(handler, {
    method: 'GET',
    path: '/desktop/addon-context'
  })
  assert.equal(
    await handler(req, res, new URL('http://127.0.0.1/desktop/addon-context')),
    false
  )
  assert.equal(queries(), 0)
})

test('add-on context refuses a missing or wrong native capability before database access', async () => {
  const { handler, queries } = setup()
  for (const headers of [
    {},
    { 'x-desktop-broker': 'b'.repeat(64) },
    { 'x-desktop-broker': 'invalid' }
  ]) {
    const { req, res } = exchange(handler, {
      path: '/desktop/addon-context',
      headers
    })
    assert.equal(
      await handler(
        req,
        res,
        new URL('http://127.0.0.1/desktop/addon-context')
      ),
      true
    )
    assert.equal(res.status, 403)
  }
  assert.equal(queries(), 0)
})

test('add-on context needs a native session bearer even with the right capability', async () => {
  const { handler, queries } = setup()
  const { req, res } = exchange(handler, {
    path: '/desktop/addon-context',
    headers: { 'x-desktop-broker': brokerToken }
  })
  assert.equal(
    await handler(req, res, new URL('http://127.0.0.1/desktop/addon-context')),
    true
  )
  assert.notEqual(res.status, 200)
  assert.equal(queries(), 0)
})
