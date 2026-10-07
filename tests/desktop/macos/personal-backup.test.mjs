import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  WorkspaceOnboardingV1,
  projectCachedPlayer
} from '../../../packages/workspace-onboarding/v1.mjs'
import {
  cachedPersonal,
  importCachedPersonal,
  PERSONAL_EXPORT_VERSION
} from '../../../apps/desktop/platform/macos/personal-backup.mjs'

export function syntheticExport() {
  const personal = projectCachedPlayer({
    player: {
      details: { name: 'Synthetic Offline Player', powerLevel: 10 },
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
      progress: {
        campaigns: [],
        legendaryEvents: [],
        guildRaid: {
          tokens: { current: 2, max: 3, regenDelayInSeconds: 0 },
          bombTokens: { current: 1, max: 2, regenDelayInSeconds: 0 }
        }
      }
    },
    updatedOn: 1767225600
  })
  return {
    schemaVersion: PERSONAL_EXPORT_VERSION,
    personal,
    freshness: { syncedAt: personal.upstreamUpdatedAt, offlineReadable: true }
  }
}

function fixture() {
  let data = {}
  const onboarding = new WorkspaceOnboardingV1({
    state: {
      read: () => structuredClone(data),
      write: (value) => {
        data = structuredClone(value)
      }
    },
    vault: {},
    upstream: {}
  })
  return { onboarding, state: () => data }
}

test('native cached import restores complete projected data with reconnect required and preserves source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cached Player ü '))
  try {
    const path = join(directory, 'personal.json'),
      input = syntheticExport(),
      bytes = JSON.stringify(input)
    await writeFile(path, bytes)
    const f = fixture()
    const view = await importCachedPersonal({
      path,
      onboarding: f.onboarding,
      authorize: () => {}
    })
    assert.deepEqual(view.personal, input.personal)
    assert.equal(view.status, 'historical-offline')
    assert.deepEqual(view.capabilities, { Player: 'reconnect-required' })
    assert.equal(f.state().vaultReferences, undefined)
    assert.equal(view.cloudContribution, 'separate-consent-required')
    assert.equal(await readFile(path, 'utf8'), bytes)
    await assert.rejects(
      importCachedPersonal({
        path,
        onboarding: f.onboarding,
        authorize: () => {}
      }),
      /empty/
    )
    assert.deepEqual(f.state().personal, input.personal)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('cached import rejects nested credentials, forged projections and incomplete API snapshots', () => {
  const secret = syntheticExport()
  secret.personal.apiData.inventory.apiKey = 'SYNTHETIC-CANARY-ONLY'
  assert.throws(() => cachedPersonal(secret), /Credentials/)
  const forged = syntheticExport()
  forged.personal.resources.bombTokens.current = 999
  assert.throws(() => cachedPersonal(forged), /differs/)
  const partial = syntheticExport()
  delete partial.personal.apiData.inventory
  assert.throws(() => cachedPersonal(partial))
})

test('cached file import refuses symlinks, oversized input and session expiry after opening without writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cached refusal '))
  try {
    const path = join(directory, 'original.json'),
      link = join(directory, 'link.json')
    await writeFile(path, JSON.stringify(syntheticExport()))
    await symlink(path, link)
    const f = fixture()
    await assert.rejects(
      importCachedPersonal({
        path: link,
        onboarding: f.onboarding,
        authorize: () => {}
      })
    )
    const large = join(directory, 'large.json')
    await writeFile(large, Buffer.alloc(4 * 1024 * 1024 + 1))
    await assert.rejects(
      importCachedPersonal({
        path: large,
        onboarding: f.onboarding,
        authorize: () => {}
      }),
      /Unsupported/
    )
    let calls = 0
    await assert.rejects(
      importCachedPersonal({
        path,
        onboarding: f.onboarding,
        authorize: () => {
          if (++calls === 2)
            throw Object.assign(new Error('Unlock required'), {
              code: 'ESESSION'
            })
        }
      }),
      (error) => error.code === 'ESESSION'
    )
    assert.deepEqual(f.state(), {})
    assert.ok(JSON.parse(await readFile(path, 'utf8')).personal)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
