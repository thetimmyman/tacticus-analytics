import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { OfficialRaidBroker } from '../launcher/official-raid-broker.mjs'
import { syntheticRosterUnit } from './synthetic-roster.mjs'

const denied = {
  code: 'EBROKER',
  message: 'Game connection is unavailable. Reconnect or try again.'
}
const fixture = () => {
  const secret = randomUUID(),
    guildId = randomUUID()
  const state = {
    grant: {
      operation: 'official-guild-raids',
      installation: randomUUID(),
      guildCode: 'SYN001'
    },
    expiry: 2_000_000_000,
    guildId,
    guildTag: 'SYN001',
    now: 1_900_000_000_000,
    calls: [],
    records: new Map(),
    saves: 0,
    reads: 0,
    deleted: 0
  }
  const row = {
    userId: 'synthetic-player',
    type: 'SyntheticBoss',
    damageType: 'Battle',
    damageDealt: 250,
    remainingHp: 750,
    maxHp: 1000,
    tier: 5,
    set: 1,
    encounterIndex: 0,
    rarity: 'Legendary',
    startedOn: '2000-01-01T00:00:00Z',
    completedOn: '2000-01-01T00:00:10Z',
    heroDetails: [{ unitId: 'synthetic-hero', power: 5700 }]
  }
  state.raid = {
    season: 9999,
    seasonConfigId: 'synthetic-season',
    entries: [row]
  }
  const vault = {
    async save(value) {
      state.saves++
      const h = randomUUID().replaceAll('-', '')
      state.records.set(h, value)
      return h
    },
    async withCredential(h, operation) {
      state.reads++
      assert(state.records.has(h))
      return operation(state.records.get(h))
    },
    async forget(h) {
      state.deleted++
      state.records.delete(h)
    }
  }
  const transport = async (url, options) => {
    state.calls.push({ url, options })
    assert.equal(options.headers['X-API-KEY'], secret)
    let response = url.endsWith('/player')
      ? {
          player: state.player ?? { details: { name: 'Synthetic Player' } },
          metaData: {
            scopes: ['Player', 'Guild', 'Guild Raid'],
            apiKeyExpiresOn: state.expiry
          }
        }
      : url.endsWith('/guild')
        ? { guild: { guildId: state.guildId, guildTag: state.guildTag } }
        : state.raid
    if (state.respond) return state.respond(url, options, response)
    return Response.json(response)
  }
  const broker = new OfficialRaidBroker({
    vault,
    consent: () => state.grant,
    fetch: transport,
    clock: () => state.now
  })
  return { state, broker, secret, row }
}
test('own roster is projected through fixed player/guild reads without saved payload or ownership claim', async () => {
  const f = fixture()
  f.state.player = {
    details: { name: 'Synthetic Roster', powerLevel: 1000 },
    units: [syntheticRosterUnit()],
    inventory: { unused: true },
    userId: 'synthetic-unverified'
  }
  await f.broker.connect(f.secret)
  const result = await f.broker.currentRoster()
  assert.equal(result.units[0].xpLevel, 40)
  assert.equal(result.guildCode, 'SYN001')
  assert(!JSON.stringify(result).includes(f.secret))
  assert(!JSON.stringify(result).includes('synthetic-unverified'))
  assert(
    f.state.calls.every(
      (call) => call.url.endsWith('/player') || call.url.endsWith('/guild')
    )
  )
  assert(!('roster' in f.broker.savedConnection()))
  const reads = f.state.reads
  await assert.rejects(
    f.broker.currentRoster('https://example.invalid'),
    denied
  )
  assert.equal(f.state.reads, reads)
  f.state.grant = null
  await assert.rejects(f.broker.currentRoster(), denied)
  assert.equal(f.state.reads, reads)
  assert.equal(f.state.records.size, 0)
})
test('roster shape and secret echoes are refused without returning partial data', async () => {
  for (const echoed of [false, true]) {
    const f = fixture()
    f.state.player = {
      details: { name: 'Synthetic Roster', powerLevel: 1000 },
      units: [syntheticRosterUnit()]
    }
    await f.broker.connect(f.secret)
    if (echoed) f.state.player.inventory = { arbitrary: f.secret }
    else
      f.state.player.units.push({
        ...syntheticRosterUnit(),
        id: 'syntheticSecond',
        xpLevel: 32768
      })
    await assert.rejects(f.broker.currentRoster(), denied)
    assert.equal(f.state.records.size, 1)
  }
})
test('refusal and malformed keys cause no discovery, upstream or vault access', async () => {
  const f = fixture()
  f.state.grant = null
  await assert.rejects(f.broker.connect(f.secret), denied)
  assert.equal(f.state.calls.length, 0)
  assert.equal(f.state.saves, 0)
  f.state.grant = {
    operation: 'arbitrary-request',
    installation: randomUUID(),
    guildCode: 'SYN001'
  }
  await assert.rejects(f.broker.connect(f.secret), denied)
  assert.equal(f.state.calls.length, 0)
})
test('only fixed HTTPS GETs authenticate upstream; canonical bounded raid output omits root credentials', async () => {
  const f = fixture()
  assert.deepEqual(await f.broker.connect(f.secret), {
    connected: true,
    guildCode: 'SYN001',
    expiresAt: f.state.expiry * 1000
  })
  const result = await f.broker.currentRaids()
  assert.deepEqual(JSON.parse(result.contents), {
    format: 'ta-raid-file-v1',
    guildCode: 'SYN001',
    season: 9999,
    entries: [f.row]
  })
  assert(!JSON.stringify(result).includes(f.secret))
  assert(!JSON.stringify(f.broker.status()).includes(f.secret))
  assert.deepEqual(
    f.state.calls.map((c) => c.url),
    [
      'https://api.tacticusgame.com/api/v1/player',
      'https://api.tacticusgame.com/api/v1/guild',
      'https://api.tacticusgame.com/api/v1/player',
      'https://api.tacticusgame.com/api/v1/guild',
      'https://api.tacticusgame.com/api/v1/guildRaid'
    ]
  )
  for (const { options } of f.state.calls) {
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'error')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.body, undefined)
    assert.deepEqual(Object.keys(options.headers).sort(), [
      'X-API-KEY',
      'accept'
    ])
  }
})
test('expiry and guild mismatch prevent persistence; errors never contain upstream text', async () => {
  for (const patch of [
    { expiry: 1 },
    { guildTag: 'SYN002' },
    { guildId: '../unsafe' }
  ]) {
    const f = fixture()
    Object.assign(f.state, patch)
    await assert.rejects(f.broker.connect(f.secret), denied)
    assert.equal(f.state.saves, 0)
  }
  const f = fixture()
  f.state.respond = async () => {
    throw new Error(f.secret)
  }
  await assert.rejects(f.broker.connect(f.secret), denied)
})
test('account switching and expired established keys revoke access before another request', async () => {
  for (const change of [
    (f) => {
      f.state.grant.installation = randomUUID()
    },
    (f) => {
      f.state.now = f.state.expiry * 1000
    }
  ]) {
    const f = fixture()
    await f.broker.connect(f.secret)
    change(f)
    assert.deepEqual(f.broker.status(), { connected: false })
    await assert.rejects(f.broker.currentRaids(), denied)
    assert.equal(f.state.calls.length, 2)
    assert.equal(f.state.records.size, 0)
  }
})
test('upstream key rejection or a reused guild tag for another guild revokes the established binding', async () => {
  for (const change of [
    (f) => {
      f.state.respond = async () => new Response('', { status: 403 })
    },
    (f) => {
      f.state.guildId = randomUUID()
    }
  ]) {
    const f = fixture()
    await f.broker.connect(f.secret)
    change(f)
    await assert.rejects(f.broker.currentRaids(), denied)
    assert.equal(f.state.records.size, 0)
    assert.deepEqual(f.broker.status(), { connected: false })
  }
})
test('disconnect cancels an in-flight request and prevents a late response crossing its generation', async () => {
  const f = fixture()
  await f.broker.connect(f.secret)
  let ready, finish
  const started = new Promise((resolve) => {
    ready = resolve
  })
  f.state.respond = async (_url, options, response) => {
    ready(options.signal)
    return new Promise((resolve) => {
      finish = () => resolve(Response.json(response))
    })
  }
  const pending = f.broker.currentRaids()
  const signal = await started
  await f.broker.disconnect()
  assert.equal(signal.aborted, true)
  finish()
  await assert.rejects(pending, denied)
  assert.equal(f.state.calls.length, 3)
  assert.equal(f.state.records.size, 0)
  assert.deepEqual(f.broker.status(), { connected: false })
})
test('withdrawal during connection prevents saving even when the upstream request ignores cancellation', async () => {
  const f = fixture()
  f.state.respond = async (_url, _options, response) => {
    f.state.grant = null
    return Response.json(response)
  }
  await assert.rejects(f.broker.connect(f.secret), denied)
  assert.equal(f.state.saves, 0)
  assert.equal(f.state.calls.length, 1)
})
test('malformed later entries, secret echoes, wrong media types and excessive streams never return raid data', async () => {
  const mutations = [
    (f) => {
      f.state.raid.entries.push({ ...f.row, damageDealt: -1 })
    },
    (f) => {
      f.state.raid.entries[0].username = f.secret
    },
    (f) => {
      f.state.raid.entries[0].username = Buffer.from(f.secret).toString(
        'base64'
      )
    },
    (f) => {
      f.state.respond = async () =>
        new Response('{}', { headers: { 'content-type': 'text/html' } })
    },
    (f) => {
      f.state.respond = async () =>
        new Response('{}', { headers: { 'content-type': 'application/jsonp' } })
    },
    (f) => {
      f.state.respond = async () =>
        new Response(new Uint8Array(4 * 1024 * 1024 + 1), {
          headers: { 'content-type': 'application/json' }
        })
    }
  ]
  for (const mutate of mutations) {
    const f = fixture()
    await f.broker.connect(f.secret)
    mutate(f)
    await assert.rejects(f.broker.currentRaids(), denied)
  }
})
test('arbitrary operation arguments are refused before credential access', async () => {
  const f = fixture()
  await f.broker.connect(f.secret)
  await assert.rejects(f.broker.connect(randomUUID()), denied)
  await assert.rejects(
    f.broker.currentRaids({
      url: 'https://foreign.invalid',
      headers: { authorization: 'arbitrary' }
    }),
    denied
  )
  assert.equal(f.state.calls.length, 2)
  assert.equal(f.state.reads, 0)
})
test('overlapping operations cannot read or exchange credentials', async () => {
  const f = fixture()
  await f.broker.connect(f.secret)
  let ready, finish
  const started = new Promise((resolve) => {
    ready = resolve
  })
  f.state.respond = async (_url, _options, response) => {
    ready()
    return new Promise((resolve) => {
      finish = () => resolve(Response.json(response))
    })
  }
  const pending = f.broker.currentRaids()
  await started
  await assert.rejects(f.broker.currentRaids(), denied)
  await assert.rejects(f.broker.connect(randomUUID()), denied)
  assert.equal(f.state.reads, 1)
  assert.equal(f.state.calls.length, 3)
  const release = finish
  f.state.respond = undefined
  release()
  await pending
})

