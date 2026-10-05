import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  projectPlayerAccess,
  readOfficialAccess,
  verifyOfficialAccess
} from '../launcher/official-access.mjs'
import { syntheticRosterUnit } from './synthetic-roster.mjs'

const profile = () => ({
  player: {
    details: { name: 'Synthetic Player', powerLevel: 12345 },
    units: [syntheticRosterUnit()],
    progress: {
      guildRaid: {
        tokens: { current: 2, max: 3, regenDelayInSeconds: 43200 },
        bombTokens: {
          current: 1,
          max: 3,
          nextTokenInSeconds: 500,
          regenDelayInSeconds: 86400
        }
      }
    }
  },
  metaData: { scopes: ['Player'], lastUpdatedOn: 1800000000 }
})
const response = (value) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' }
  })
test('Player-only credential obtains personal roster and bombs without requesting guild endpoints', async () => {
  const key = randomUUID(),
    calls = []
  const data = await verifyOfficialAccess('Player', key, 'SYN01', {
    fetch: async (url, options) => {
      calls.push(url)
      assert.equal(options.headers['X-API-KEY'], key)
      assert.equal(options.redirect, 'error')
      return response(profile())
    }
  })
  assert.deepEqual(calls, ['https://api.tacticusgame.com/api/v1/player'])
  assert.equal(data.roster.units.length, 1)
  assert.equal(data.tokens.current, 2)
  assert.equal(data.tokens.nextTokenInSeconds, null)
  assert.equal(data.bombs.current, 1)
  assert.deepEqual(data.scopes, ['Player'])
  assert(!JSON.stringify(data).includes(key))
})
test('expired credentials and absent Player scope cannot activate personal content', () => {
  const p = profile()
  p.metaData.scopes = ['Guild']
  assert.throws(() => projectPlayerAccess(p))
  p.metaData.scopes = ['Player']
  p.metaData.apiKeyExpiresOn = 1
  assert.throws(() => projectPlayerAccess(p))
})
test('missing optional resources are unavailable rather than invented zero counters', () => {
  const p = profile()
  delete p.player.progress
  const data = projectPlayerAccess(p)
  assert.equal(data.tokens, null)
  assert.equal(data.bombs, null)
})
test('Guild and raid access independently bind to the selected guild', async () => {
  const key = randomUUID(),
    guildId = randomUUID(),
    calls = []
  const result = await verifyOfficialAccess('Guild Raid', key, 'SYN01', {
    fetch: async (url) => {
      calls.push(url)
      return response(
        url.endsWith('/guild')
          ? { guild: { guildId, guildTag: 'SYN01' } }
          : { season: 44, entries: [] }
      )
    }
  })
  assert.equal(result.guildId, guildId)
  assert.equal(result.contents, null)
  assert.deepEqual(calls, [
    'https://api.tacticusgame.com/api/v1/guild',
    'https://api.tacticusgame.com/api/v1/guildRaid'
  ])
  await assert.rejects(
    verifyOfficialAccess('Guild', key, 'SYN01', {
      fetch: async () => response({ guild: { guildId, guildTag: 'OTHER01' } })
    })
  )
})
test('scope refusal, redirects, oversized replies and secret echoes never reach storage', async () => {
  const key = randomUUID()
  const cases = [
    () =>
      new Response('{}', {
        status: 403,
        headers: { 'content-type': 'application/json' }
      }),
    () =>
      new Response('{}', {
        headers: {
          'content-type': 'application/json',
          'content-length': String(9 * 1024 * 1024)
        }
      }),
    () => response({ echo: key }),
    () => response({ echo: Buffer.from(key).toString('base64') })
  ]
  for (const fetch of cases)
    await assert.rejects(readOfficialAccess('/api/v1/player', key, { fetch }))
  await assert.rejects(
    readOfficialAccess('/api/v1/player', key, {
      fetch: async () => ({
        ok: true,
        redirected: true,
        headers: new Headers({ 'content-type': 'application/json' })
      })
    })
  )
  let requests = 0
  await assert.rejects(
    readOfficialAccess('https://foreign.invalid/', key, {
      fetch: async () => {
        requests++
        return response({})
      }
    })
  )
  assert.equal(requests, 0)
})
test('hostile resource values fail validation and extra upstream fields are excluded', () => {
  const p = profile()
  p.player.progress.guildRaid.bombTokens.current = -1
  assert.throws(() => projectPlayerAccess(p))
  const q = profile()
  q.player.progress.guildRaid.bombTokens.extraSecret = 'synthetic-secret'
  q.player.unrelated = { secret: 'synthetic-secret' }
  assert(!JSON.stringify(projectPlayerAccess(q)).includes('synthetic-secret'))
})
