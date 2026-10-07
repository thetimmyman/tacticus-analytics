import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectCachedPlayer } from '../../../packages/workspace-onboarding/v1.mjs'
import { createPersonalStore } from '../../../apps/desktop/platform/macos/personal-store.mjs'
import { createPersonalController } from '../../../apps/desktop/platform/macos/personal-controller.mjs'
import { PERSONAL_EXPORT_VERSION } from '../../../apps/desktop/platform/macos/personal-backup.mjs'

const handle = '00000000-0000-4000-8000-000000000011'
function player() {
  return {
    details: { name: 'Synthetic Retained Player', powerLevel: 10 },
    units: [],
    inventory: {
      items: [],
      upgrades: [],
      shards: [],
      mythicShards: [],
      xpBooks: [],
      abilityBadges: {},
      components: [],
      forgeBadges: [],
      orbs: {},
      resetStones: 1
    },
    progress: { campaigns: [], legendaryEvents: [] }
  }
}
function exported() {
  const personal = projectCachedPlayer({
    player: player(),
    updatedOn: 1767225600
  })
  return {
    schemaVersion: PERSONAL_EXPORT_VERSION,
    personal,
    freshness: { syncedAt: personal.upstreamUpdatedAt, offlineReadable: true }
  }
}
async function fixture(t, assertOwner = () => {}) {
  const directory = await mkdtemp(
    join(tmpdir(), 'synthetic personal controller ü ')
  )
  t.after(() => rm(directory, { recursive: true, force: true }))
  const primary = join(directory, 'personal.json')
  const calls = []
  const vault = {
    async recover(refs) {
      calls.push(['recover', refs])
    },
    commit(refs) {
      calls.push(['commit', refs])
    },
    async remove(ref) {
      calls.push(['remove', ref])
    },
    async promptAndStoreOfficialRead() {
      calls.push(['prompt'])
      return handle
    },
    async withOfficialRead(_ref, action) {
      return action('SYNTHETIC-KEY-CANARY')
    },
    async confirmPlayer() {
      return true
    }
  }
  const upstream = {
    async get(scope) {
      if (scope !== 'Player') throw new Error('Optional access unavailable')
      return {
        metaData: { scopes: ['Player'], lastUpdatedOn: 1767225600 },
        player: player()
      }
    }
  }
  const create = () =>
    createPersonalController({
      store: createPersonalStore(directory),
      vault,
      upstream,
      assertOwner
    })
  return { directory, primary, calls, vault, create }
}

test('damaged cache exposes a fixed holding view and cannot prompt, recover or remove credentials', async (t) => {
  const f = await fixture(t)
  const original = '{"vaultReferences":{"Player":"SYNTHETIC-PRIVATE-CANARY"'
  await writeFile(f.primary, original, { mode: 0o600 })
  const controller = f.create()
  const view = await controller.run({ operation: 'session', scope: 'Player' })
  assert.equal(view.status, 'recovery-required')
  assert.equal(view.recovery.cleanupPaused, true)
  assert.equal(view.personal, null)
  assert.equal(JSON.stringify(view).includes('CANARY'), false)
  await assert.rejects(
    controller.run({ operation: 'connect', scope: 'Player' }),
    (error) => error.code === 'ERECOVERY'
  )
  await assert.rejects(
    controller.run({ operation: 'disconnect', scope: 'Player' }),
    (error) => error.code === 'ERECOVERY'
  )
  assert.deepEqual(f.calls, [])
  assert.equal(await readFile(f.primary, 'utf8'), original)
})

test('native selected-export restore preserves the original and grants only disconnected history across restart', async (t) => {
  const f = await fixture(t)
  const original = '{"vaultReferences":'
  await writeFile(f.primary, original, { mode: 0o600 })
  const source = join(f.directory, 'selected-export.json'),
    input = exported(),
    bytes = JSON.stringify(input)
  await writeFile(source, bytes, { mode: 0o600 })
  const controller = f.create()
  const view = await controller.run({
    operation: 'recover-personal',
    scope: 'Player',
    path: source
  })
  assert.equal(view.status, 'historical-offline')
  assert.deepEqual(view.personal, input.personal)
  assert.deepEqual(view.capabilities, {
    Player: 'reconnect-required',
    Guild: 'reconnect-required',
    'Guild Raid': 'reconnect-required'
  })
  assert.equal(view.cloudContribution, 'separate-consent-required')
  assert.equal(view.recovery.cleanupPaused, true)
  assert.deepEqual(f.calls, [])
  assert.equal(await readFile(source, 'utf8'), bytes)
  const incidents = (await readdir(f.directory)).filter((name) =>
    name.startsWith('personal-incident.')
  )
  assert.equal(incidents.length, 1)
  assert.equal(
    await readFile(join(f.directory, incidents[0]), 'utf8'),
    original
  )
  const reopened = f.create()
  const reopenedView = await reopened.run({
    operation: 'session',
    scope: 'Player'
  })
  assert.deepEqual(reopenedView.personal, input.personal)
  assert.equal(reopenedView.recovery.cleanupPaused, true)
  assert.deepEqual(f.calls, [])
  await reopened.run({ operation: 'disconnect', scope: 'Player' })
  assert.deepEqual(f.calls, [])
})

