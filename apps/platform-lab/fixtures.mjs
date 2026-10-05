import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { validateFixture } from './contracts/validate.mjs'

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
export function generateFixture(seed = 7, mode = 'fixture') {
  const suffix = sha256(String(seed)).slice(0, 20)
  return validateFixture({
    schemaVersion: 'platform-fixture/v1',
    fixtureId: `synthetic-${seed}`,
    synthetic: true,
    seed,
    clock: {
      now: '2026-01-01T00:00:00.000Z',
      tokenExpiresAt: '2026-01-01T01:00:00.000Z'
    },
    network: { mode, allowedOrigins: [] },
    upstream: {
      responses: ['player', 'guild', 'guild-raid'].map((capability) => ({
        capability,
        method: 'GET',
        path: `/fixture/${capability}`,
        status: capability === 'player' ? 200 : 403,
        body:
          capability === 'player'
            ? {
                synthetic: true,
                displayName: 'Example Player',
                roster: [{ unit: 'synthetic-unit', level: 10 }]
              }
            : { synthetic: true, error: 'optional-scope-unavailable' }
      }))
    },
    profile: {
      displayName: 'Example Player',
      roster: [{ unit: 'synthetic-unit', level: 10 }]
    },
    canaries: [{ id: 'synthetic-secret', value: `SYNTHETIC-CANARY-${suffix}` }]
  })
}
export function assertNoCanaries(value, canaries) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  for (const { value: canary } of canaries) {
    const variants = [
      canary,
      encodeURIComponent(canary),
      [...Buffer.from(canary)]
        .map((byte) => `%${byte.toString(16).padStart(2, '0')}`)
        .join(''),
      [...Buffer.from(canary)]
        .map((byte) => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`)
        .join(''),
      [...Buffer.from(canary)]
        .map((byte) => `\\u00${byte.toString(16).padStart(2, '0')}`)
        .join(''),
      Buffer.from(canary).toString('hex'),
      Buffer.from(canary).toString('base64'),
      Buffer.from(canary).toString('base64url')
    ]
    const expanded = [
      ...variants,
      ...variants.map((entry) => JSON.stringify(entry).slice(1, -1)),
      ...variants.map(encodeURIComponent),
      ...variants.map((entry) => Buffer.from(entry).toString('base64')),
      ...variants.map((entry) => Buffer.from(entry).toString('base64url'))
    ]
    if (expanded.some((entry) => serialized.includes(entry)))
      throw new Error('Synthetic canary capture refused')
  }
}
export async function fixtureServer(fixture) {
  validateFixture(fixture)
  if (fixture.network.mode !== 'fixture')
    throw new Error('Fixture server requires fixture mode')
  const observed = { matched: 0, denied: 0, oversized: 0 }
  const server = createServer((request, response) => {
    let bytes = 0
    request.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > 65536) {
        observed.oversized++
        response.writeHead(413)
        response.end()
        request.destroy()
      }
    })
    request.on('end', () => {
      if (response.writableEnded) return
      const entry = fixture.upstream.responses.find(
        (entry) => entry.method === request.method && entry.path === request.url
      )
      const body = entry ? entry.body : { error: 'fixture-route-denied' }
      observed[entry ? 'matched' : 'denied']++
      response.writeHead(entry?.status ?? 403, {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      })
      response.end(JSON.stringify(body))
    })
  })
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', accept)
  })
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    observed,
    stop: () =>
      new Promise((accept, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : accept()))
      })
  }
}
