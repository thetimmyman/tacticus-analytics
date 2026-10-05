import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  symlink
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inventory } from '../../../apps/desktop/platform/windows/stage.mjs'
import { windowsOnboarding } from '../../../apps/desktop/platform/windows/onboarding.mjs'

const player = {
  player: {
    details: { name: 'Synthetic Player', powerLevel: 12 },
    units: [{ id: 'synthetic-unit', rank: 2 }]
  },
  metaData: { scopes: ['Player'], lastUpdatedOn: 1000 }
}
async function workspace(run) {
  const root = await mkdtemp(join(tmpdir(), 'Windows adapter ü '))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
test('actual shared guard receives opaque native references and Player-only access activates', () =>
  workspace(async (root) => {
    const operations = []
    const handle = 'a'.repeat(32)
    const guard = windowsOnboarding(root, async (args) => {
      operations.push(args)
      if (args[0] === 'prompt-official') return { handle }
      if (args[0] === 'read-official' && args[2] === 'Player')
        return structuredClone(player)
      throw new Error('Optional access absent')
    })
    const view = await guard.connect({ confirmPlayer: async () => true })
    assert.equal(view.status, 'active')
    assert.equal(view.personal.roster[0].id, 'synthetic-unit')
    assert.equal(view.capabilities['Guild Raid'], 'guild-binding-unavailable')
    assert.ok(
      operations.every(
        (args) => !args.includes('synthetic-secret-never-in-node')
      )
    )
    assert.ok(!JSON.stringify(view).includes(handle))
    assert.ok(!JSON.stringify(view).includes('vaultReferences'))
    const reopened = windowsOnboarding(root, () => {
      throw new Error('Offline')
    })
    assert.equal(reopened.view().personal.displayName, 'Synthetic Player')
    assert.equal(reopened.view().freshness.offlineReadable, true)
    assert.deepEqual((await reopened.skipOptional()).personal, view.personal)
  }))
test('no Player and native vault failure cannot activate a new personal workspace', () =>
  workspace(async (root) => {
    const removed = []
    const guard = windowsOnboarding(root, async (args) => {
      if (args[0] === 'prompt-official') return { handle: 'b'.repeat(32) }
      if (args[0] === 'remove-official') {
        removed.push(args[1])
        return null
      }
      throw new Error('Unavailable')
    })
    const view = await guard.connect({ confirmPlayer: async () => true })
    assert.equal(view.status, 'player-required')
    assert.equal(view.personal, null)
    assert.equal(removed.length, 1)
    await assert.rejects(guard.skipOptional(), /Player access/)
    const failed = windowsOnboarding(root, () => {
      throw new Error('Vault locked')
    })
    await assert.rejects(failed.connect({}), /Secure onboarding/)
    assert.equal(failed.view().personal, null)
  }))
test('combined scopes use one native prompt, then wrong guild refuses raid binding', () =>
  workspace(async (root) => {
    let prompts = 0,
      raidReads = 0
    const guard = windowsOnboarding(root, async (args) => {
      if (args[0] === 'prompt-official') {
        prompts++
        return { handle: 'c'.repeat(32) }
      }
      if (args[2] === 'Player')
        return {
          ...player,
          metaData: {
            ...player.metaData,
            scopes: ['Player', 'Guild', 'Guild Raid']
          }
        }
      if (args[2] === 'Guild') return { guild: { guildId: 'synthetic-guild' } }
      if (args[2] === 'Guild Raid') {
        raidReads++
        return { season: 1 }
      }
      return null
    })
    const view = await guard.connect({
      expectedGuildId: 'other-synthetic-guild',
      confirmPlayer: async () => true
    })
    assert.equal(prompts, 1)
    assert.equal(raidReads, 0)
    assert.equal(view.capabilities.Guild, 'wrong-guild')
    assert.equal(view.capabilities['Guild Raid'], 'guild-binding-unavailable')
  }))
test('replacement failure retains synced data and disconnect revokes only unused reference', () =>
  workspace(async (root) => {
    let fail = false,
      prompt = 0
    const removed = []
    const guard = windowsOnboarding(root, async (args) => {
      if (args[0] === 'prompt-official')
        return { handle: (++prompt).toString().padStart(32, '0') }
      if (args[0] === 'remove-official') {
        removed.push(args[1])
        return null
      }
      if (args[2] === 'Player' && !fail) return player
      throw new Error('Revoked')
    })
    await guard.connect({ confirmPlayer: async () => true })
    fail = true
    const view = await guard.connect({ confirmPlayer: async () => true })
    assert.equal(
      view.capabilities.Player,
      'refresh-unavailable-offline-readable'
    )
    assert.equal(view.personal.displayName, 'Synthetic Player')
    const disconnected = await guard.disconnect('Player')
    assert.equal(
      disconnected.capabilities.Player,
      'disconnected-offline-readable'
    )
    assert.equal(removed.length, 2)
    const stored = await readFile(
      join(root, 'official-onboarding.json'),
      'utf8'
    )
    assert.ok(!stored.includes('apiKey'))
  }))
test('inventory hashes real bytes and rejects mutable state and reparse package entries', () =>
  workspace(async (root) => {
    await mkdir(join(root, 'spaces ü'))
    await writeFile(join(root, 'spaces ü', 'item.txt'), 'synthetic')
    const files = await inventory(root)
    assert.equal(files.length, 1)
    assert.equal(files[0].size, 9)
    assert.match(files[0].sha256, /^[a-f0-9]{64}$/)
    await writeFile(join(root, '.env.local'), 'synthetic')
    await assert.rejects(inventory(root), /Mutable/)
    await rm(join(root, '.env.local'))
    await symlink(
      join(root, 'spaces ü'),
      join(root, 'link'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    await assert.rejects(inventory(root), /links unsupported/)
  }))
