import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { defaultConsent } from '../../packages/contribution/contract.mjs'
import { ContributionQueue } from '../../packages/contribution/queue.mjs'
import { VerificationService } from '../../packages/contribution/verification.mjs'
import { ProtectedReadVault } from '../../packages/contribution/protected-read-vault.mjs'
import { OfficialGuildRaidSource } from '../../packages/contribution/official-upstream.mjs'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const row = {
  userId: id(2),
  tier: 1,
  set: 0,
  encounterIndex: 0,
  damageDealt: 100,
  damageType: 'Battle',
  startedOn: '1767225600',
  completedOn: '1767225610',
  unitId: 'SyntheticBoss'
}
const canary = 'synthetic-official-read-canary'

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'contribution-fixture-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  let time = Date.parse('2026-01-01T00:01:00.000Z'),
    guildId = id(1),
    calls = 0,
    failure,
    wait
  let members = [{ userId: row.userId }],
    entries = [structuredClone(row)]
  const now = () => time
  const upstream = {
    fetchGuildRaid: async (credential, season) => {
      calls++
      assert.equal(credential, canary)
      if (wait) await wait
      if (failure) throw failure
      return {
        guild: { guildId, members: structuredClone(members) },
        raid: { season, entries: structuredClone(entries) },
        fetchedAt: new Date(time).toISOString()
      }
    }
  }
  const vault = new ProtectedReadVault({
    path: join(directory, 'protected.json'),
    encryptionKey: randomBytes(32),
    upstream,
    now
  })
  const service = new VerificationService({
    path: join(directory, 'sources.json'),
    upstream,
    credentialStore: vault,
    attributionKey: randomBytes(32),
    now,
    minimumGuilds: 3
  })
  const principal = { id: id(3), authenticated: true }
  const enroll = async (account = id(4), owner = principal) =>
    service.enroll(owner, {
      separateConsent: true,
      credentialType: 'official-read',
      accountRef: account,
      season: 1,
      readOfficialCredential: async () => Buffer.from(canary)
    })
  const binding = await enroll()
  const policy = {
    ...defaultConsent({
      accountRef: id(4),
      guildId,
      now: '2026-01-01T00:00:00.000Z'
    }),
    revision: 1,
    enabled: true,
    datasets: { raid: true, war: false, replay: false }
  }
  service.setPolicy(principal, binding.bindingId, policy)
  const upload = () => ({
    version: 1,
    requestId: randomUUID(),
    bindingId: binding.bindingId,
    consentRevision: 1,
    purpose: 'meta',
    dataset: 'raid',
    guildId,
    season: 1,
    observedAt: new Date(time).toISOString(),
    rows: [structuredClone(row)]
  })
  const queue = new ContributionQueue({
    path: join(directory, 'queue.json'),
    now
  })
  queue.setPolicy(policy)
  return {
    directory,
    principal,
    binding,
    policy,
    service,
    vault,
    queue,
    upload,
    enroll,
    now,
    advance: (ms) => {
      time += ms
    },
    setGuild: (value) => {
      guildId = value
    },
    setMembers: (value) => {
      members = value
    },
    setEntries: (value) => {
      entries = value
    },
    setFailure: (value) => {
      failure = value
    },
    setWait: (value) => {
      wait = value
    },
    calls: () => calls
  }
}

