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
import {
  personalImport,
  cachedPersonal
} from '../../../apps/desktop/platform/windows/import.mjs'
import { projectCachedPlayer } from '../../../packages/workspace-onboarding/v1.mjs'

const player = {
  player: {
    details: { name: 'Synthetic Player', powerLevel: 12 },
    units: [
      {
        id: 'synthetic-unit',
        rank: 2,
        xp: 0,
        xpLevel: 1,
        progressionIndex: 0,
        abilities: [],
        items: [],
        upgrades: [],
        shards: 0,
        mythicShards: 0
      }
    ],
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
      resetStones: 0
    },
    progress: {
      campaigns: [],
      legendaryEvents: [],
      guildRaid: {
        tokens: { current: 2, max: 3, regenDelayInSeconds: 0 },
        bombTokens: { current: 1, max: 2, regenDelayInSeconds: 0 }
      }
    }
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
      if (args[0] === 'prompt-official') return { handle: args[1] ?? handle }
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
    assert.ok(
      !JSON.stringify(view).includes(
        operations.find((args) => args[0] === 'prompt-official')[1]
      )
    )
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
      if (args[0] === 'prompt-official')
        return { handle: args[1] ?? 'b'.repeat(32) }
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
        return { handle: args[1] ?? 'c'.repeat(32) }
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
        return { season: 1, seasonConfigId: 'SyntheticSeason', entries: [] }
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
        return { handle: args[1] ?? (++prompt).toString().padStart(32, '0') }
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
test('expired or locked Player refresh preserves both actionable capability status and cached data', () =>
  workspace(async (root) => {
    let code
    const guard = windowsOnboarding(root, async (args) => {
      if (args[0] === 'prompt-official') return { handle: args[1] }
      if (args[0] === 'remove-official') return null
      if (code) throw Object.assign(new Error('Safe native status'), { code })
      return player
    })
    await guard.connect({
      requested: ['Player'],
      confirmPlayer: async () => true
    })
    const retained = guard.view().personal
    const reuseHandle = guard.state.read().vaultReferences.Player
    for (const [failure, status] of [
      ['EEXPIRED', 'expired-offline-readable'],
      ['EVAULTLOCKED', 'vault-locked-offline-readable']
    ]) {
      code = failure
      const view = await guard.connect({ requested: ['Player'], reuseHandle })
      assert.equal(view.capabilities.Player, status)
      assert.deepEqual(view.personal, retained)
      assert.equal(view.freshness.offlineReadable, true)
    }
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

test('authenticated journal recovery deletes only unused targets and preserves a committed reference after interrupted journal cleanup', () =>
  workspace(async (root) => {
    const removed = []
    const command = async (args) => {
      if (args[0] === 'prompt-official') return { handle: args[1] }
      if (args[0] === 'read-official' && args[2] === 'Player') return player
      if (args[0] === 'remove-official') {
        removed.push(args[1])
        return null
      }
      throw new Error('Optional scope unavailable')
    }
    const first = windowsOnboarding(root, command)
    await first.connect({
      requested: ['Player'],
      confirmPlayer: async () => true
    })
    const committed = first.state.read().vaultReferences.Player
    const unused = 'f'.repeat(32)
    await writeFile(
      join(root, 'official-pending.json'),
      JSON.stringify([committed, unused])
    )
    let authorized = false
    const reopened = windowsOnboarding(root, command, () => {
      if (!authorized)
        throw Object.assign(new Error('Unlock local workspace'), {
          code: 'ESESSION'
        })
    })
    await assert.rejects(
      reopened.recoverPending(),
      (error) => error.code === 'ESESSION'
    )
    assert.equal(removed.length, 0)
    authorized = true
    await reopened.recoverPending()
    assert.deepEqual(removed, [unused])
    assert.equal(reopened.state.read().vaultReferences.Player, committed)
    assert.deepEqual(
      JSON.parse(await readFile(join(root, 'official-pending.json'), 'utf8')),
      []
    )
    assert.ok(!JSON.stringify(reopened.view()).includes(committed))
  }))

test('native historical import retains its choice through one unlock without opening first and cannot create live capabilities', () =>
  workspace(async (root) => {
    let authorized = true,
      choices = 0,
      reads = 0
    const assertCurrent = () => {
      if (!authorized)
        throw Object.assign(new Error('Unlock required'), { code: 'ESESSION' })
    }
    const personal = projectCachedPlayer({
      player: player.player,
      updatedOn: player.metaData.lastUpdatedOn
    })
    const onboarding = windowsOnboarding(root, () => {}, assertCurrent)
    const operation = personalImport({
      gate: { assertCurrent, expiresAt: () => 1234567890000 },
      onboarding,
      native: async (args) => {
        if (args[0] === 'choose-import') {
          choices++
          authorized = false
          return { source: 'C:\\synthetic choice\\personal ü.json' }
        }
        reads++
        assert.deepEqual(args, [
          'read-import',
          'C:\\synthetic choice\\personal ü.json',
          '1234567890000'
        ])
        return {
          personal,
          freshness: {
            syncedAt: personal.upstreamUpdatedAt,
            offlineReadable: true
          },
          capabilities: { Player: 'active', Guild: 'active' }
        }
      }
    })
    await assert.rejects(operation(), { code: 'ESESSION' })
    assert.equal(reads, 0)
    authorized = true
    const imported = await operation()
    assert.equal(choices, 1)
    assert.equal(reads, 1)
    assert.equal(imported.status, 'historical-offline')
    assert.deepEqual(imported.capabilities, { Player: 'reconnect-required' })
    assert.deepEqual(imported.personal, personal)
    assert.ok(!JSON.stringify(imported).includes('synthetic choice'))
    await assert.rejects(operation(), /empty personal workspace/)
    assert.equal(choices, 1)
  }))

test('cached historical import revalidates the entire Player snapshot and timestamp rather than trusting claimed summary fields', () => {
  const personal = projectCachedPlayer({
    player: player.player,
    updatedOn: player.metaData.lastUpdatedOn
  })
  const input = {
    personal,
    freshness: { syncedAt: personal.upstreamUpdatedAt, offlineReadable: true }
  }
  assert.deepEqual(cachedPersonal(input), personal)
  for (const mutate of [
    (value) => {
      value.personal.roster[0].rank = 999
    },
    (value) => {
      delete value.personal.apiData.inventory
    },
    (value) => {
      value.personal.apiData.password = 'synthetic'
    },
    (value) => {
      value.freshness.syncedAt++
    },
    (value) => {
      value.personal.upstreamUpdatedAt = Number.MAX_SAFE_INTEGER
    }
  ]) {
    const changed = structuredClone(input)
    mutate(changed)
    assert.throws(() => cachedPersonal(changed))
  }
})

test('expiry during native import prevents every state write and a retained vault reference refuses the chooser', async () => {
  let authorized = true,
    writes = 0,
    choices = 0
  const original = {}
  const assertCurrent = () => {
    if (!authorized)
      throw Object.assign(new Error('Unlock required'), { code: 'ESESSION' })
  }
  const operation = personalImport({
    gate: { assertCurrent, expiresAt: () => 1234567890000 },
    onboarding: {
      state: { read: () => original },
      migrateHistorical: () => {
        writes++
        return {}
      }
    },
    native: async (args) => {
      if (args[0] === 'choose-import') {
        choices++
        return { source: 'C:\\synthetic.json' }
      }
      authorized = false
      return {}
    }
  })
  await assert.rejects(operation(), { code: 'ESESSION' })
  assert.equal(writes, 0)
  authorized = true
  original.vaultReferences = { Player: 'synthetic-opaque-reference' }
  await assert.rejects(operation(), /empty personal workspace/)
  assert.equal(choices, 1)
  assert.equal(writes, 0)
})
