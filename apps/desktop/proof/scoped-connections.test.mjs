import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { mkdtemp, rm, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  scopedConnectionRecord,
  loadScopedConnections,
  saveScopedConnections
} from '../launcher/scoped-connections.mjs'
const fixture = () => ({
  format: 'ta-scoped-official-access-v1',
  installation: randomUUID(),
  guildCode: 'SYN01',
  roles: {
    Player: {
      handle: randomBytes(16).toString('hex'),
      verifiedAt: Date.now(),
      expiresAt: null
    }
  }
})
test('private scope handles persist without secret values; unknown fields refuse', async () => {
  const state = await mkdtemp(join(tmpdir(), 'desktop-scope-'))
  try {
    assert.equal(await loadScopedConnections(state), null)
    const value = fixture()
    await saveScopedConnections(state, value)
    assert.deepEqual(await loadScopedConnections(state), value)
    assert.throws(() => scopedConnectionRecord({ ...value, key: randomUUID() }))
    assert.throws(() =>
      scopedConnectionRecord({
        ...value,
        roles: { Guild: { ...value.roles.Player } }
      })
    )
    const secret = randomUUID()
    const altered = {
      ...value,
      roles: { Player: { ...value.roles.Player, secret } }
    }
    await assert.rejects(saveScopedConnections(state, altered))
    assert(
      !(
        await readFile(join(state, 'scoped-official-access.json'), 'utf8')
      ).includes(secret)
    )
  } finally {
    await rm(state, { recursive: true, force: true })
  }
})
test('linked metadata cannot replace an unrelated file', async () => {
  const state = await mkdtemp(join(tmpdir(), 'desktop-scope-')),
    target = await mkdtemp(join(tmpdir(), 'desktop-scope-target-'))
  try {
    await symlink(
      join(target, 'private.json'),
      join(state, 'scoped-official-access.json')
    )
    await assert.rejects(saveScopedConnections(state, fixture()))
  } finally {
    await rm(state, { recursive: true, force: true })
    await rm(target, { recursive: true, force: true })
  }
})