test('expiry during selected file reading leaves damaged data and all recovery metadata untouched', async (t) => {
  let assertions = 0
  const f = await fixture(t, () => {
    if (++assertions === 3)
      throw Object.assign(new Error('Synthetic expiry'), { code: 'ESESSION' })
  })
  await writeFile(f.primary, '{damaged', { mode: 0o600 })
  const source = join(f.directory, 'selected-export.json')
  await writeFile(source, JSON.stringify(exported()), { mode: 0o600 })
  const before = (await readdir(f.directory)).sort()
  const controller = f.create()
  await assert.rejects(
    controller.run({
      operation: 'recover-personal',
      scope: 'Player',
      path: source
    }),
    (error) => error.code === 'ESESSION'
  )
  assert.deepEqual((await readdir(f.directory)).sort(), before)
  assert.equal(await readFile(f.primary, 'utf8'), '{damaged')
  assert.deepEqual(f.calls, [])
})

test('postcommit pending-vault failure preserves the new active handle and an unchanged empty workspace can reopen', async (t) => {
  const f = await fixture(t)
  await f.create().run({ operation: 'session', scope: 'Player' })
  assert.deepEqual(createPersonalStore(f.directory).read(), {})
  assert.deepEqual(await readdir(f.directory), [])
  f.calls.length = 0
  f.vault.commit = (refs) => {
    f.calls.push(['commit', refs])
    throw new Error('Synthetic pending metadata failure')
  }
  const controller = f.create()
  const view = await controller.run({ operation: 'connect', scope: 'Player' })
  assert.equal(view.capabilities.Player, 'verified-scope')
  assert.equal(
    createPersonalStore(f.directory).read().vaultReferences.Player,
    handle
  )
  assert.equal(
    f.calls.some(([operation]) => operation === 'remove'),
    false
  )
  assert.equal(JSON.stringify(view).includes('SYNTHETIC-KEY-CANARY'), false)
  assert.equal(JSON.stringify(view).includes(handle), false)
})

test('corruption discovered on a later authorized action blocks connection before shared onboarding becomes busy', async (t) => {
  const f = await fixture(t),
    controller = f.create()
  await writeFile(f.primary, '{damaged', { mode: 0o600 })
  await assert.rejects(
    controller.run({ operation: 'connect', scope: 'Player' }),
    (error) => error.code === 'ERECOVERY'
  )
  assert.equal(controller.onboarding.busy, false)
  assert.equal(f.calls.length, 0)
})

test('disconnecting the only scope removes its Keychain item and forgets the handle', async (t) => {
  const f = await fixture(t)
  const controller = f.create()
  await controller.run({ operation: 'connect', scope: 'Player' })
  f.calls.length = 0
  const view = await controller.run({
    operation: 'disconnect',
    scope: 'Player'
  })
  assert.deepEqual(
    f.calls.filter(([operation]) => operation === 'remove'),
    [['remove', handle]]
  )
  const saved = createPersonalStore(f.directory).read()
  assert.equal(saved.vaultReferences?.Player, undefined)
  assert.equal(saved.pendingVaultRemovals, undefined)
  assert.equal(JSON.stringify(view).includes(handle), false)
})

test('a locked Keychain keeps the removal queued across restart until it succeeds', async (t) => {
  const f = await fixture(t)
  await f.create().run({ operation: 'connect', scope: 'Player' })
  f.vault.remove = async (ref) => {
    f.calls.push(['remove-locked', ref])
    throw Object.assign(new Error('Synthetic lock'), { code: 'EVAULTLOCKED' })
  }
  await f
    .create()
    .run({ operation: 'disconnect', scope: 'Player' })
    .catch(() => {})
  assert.deepEqual(
    createPersonalStore(f.directory).read().pendingVaultRemovals,
    [handle]
  )
  f.calls.length = 0
  f.vault.remove = async (ref) => {
    f.calls.push(['remove', ref])
  }
  await f.create().run({ operation: 'disconnect', scope: 'Player' })
  assert.deepEqual(
    f.calls.filter(([op]) => op === 'remove'),
    [['remove', handle]]
  )
  assert.equal(
    createPersonalStore(f.directory).read().pendingVaultRemovals,
    undefined
  )
})