test('independent comparison rejects alteration, forged member and wrong guild', async (t) => {
  const f = await fixture(t)
  let input = f.upload()
  input.rows[0].damageDealt++
  assert.equal(
    (await f.service.verify(f.principal, input)).results[0].status,
    'mismatch'
  )
  input = f.upload()
  input.rows[0].userId = id(9)
  assert.equal(
    (await f.service.verify(f.principal, input)).results[0].status,
    'mismatch'
  )
  input = f.upload()
  input.guildId = id(9)
  await assert.rejects(f.service.verify(f.principal, input), /not authorized/)
  assert.equal(Object.keys(f.service.store.value.records).length, 0)
  f.setMembers([])
  assert.equal(
    (await f.service.verify(f.principal, f.upload())).results[0].status,
    'mismatch'
  )
})
test('duplicate collectors and corrected revisions converge, source deletion recomputes', async (t) => {
  const f = await fixture(t),
    input = f.upload()
  assert.equal(
    (await f.service.verify(f.principal, input)).results[0].status,
    'verified'
  )
  assert.deepEqual(
    await f.service.verify(f.principal, input),
    await f.service.verify(f.principal, input)
  )
  const altered = structuredClone(input)
  altered.rows[0].damageDealt++
  await assert.rejects(
    f.service.verify(f.principal, altered),
    /identity reused/
  )
  const second = await f.enroll(id(5))
  f.service.setPolicy(f.principal, second.bindingId, {
    ...f.policy,
    accountRef: id(5)
  })
  assert.equal(
    (
      await f.service.verify(f.principal, {
        ...f.upload(),
        bindingId: second.bindingId
      })
    ).results[0].status,
    'duplicate'
  )
  assert.equal(Object.keys(f.service.store.value.records).length, 1)
  f.setEntries([{ ...row, damageDealt: 150 }])
  assert.equal(
    (await f.service.verify(f.principal, f.upload())).results[0].status,
    'mismatch'
  )
  const corrected = f.upload()
  corrected.rows[0].damageDealt = 150
  assert.equal(
    (await f.service.verify(f.principal, corrected)).results[0].status,
    'verified'
  )
  assert.equal(Object.keys(f.service.store.value.records).length, 1)
  f.service.deleteContributions(f.principal, f.binding.bindingId)
  assert.equal(Object.keys(f.service.store.value.records).length, 1)
  f.service.deleteContributions(f.principal, second.bindingId)
  assert.equal(Object.keys(f.service.store.value.records).length, 0)
  assert.deepEqual(f.service.aggregate(), { status: 'insufficient-cohort' })
})
test('queue persists offline, retries outage, bounds history and accepts partial receipts', async (t) => {
  const f = await fixture(t),
    input = f.upload()
  f.queue.enqueue(id(4), input)
  const reopened = new ContributionQueue({
    path: join(f.directory, 'queue.json'),
    now: f.now
  })
  assert.equal(reopened.inspect().pending.length, 1)
  f.setFailure(new Error('fixture outage'))
  await reopened.drain((upload) => f.service.verify(f.principal, upload))
  assert.equal(reopened.inspect().pending.length, 1)
  f.setFailure(null)
  f.advance(5000)
  await reopened.drain((upload) => f.service.verify(f.principal, upload))
  assert.equal(reopened.inspect().pending.length, 0)
  assert.equal(reopened.inspect().receipts.at(-1).results[0].status, 'verified')
  const historical = f.upload()
  historical.observedAt = '2025-12-01T00:00:00.000Z'
  assert.throws(() => reopened.enqueue(id(4), historical), /consent/)
  const multi = f.upload()
  multi.rows.push({ ...row, damageDealt: 999 })
  reopened.enqueue(id(4), multi)
  await reopened.drain(async (value) => ({
    version: 1,
    requestId: value.requestId,
    consentRevision: value.consentRevision,
    checkedAt: new Date(f.now()).toISOString(),
    source: 'official-guild-raid',
    results: [
      { index: 0, status: 'duplicate', authorityDigest: 'a'.repeat(64) }
    ]
  }))
  assert.equal(reopened.inspect().pending[0].rows, 1)
})
test('revocation clears unsent work, aborts in-flight requests and records completed bytes', async (t) => {
  const f = await fixture(t)
  f.queue.enqueue(id(4), f.upload())
  let finish, entered
  const arrived = new Promise((resolve) => {
    entered = resolve
  })
  const sending = f.queue.drain(async (upload, { signal }) => {
    entered(signal)
    return new Promise((resolve) => {
      finish = () =>
        resolve({
          version: 1,
          requestId: upload.requestId,
          consentRevision: 1,
          checkedAt: new Date(f.now()).toISOString(),
          source: 'official-guild-raid',
          results: [
            { index: 0, status: 'verified', authorityDigest: 'a'.repeat(64) }
          ]
        })
    })
  })
  const signal = await arrived
  f.queue.setPolicy({ ...f.policy, revision: 2, enabled: false })
  assert.equal(signal.aborted, true)
  finish()
  await sending
  assert.equal(f.queue.inspect().pending.length, 0)
  assert.equal(
    f.queue.inspect().receipts.at(-1).delivery,
    'sent-before-revocation'
  )
  let sends = 0
  await f.queue.drain(async () => {
    sends++
  })
  assert.equal(sends, 0)
})
test('server rechecks consent after upstream awaits; revoked key is deleted', async (t) => {
  const f = await fixture(t)
  let resume
  f.setWait(
    new Promise((resolve) => {
      resume = resolve
    })
  )
  const action = f.service.verify(f.principal, f.upload())
  await new Promise((resolve) => setImmediate(resolve))
  f.service.setPolicy(f.principal, f.binding.bindingId, {
    ...f.policy,
    revision: 2,
    enabled: false
  })
  resume()
  await assert.rejects(action, /revoked/)
  assert.equal(Object.keys(f.service.store.value.records).length, 0)
  f.service.setPolicy(f.principal, f.binding.bindingId, {
    ...f.policy,
    revision: 3
  })
  f.setFailure(
    Object.assign(new Error('fixture revoked'), { code: 'FORBIDDEN' })
  )
  const input = f.upload()
  input.consentRevision = 3
  assert.equal(
    (await f.service.verify(f.principal, input)).results[0].status,
    'expired'
  )
  assert.equal(Object.keys(f.vault.store.value.bindings).length, 0)
})
test('wrong binding, expired key, ambiguous upstream and unverifiable datasets never verify', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    f.service.verify({ id: id(9), authenticated: true }, f.upload()),
    /unavailable/
  )
  f.setEntries([row, row])
  assert.equal(
    (await f.service.verify(f.principal, f.upload())).results[0].status,
    'pending'
  )
  for (const dataset of ['war', 'replay']) {
    const policy = {
      ...f.policy,
      revision: dataset === 'war' ? 2 : 3,
      datasets: { raid: true, war: true, replay: true }
    }
    f.service.setPolicy(f.principal, f.binding.bindingId, policy)
    const input = {
      ...f.upload(),
      consentRevision: policy.revision,
      dataset,
      rows: [{ formatVersion: 1, outcome: 'win' }]
    }
    assert.equal(
      (await f.service.verify(f.principal, input)).results[0].status,
      'unverifiable'
    )
  }
  f.advance(86400001)
  await assert.rejects(f.service.verify(f.principal, f.upload()), /unavailable/)
  assert.equal(Object.keys(f.vault.store.value.bindings).length, 0)
})
test('only explicit official-read enrollment can persist encrypted material; no forbidden surface contains canary', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    f.service.enroll(f.principal, {
      separateConsent: false,
      credentialType: 'official-read'
    })
  )
  await assert.rejects(
    f.service.enroll(f.principal, {
      separateConsent: true,
      credentialType: 'game-session'
    })
  )
  f.queue.enqueue(id(4), f.upload())
  await f.queue.drain((upload) => f.service.verify(f.principal, upload))
  for (const file of ['protected.json', 'sources.json', 'queue.json']) {
    const body = readFileSync(join(f.directory, file), 'utf8')
    for (const forbidden of [
      canary,
      Buffer.from(canary).toString('base64'),
      Buffer.from(canary).toString('hex')
    ])
      assert.equal(body.includes(forbidden), false)
  }
  assert.equal(
    JSON.stringify(f.service.aggregate()).includes(row.userId),
    false
  )
  await f.service.revoke(f.principal, f.binding.bindingId)
  assert.equal(Object.keys(f.vault.store.value.bindings).length, 0)
  f.service.deleteContributions(f.principal, f.binding.bindingId)
  assert.equal(Object.keys(f.service.store.value.records).length, 0)
})
test('purpose and dataset combinations remain independent and queue is bounded', async (t) => {
  const f = await fixture(t)
  for (let mask = 0; mask < 8; mask++) {
    const policy = {
      ...f.policy,
      revision: mask + 2,
      datasets: { raid: !!(mask & 1), war: !!(mask & 2), replay: !!(mask & 4) }
    }
    f.queue.setPolicy(policy)
    for (const dataset of ['raid', 'war', 'replay']) {
      const input = {
        ...f.upload(),
        consentRevision: policy.revision,
        dataset,
        rows:
          dataset === 'raid'
            ? [row]
            : [{ formatVersion: 1, outcome: 'unknown' }]
      }
      if (policy.datasets[dataset]) f.queue.enqueue(id(4), input)
      else assert.throws(() => f.queue.enqueue(id(4), input), /consent/)
      assert.throws(
        () => f.queue.enqueue(id(4), { ...input, purpose: 'portal' }),
        /consent/
      )
    }
  }
  const bounded = new ContributionQueue({
    path: join(f.directory, 'bounded.json'),
    now: f.now,
    maxJobs: 1
  })
  bounded.setPolicy(f.policy)
  bounded.enqueue(id(4), f.upload())
  assert.throws(() => bounded.enqueue(id(4), f.upload()), /full/)
})
test('official adapter fixes destinations, rejects redirects, and classifies revoked access', async () => {
  const calls = []
  const source = new OfficialGuildRaidSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return new Response(
        JSON.stringify(
          url.endsWith('/guild')
            ? { guild: { guildId: id(1), members: [] } }
            : { season: 1, entries: [] }
        )
      )
    }
  })
  await source.fetchGuildRaid(canary, 1)
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      'https://api.tacticusgame.com/api/v1/guild',
      'https://api.tacticusgame.com/api/v1/guildRaid/1'
    ]
  )
  assert.equal(
    calls.every((call) => call.options.redirect === 'error'),
    true
  )
  const denied = new OfficialGuildRaidSource({
    fetchImpl: async () => new Response('', { status: 403 })
  })
  await assert.rejects(
    denied.fetchGuildRaid(canary, 1),
    (error) => error.code === 'FORBIDDEN' && !error.message.includes(canary)
  )
  await assert.rejects(source.fetchGuildRaid(canary, -1))
})

