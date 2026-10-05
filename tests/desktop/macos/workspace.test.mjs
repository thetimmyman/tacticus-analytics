import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import {
  createPersonalWorkspace,
  personalWorkspace
} from '../../../apps/desktop/platform/macos/workspace.mjs'

const owner = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
async function fixture(t) {
  const calls = []
  const state = {
    subject: null,
    initialized: false,
    failLedger: false,
    returned: owner
  }
  const server = createServer(async (req, res) => {
    const body = JSON.parse(
      Buffer.concat(await Array.fromAsync(req)).toString()
    )
    calls.push({ path: req.url, method: req.method, body })
    state.subject = owner
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: state.returned }))
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(
    () =>
      new Promise((done) => {
        server.close(done)
        server.closeAllConnections()
      })
  )
  const queries = []
  const services = {
    ports: { auth: server.address().port },
    token: { service: 'synthetic-service-role' },
    async psql(sql) {
      queries.push(sql)
      if (sql.startsWith('INSERT')) {
        if (state.failLedger) throw new Error('Synthetic interrupted ledger')
        state.initialized = true
        return ''
      }
      return JSON.stringify({ subject: state.subject, occupied: false })
    }
  }
  return { services, state, calls, queries }
}

test('interrupted password-free creation reuses its Auth owner without replacing local data', async (t) => {
  const f = await fixture(t)
  f.state.failLedger = true
  await assert.rejects(
    createPersonalWorkspace(f.services),
    /interrupted ledger/
  )
  f.state.failLedger = false
  assert.equal(await createPersonalWorkspace(f.services), owner)
  assert.equal(f.state.initialized, true)
  assert.deepEqual(
    f.calls.map(({ method, path }) => ({ method, path })),
    [
      { method: 'POST', path: '/admin/users' },
      { method: 'PUT', path: '/admin/users/' + owner }
    ]
  )
  assert.ok(
    f.calls.every(({ body }) => /^[A-Za-z0-9_-]{64}$/.test(body.password))
  )
  assert.notEqual(f.calls[0].body.password, f.calls[1].body.password)
  assert.ok(f.queries.every((sql) => !/DELETE|TRUNCATE|password/i.test(sql)))
})

test('creation refuses occupied data and an Auth owner mismatch before writing the ledger', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    createPersonalWorkspace({
      ...f.services,
      psql: async () => JSON.stringify({ subject: owner, occupied: true })
    }),
    /Existing local data requires recovery/
  )
  assert.equal(f.calls.length, 0)
  f.state.subject = owner
  f.state.returned = other
  await assert.rejects(
    createPersonalWorkspace(f.services),
    /owner does not match/
  )
  assert.equal(f.state.initialized, false)
  assert.ok(f.queries.every((sql) => !sql.startsWith('INSERT')))
})

test('concurrent setup is refused while the first owner-ledger read is still pending', async () => {
  let release, started
  const pending = new Promise((done) => {
    release = done
  })
  const reading = new Promise((done) => {
    started = done
  })
  let reads = 0
  const handler = personalWorkspace(
    {
      async psql() {
        reads++
        started()
        await pending
        return 't'
      }
    },
    '.'
  )
  const request = { method: 'POST' }
  const response = () => ({
    status: null,
    writeHead(status) {
      this.status = status
    },
    end() {}
  })
  const first = response(),
    second = response()
  const opening = handler(
    request,
    first,
    new URL('http://127.0.0.1:9/desktop/setup')
  )
  await reading
  try {
    await handler(request, second, new URL('http://127.0.0.1:9/desktop/setup'))
    assert.equal(second.status, 409)
    assert.equal(reads, 1)
  } finally {
    release()
    await opening
  }
  assert.equal(first.status, 409)
})
