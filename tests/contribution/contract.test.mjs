import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allowed,
  defaultConsent,
  envelope,
  receipt,
  RAID_FIELDS
} from '../../packages/contribution/contract.mjs'

const id = '00000000-0000-4000-8000-000000000001'
const now = '2026-01-01T00:00:00.000Z'
const upload = {
  version: 1,
  requestId: id,
  bindingId: id,
  consentRevision: 0,
  purpose: 'meta',
  dataset: 'raid',
  guildId: id,
  season: 1,
  observedAt: now,
  rows: [
    {
      userId: id,
      tier: 1,
      set: 0,
      encounterIndex: 0,
      damageDealt: 10,
      damageType: 'Battle',
      startedOn: '1767225600',
      completedOn: '1767225601',
      unitId: 'SyntheticBoss'
    }
  ]
}

test('consent defaults off independently for every purpose and dataset', () => {
  for (const purpose of ['portal', 'meta']) {
    const value = defaultConsent({ accountRef: id, guildId: id, purpose, now })
    assert.equal(value.enabled, false)
    assert.deepEqual(value.datasets, { raid: false, war: false, replay: false })
  }
})
test('upload rejects nested unknown fields and encoded credentials', () => {
  assert.deepEqual(envelope(upload), upload)
  for (const extra of [
    { apiKey: 'synthetic-canary' },
    { headers: { authorization: 'c3ludGhldGlj' } }
  ]) {
    const input = structuredClone(upload)
    Object.assign(input.rows[0], extra)
    assert.throws(() => envelope(input), /Invalid contribution contract/)
  }
  assert.throws(() => envelope({ ...upload, signature: 'client-truth-claim' }))
})
test('contribution payload rejects unknown fields at any depth', () => {
  assert.deepEqual(envelope(upload), upload)
  for (const field of [
    'signature',
    'metadata',
    'extra',
    'debug',
    'note',
    'trace',
    'nonce',
    'ref'
  ]) {
    const input = structuredClone(upload)
    input[field] = 'synthetic-value'
    assert.throws(() => envelope(input), /Invalid contribution contract/)
  }
  for (const field of [
    'rank',
    'guild',
    'note',
    'meta',
    'source',
    'log',
    'tag',
    'label'
  ]) {
    const input = structuredClone(upload)
    input.rows[0][field] = 'synthetic-value'
    assert.throws(() => envelope(input), /Invalid contribution contract/)
  }
})
test('contribution payload rejects secret-bearing fields at any depth', () => {
  for (const field of [
    'token',
    'password',
    'secret',
    'privateKey',
    'passphrase',
    'apiSecret',
    'encryptionKey'
  ]) {
    const atTop = structuredClone(upload)
    atTop[field] = 'synthetic-secret'
    assert.throws(() => envelope(atTop), /Invalid contribution contract/)
    const atRow = structuredClone(upload)
    atRow.rows[0][field] = 'synthetic-secret'
    assert.throws(() => envelope(atRow), /Invalid contribution contract/)
  }
})
test('contribution payload rejects credential fields at any depth', () => {
  for (const field of [
    'credential',
    'credentials',
    'authToken',
    'accessToken',
    'refreshToken',
    'bearerToken',
    'clientId',
    'clientSecret'
  ]) {
    const atTop = structuredClone(upload)
    atTop[field] = 'synthetic-credential'
    assert.throws(() => envelope(atTop), /Invalid contribution contract/)
    const atRow = structuredClone(upload)
    atRow.rows[0][field] = 'synthetic-credential'
    assert.throws(() => envelope(atRow), /Invalid contribution contract/)
  }
})
test('contribution payload rejects raw request header fields at any depth', () => {
  for (const field of [
    'authorization',
    'cookie',
    'x-api-key',
    'set-cookie',
    'user-agent',
    'accept',
    'content-type',
    'x-forwarded-for',
    'referer'
  ]) {
    const atTop = structuredClone(upload)
    atTop[field] = 'synthetic-header'
    assert.throws(() => envelope(atTop), /Invalid contribution contract/)
    const atRow = structuredClone(upload)
    atRow.rows[0][field] = 'synthetic-header'
    assert.throws(() => envelope(atRow), /Invalid contribution contract/)
  }
  for (const field of ['headers', 'requestHeaders', 'responseHeaders']) {
    const atTop = structuredClone(upload)
    atTop[field] = { authorization: 'synthetic', cookie: 'synthetic' }
    assert.throws(() => envelope(atTop), /Invalid contribution contract/)
    const atRow = structuredClone(upload)
    atRow.rows[0][field] = { authorization: 'synthetic', cookie: 'synthetic' }
    assert.throws(() => envelope(atRow), /Invalid contribution contract/)
  }
})
test('accepted payload contains only allowlisted fields', () => {
  const accepted = envelope(upload)
  assert.deepEqual(
    Object.keys(accepted).sort(),
    [
      'version',
      'requestId',
      'bindingId',
      'consentRevision',
      'purpose',
      'dataset',
      'guildId',
      'season',
      'observedAt',
      'rows'
    ].sort()
  )
  assert.equal(accepted.rows.length, 1)
  for (const row of accepted.rows) {
    assert.deepEqual(Object.keys(row).sort(), [...RAID_FIELDS].sort())
  }
})
test('verified receipt needs an independent authority digest', () => {
  assert.throws(() =>
    receipt({
      version: 1,
      requestId: id,
      consentRevision: 0,
      checkedAt: now,
      source: 'official-guild-raid',
      results: [{ index: 0, status: 'verified', authorityDigest: null }]
    })
  )
})
test('official numeric timestamps normalize to the canonical whole-second form', () => {
  const input = structuredClone(upload)
  input.rows[0].startedOn = 1767225600
  input.rows[0].completedOn = 1767225601000
  const [row] = envelope(input).rows
  assert.equal(row.startedOn, '1767225600')
  assert.equal(row.completedOn, '1767225601')
})
test('policy expiry is enforced against the current time, not only observation time', () => {
  const policy = {
    ...defaultConsent({ accountRef: id, guildId: id, now }),
    revision: 1,
    enabled: true,
    datasets: { raid: true, war: false, replay: false },
    until: '2026-01-01T00:10:00.000Z'
  }
  const sent = {
    purpose: 'meta',
    guildId: id,
    consentRevision: 1,
    dataset: 'raid',
    observedAt: '2026-01-01T00:09:00.000Z'
  }
  assert.equal(
    allowed(policy, sent, Date.parse('2026-01-01T00:09:30.000Z')),
    true
  )
  assert.equal(
    allowed(policy, sent, Date.parse('2026-01-01T00:11:00.000Z')),
    false
  )
})
