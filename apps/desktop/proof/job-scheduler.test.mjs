import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { localJobScheduler } from '../launcher/job-scheduler.mjs'
const keys = () => ({
  transportKey: randomBytes(32).toString('hex'),
  cronSecret: randomBytes(32).toString('hex')
})
async function listener(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}
test('scheduler refuses non-local and credential-bearing destinations before work', () => {
  const config = {
    services: { psql: () => assert.fail('Must not touch database') },
    ...keys()
  }
  for (const origin of [
    'https://foreign.invalid',
    'http://localhost:1234',
    'http://127.0.0.1:1234/foreign',
    'http://user:password@127.0.0.1:1234',
    'http://[::1]:1234'
  ])
    assert.throws(
      () => localJobScheduler({ ...config, origin }),
      /Invalid local scheduler/
    )
})
test('a held worker request cannot overlap interval ticks and shutdown drains cancellation', async () => {
  const auth = keys()
  let seeds = 0,
    requests = 0,
    resolveRequest
  const arrived = new Promise((resolve) => (resolveRequest = resolve))
  const server = await listener((req) => {
    requests++
    assert.ok(req.headers.authorization === `Bearer ${auth.cronSecret}`)
    assert.ok(req.headers['x-desktop-transport'] === auth.transportKey)
    assert.equal(req.url, '/api/desktop/jobs')
    resolveRequest()
  })
  const scheduler = localJobScheduler({
    services: {
      psql: async () => {
        seeds++
      }
    },
    ...auth,
    origin: server.origin,
    intervalMs: 20
  })
  try {
    assert.equal(scheduler.start(), true)
    assert.equal(scheduler.start(), false)
    await arrived
    await delay(80)
    assert.equal(seeds, 1)
    assert.equal(requests, 1)
    await scheduler.stop()
    await delay(40)
    assert.equal(seeds, 1)
  } finally {
    await scheduler.stop()
    await server.close()
  }
})
test('an optional refresh failure reports once and preserves service access', async () => {
  let failures = 0,
    seeds = 0,
    stops = 0,
    resolveFailure
  const failure = new Promise((resolve) => (resolveFailure = resolve))
  const server = await listener((_req, res) => {
    res.writeHead(503)
    res.end('{}')
  })
  const scheduler = localJobScheduler({
    services: {
      psql: async () => {
        seeds++
      },
      stop: () => {
        stops++
      }
    },
    ...keys(),
    origin: server.origin,
    onFailure: () => {
      failures++
      resolveFailure()
    }
  })
  try {
    scheduler.start()
    await failure
    await scheduler.stop()
    assert.equal(failures, 1)
    assert.equal(seeds, 1)
    assert.equal(stops, 0)
  } finally {
    await scheduler.stop()
    await server.close()
  }
})
