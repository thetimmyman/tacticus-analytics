import test from 'node:test'
import assert from 'node:assert/strict'
import {
  syntheticSnapshotDigest,
  syntheticWorkspaceDigest
} from '../../../apps/desktop/platform/macos/device-proof.mjs'

const database = () => ({
  subject: 'synthetic-owner',
  rows: [{ id: 1, damage: 1200, tokens: 2, observed_at: 'synthetic-time' }],
  mapping: [
    {
      id: 1,
      user_id: 'synthetic-owner',
      guild_code: 'SYN001',
      last_active_at: 'earlier',
      updated_at: 'earlier'
    }
  ],
  guilds: [
    { id: 1, guild_code: 'SYN001', sync_tier: 'active', updated_at: 'earlier' }
  ],
  attestations: [
    {
      id: 'synthetic-attestation',
      subject_user_id: 'synthetic-owner',
      revoked_at: null
    }
  ]
})
const personal = { version: 1, personal: { resources: { current: 4 } } }

test('restart digest permits the ordinary view heartbeat without mutating its input', () => {
  const original = database(),
    heartbeat = structuredClone(original)
  heartbeat.mapping[0].last_active_at = 'later'
  heartbeat.mapping[0].updated_at = 'later'
  heartbeat.guilds[0].updated_at = 'later'
  assert.equal(
    syntheticSnapshotDigest(original, personal),
    syntheticSnapshotDigest(heartbeat, personal)
  )
  assert.equal(original.mapping[0].last_active_at, 'earlier')
  assert.equal(heartbeat.mapping[0].last_active_at, 'later')
})

test('restart digest still detects business, membership, ownership and attestation changes', () => {
  const baseline = syntheticSnapshotDigest(database(), personal)
  for (const mutate of [
    (value) => {
      value.rows[0].damage++
    },
    (value) => {
      value.rows[0].observed_at = 'changed'
    },
    (value) => {
      value.mapping[0].user_id = 'other-synthetic-owner'
    },
    (value) => {
      value.mapping[0].guild_code = 'SYN002'
    },
    (value) => {
      value.guilds[0].sync_tier = 'inactive'
    },
    (value) => {
      value.attestations[0].revoked_at = 'changed'
    },
    (value) => {
      value.subject = 'other-synthetic-owner'
    }
  ]) {
    const changed = database()
    mutate(changed)
    assert.notEqual(syntheticSnapshotDigest(changed, personal), baseline)
  }
  const changedPersonal = structuredClone(personal)
  changedPersonal.personal.resources.current++
  assert.notEqual(
    syntheticSnapshotDigest(database(), changedPersonal),
    baseline
  )
})

test('installed workspace measurement hashes the actual database and complete personal state', async () => {
  const value = database()
  const services = { psql: async () => JSON.stringify(value) }
  assert.equal(
    await syntheticWorkspaceDigest(services, {
      state: { read: () => personal }
    }),
    syntheticSnapshotDigest(value, personal)
  )
})
