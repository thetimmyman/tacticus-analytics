import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { workspaceRaidImport } from '../launcher/raid-import.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'

const owner = '00000000-0000-4000-8000-000000000001'
const token = 'synthetic.payload.signature'
const transportKey = 'a'.repeat(64)
const contents = JSON.stringify({
  format: 'ta-raid-file-v1',
  guildCode: 'SYN001',
  season: 9999,
  entries: [
    {
      userId: 'synthetic-player',
      type: 'raid',
      encounterIndex: 1,
      damageDealt: 158,
      remainingHp: 842,
      maxHp: 1000,
      tier: 1,
      set: 1,
      damageType: 'Battle',
      rarity: 'Epic',
      timestamp: '2026-10-01T00:00:00Z'
    }
  ]
})
const cookie =
  'tacticus-auth-token=base64-' +
  Buffer.from(JSON.stringify({ access_token: token })).toString('base64url')

async function fixture(t, { identity = owner, authStatus = 200 } = {}) {
  const authCalls = [],
    queries = [],
    normalized = []
  const auth = createServer((req, res) => {
    authCalls.push({ path: req.url, bearer: req.headers.authorization })
    res.writeHead(authStatus, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: identity }))
  })
  await new Promise((accept) => auth.listen(0, '127.0.0.1', accept))
  const services = {
    ports: { auth: auth.address().port },
    psql: async (sql) => {
      queries.push(sql)
      if (sql.startsWith('SELECT '))
        return JSON.stringify({
          subject: owner,
          guildCode: 'SYN001',
          clusterCode: 'synthetic-cluster',
          clusterId: 'synthetic-cluster',
          playerMappings: [],
          bossMappings: {}
        })
      assert.match(sql, /^BEGIN;/)
      assert(sql.includes(owner))
      return 'desktop-import-result:{"imported":1}'
    }
  }
  const gateway = await loopbackGateway({
    services,
    transportKey,
    handleLocalRequest: workspaceRaidImport(services, {
      brokerToken: 'b'.repeat(64),
      normalize: async (file, context) => {
        normalized.push({ file, context })
        return [{ synthetic: true }]
      }
    })
  })
  t.after(async () => {
    await gateway.stop()
    await new Promise((accept) => {
      auth.close(accept)
      auth.closeAllConnections()
    })
  })
  return {
    gateway,
    authCalls,
    normalized,
    queries,
    send: (headers = {}) =>
      fetch(gateway.origin + '/desktop/import', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-desktop-transport': transportKey,
          origin: gateway.origin,
          cookie,
          ...headers
        },
        body: JSON.stringify({ contents })
      })
  }
}

test('browser raid import reaches one write only after transport and owner Auth checks', async (t) => {
  const f = await fixture(t)
  const response = await f.send()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { imported: 1 })
  assert.deepEqual(f.authCalls, [{ path: '/user', bearer: `Bearer ${token}` }])
  assert.equal(f.normalized.length, 1)
  assert.equal(f.normalized[0].context.guildCode, 'SYN001')
  assert.equal(f.queries.filter((sql) => sql.startsWith('BEGIN;')).length, 1)
})

test('transport and foreign-origin refusals precede SQL and Auth even with an owner cookie', async (t) => {
  const f = await fixture(t)
  for (const headers of [
    { 'x-desktop-transport': '' },
    { 'x-desktop-transport': 'c'.repeat(64) },
    { origin: 'http://foreign.invalid' }
  ])
    assert.equal((await f.send(headers)).status, 403)
  assert.deepEqual(f.authCalls, [])
  assert.deepEqual(f.queries, [])
  assert.deepEqual(f.normalized, [])
})

for (const [name, options] of [
  ['another owner', { identity: '00000000-0000-4000-8000-000000000002' }],
  ['an expired owner session', { authStatus: 401 }]
])
  test(`browser raid import refuses ${name} without normalization or writes`, async (t) => {
    const f = await fixture(t, options)
    assert.equal((await f.send()).status, 401)
    assert.equal(f.authCalls.length, 1)
    assert.equal(f.queries.length, 1)
    assert(f.queries[0].startsWith('SELECT '))
    assert.deepEqual(f.normalized, [])
  })

test('missing owner cookies refuse before SQL or Auth', async (t) => {
  const f = await fixture(t)
  assert.equal((await f.send({ cookie: '' })).status, 400)
  assert.deepEqual(f.authCalls, [])
  assert.deepEqual(f.queries, [])
  assert.deepEqual(f.normalized, [])
})
