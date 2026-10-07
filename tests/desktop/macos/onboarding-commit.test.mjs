import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceOnboardingV1 } from '../../../packages/workspace-onboarding/v1.mjs'
import { privateState } from '../../../apps/desktop/platform/macos/state.mjs'

function fixture(failure) {
  let state = {},
    readFails = false
  const removed = []
  const onboarding = new WorkspaceOnboardingV1({
    now: () => 1767225600000,
    state: {
      read: () => {
        if (readFails) throw new Error('State unavailable')
        return structuredClone(state)
      },
      write: (value) => {
        if (failure === 'before-commit') throw new Error('Write refused')
        state = structuredClone(value)
        if (failure === 'uncertain-commit') readFails = true
        throw new Error('Post-commit metadata unavailable')
      }
    },
    vault: {
      promptAndStoreOfficialRead: async () => 'synthetic-opaque-handle',
      withOfficialRead: async (_handle, action) =>
        action('SYNTHETIC-KEY-CANARY'),
      remove: async (handle) => {
        removed.push(handle)
      }
    },
    upstream: {
      get: async () => ({
        metaData: { scopes: ['Player'], lastUpdatedOn: 1767225600 },
        player: {
          details: { name: 'Synthetic Player', powerLevel: 10 },
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
            resetStones: 0
          },
          progress: { campaigns: [], legendaryEvents: [] }
        }
      })
    }
  })
  return { onboarding, removed, state: () => state }
}

test('post-commit and uncertain state failures preserve the new referenced vault handle', async () => {
  for (const kind of ['after-commit', 'uncertain-commit']) {
    const f = fixture(kind)
    await assert.rejects(
      f.onboarding.connect({
        requested: ['Player'],
        confirmPlayer: async () => true
      }),
      /could not finish/
    )
    assert.deepEqual(f.removed, [])
    assert.equal(f.state().vaultReferences.Player, 'synthetic-opaque-handle')
    assert.equal(
      JSON.stringify(f.state()).includes('SYNTHETIC-KEY-CANARY'),
      false
    )
  }
})

test('proved pre-commit refusal still removes only the newly unreferenced handle', async () => {
  const f = fixture('before-commit')
  await assert.rejects(
    f.onboarding.connect({
      requested: ['Player'],
      confirmPlayer: async () => true
    }),
    /could not finish/
  )
  assert.deepEqual(f.state(), {})
  assert.deepEqual(f.removed, ['synthetic-opaque-handle'])
})

test('directory fsync failure after rename leaves readers aligned with the actual replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'synthetic commit ü '))
  const original = fs.fsyncSync
  try {
    const path = join(directory, 'personal.json'),
      state = privateState(path)
    state.write({ vaultReferences: { Player: 'synthetic-old-handle' } })
    let calls = 0
    fs.fsyncSync = (descriptor) => {
      if (++calls === 2)
        throw Object.assign(
          new Error('Synthetic directory durability failure'),
          { code: 'EIO' }
        )
      return original(descriptor)
    }
    syncBuiltinESMExports()
    const next = { vaultReferences: { Player: 'synthetic-new-handle' } }
    assert.throws(
      () => state.write(next),
      (error) => error.code === 'EIO'
    )
    assert.deepEqual(state.read(), next)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), next)
  } finally {
    fs.fsyncSync = original
    syncBuiltinESMExports()
    await rm(directory, { recursive: true, force: true })
  }
})