test('privacy threshold, retention and per-principal limits are enforced', async (t) => {
  const f = await fixture(t)
  await f.service.verify(f.principal, f.upload())
  assert.equal(f.service.aggregate().status, 'insufficient-cohort')
  for (const number of [6, 7]) {
    f.setGuild(id(number))
    const binding = await f.enroll(id(number + 10))
    f.service.setPolicy(f.principal, binding.bindingId, {
      ...f.policy,
      guildId: id(number),
      accountRef: id(number + 10)
    })
    await f.service.verify(f.principal, {
      ...f.upload(),
      bindingId: binding.bindingId
    })
  }
  assert.equal(f.service.aggregate().samples, 3)
  assert.equal(f.service.aggregate().totalDamage, 300)
  f.service.deleteContributions(f.principal, f.binding.bindingId)
  assert.equal(f.service.aggregate().status, 'insufficient-cohort')
  f.setGuild(id(1))
  for (let index = 0; index < 17; index++)
    await f.service.verify(f.principal, f.upload())
  await assert.rejects(f.service.verify(f.principal, f.upload()), /rate limit/)
  f.advance(30 * 86400000)
  f.service.purgeRetention()
  assert.equal(Object.keys(f.service.store.value.records).length, 0)
  assert.equal(Object.keys(f.service.store.value.requests).length, 0)
})
