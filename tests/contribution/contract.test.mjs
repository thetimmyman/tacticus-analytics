import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allowed,
  defaultConsent,
  envelope,
  receipt
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