test('normal close retains ciphertext, resume requires fresh matching consent and revalidates upstream binding', async () => {
  const f = fixture()
  await f.broker.connect(f.secret)
  const record = f.broker.savedConnection()
  assert.equal(JSON.stringify(record).includes(f.secret), false)
  f.broker.close()
  assert.deepEqual(f.broker.status(), { connected: false })
  assert.equal(f.state.records.size, 1)
  f.state.grant = null
  await assert.rejects(f.broker.resume(record), denied)
  assert.equal(f.state.reads, 0)
  f.state.grant = {
    operation: 'official-guild-raids',
    installation: randomUUID(),
    guildCode: 'SYN001'
  }
  await assert.rejects(f.broker.resume(record), denied)
  assert.equal(f.state.reads, 0)
  f.state.grant.installation = record.installation
  assert.equal((await f.broker.resume(record)).connected, true)
  assert.equal(f.state.saves, 1)
  assert.equal(f.state.reads, 1)
  assert.equal(f.state.calls.length, 4)
  await f.broker.disconnect()
  assert.equal(f.state.records.size, 0)
})
test('saved records cannot introduce a raw credential, arbitrary handle or changed guild', async () => {
  const f = fixture()
  await f.broker.connect(f.secret)
  const record = f.broker.savedConnection()
  f.broker.close()
  for (const patch of [
    { secret: f.secret },
    { handle: '../unsafe' },
    { guildCode: 'SYN002' },
    { expiresAt: NaN }
  ])
    await assert.rejects(f.broker.resume({ ...record, ...patch }), denied)
  assert.equal(f.state.reads, 0)
  assert.equal(f.state.calls.length, 2)
})

test('an empty valid current season returns no file and cannot invent a raid entry', async () => {
  const f = fixture()
  await f.broker.connect(f.secret)
  f.state.raid.entries = []
  assert.deepEqual(await f.broker.currentRaids(), {
    contents: null,
    season: 9999
  })
  assert.equal(f.broker.status().connected, true)
})
