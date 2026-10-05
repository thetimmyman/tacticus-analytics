import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkspaceOnboardingV1 } from '../../packages/workspace-onboarding/v1.mjs'

function fixture(scopes = ['Player']) {
  let stored = {},
    prompts = 0,
    revoked = [],
    mode = 'ok'
  const canary = 'synthetic-native-official-canary'
  const vault = {
    promptAndStoreOfficialRead: async () => {
      prompts++
      return 'opaque-vault-reference'
    },
    withOfficialRead: async (handle, action) => {
      assert.equal(handle, 'opaque-vault-reference')
      return action(canary)
    },
    remove: async (handle) => {
      revoked.push(handle)
    }
  }
  const upstream = {
    get: async (scope, key) => {
      assert.equal(key, canary)
      if (mode === 'offline' || !scopes.includes(scope))
        throw new Error('synthetic unavailable')
      if (scope === 'Player')
        return {
          player: {
            details: { name: 'Synthetic Player', powerLevel: 10 },
            units: [{ id: 'SyntheticUnit', rank: 1, apiKey: canary }],
            progress: {
              guildRaid: {
                tokens: { current: 2, max: 3 },
                bombTokens: { current: 1, max: 2 }
              }
            }
          },
          metaData: {
            scopes,
            lastUpdatedOn: 1767225600,
            apiKeyExpiresOn: mode === 'expired' ? 1 : 1999999999
          }
        }
      if (scope === 'Guild')
        return {
          guild: {
            guildId:
              mode === 'wrong-guild'
                ? 'synthetic-other-guild'
                : 'synthetic-guild'
          }
        }
      return { season: 1, entries: [] }
    }
  }
  const service = new WorkspaceOnboardingV1({
    vault,
    upstream,
    now: () => 1767225601000,
    state: {
      read: () => structuredClone(stored),
      write: (value) => {
        stored = structuredClone(value)
      }
    }
  })
  return {
    service,
    promptCount: () => prompts,
    stored: () => stored,
    revoked: () => revoked,
    mode: (value) => {
      mode = value
    },
    canary
  }
}
const confirmPlayer = async () => true

test('Player-only setup activates approved roster/resources and optional skip; no key in state/view', async () => {
  const f = fixture(),
    view = await f.service.connect({ requested: ['Player'], confirmPlayer })
  assert.equal(view.status, 'active')
  assert.equal(view.personal.roster[0].rank, 1)
  assert.equal(view.personal.resources.bombTokens.current, 1)
  assert.equal(JSON.stringify(f.stored()).includes(f.canary), false)
  assert.equal(JSON.stringify(view).includes('opaque-vault-reference'), false)
  assert.equal((await f.service.skipOptional()).status, 'active')
})
test('combined metadata scopes reuse one prompt and progressively unlock only actual endpoints', async () => {
  const f = fixture(['Player', 'Guild', 'Guild Raid'])
  const view = await f.service.connect({
    requested: ['Player'],
    confirmPlayer,
    expectedGuildId: 'synthetic-guild'
  })
  assert.equal(f.promptCount(), 1)
  assert.deepEqual(view.capabilities, {
    Player: 'verified-scope',
    Guild: 'verified-scope',
    'Guild Raid': 'verified-scope'
  })
  assert.equal(new Set(Object.values(f.stored().vaultReferences)).size, 1)
})
test('new normal workspace cannot skip Player; offline initial versus reopen preserve data', async () => {
  const f = fixture()
  await assert.rejects(f.service.skipOptional(), /Player/)
  f.mode('offline')
  assert.equal(
    (await f.service.connect({ requested: ['Player'], confirmPlayer })).status,
    'player-required'
  )
  f.mode('ok')
  await f.service.connect({ requested: ['Player'], confirmPlayer })
  const original = f.service.view().personal
  f.mode('offline')
  const reopened = await f.service.connect({
    requested: ['Player'],
    reuseHandle: 'opaque-vault-reference',
    confirmPlayer
  })
  assert.deepEqual(reopened.personal, original)
  assert.equal(
    reopened.capabilities.Player,
    'refresh-unavailable-offline-readable'
  )
})
test('partial failure, wrong guild, expiry and account confirmation cannot activate unavailable features', async () => {
  const f = fixture(['Player', 'Guild', 'Guild Raid'])
  f.mode('wrong-guild')
  const view = await f.service.connect({
    requested: ['Player', 'Guild', 'Guild Raid'],
    confirmPlayer,
    expectedGuildId: 'synthetic-guild'
  })
  assert.equal(view.status, 'active')
  assert.equal(view.capabilities.Guild, 'wrong-guild')
  assert.equal(view.capabilities['Guild Raid'], 'guild-binding-unavailable')
  const expired = fixture()
  expired.mode('expired')
  assert.equal(
    (await expired.service.connect({ requested: ['Player'], confirmPlayer }))
      .status,
    'player-required'
  )
  const mismatch = fixture()
  assert.equal(
    (
      await mismatch.service.connect({
        requested: ['Player'],
        confirmPlayer: async () => false
      })
    ).status,
    'player-required'
  )
})
test('historical migration/disconnection retains offline data; a shared reference is removed only when unused', async () => {
  const f = fixture(['Player', 'Guild', 'Guild Raid'])
  await f.service.connect({ requested: ['Player'], confirmPlayer })
  await f.service.disconnect('Player')
  assert.equal(f.revoked().length, 0)
  await f.service.disconnect('Guild')
  await f.service.disconnect('Guild Raid')
  assert.equal(f.revoked().length, 1)
  assert.ok(f.service.view().personal)
  const historical = fixture()
  historical.service.migrateHistorical({
    personal: { roster: [{ id: 'SyntheticHistorical' }] }
  })
  assert.equal(historical.service.view().status, 'historical-offline')
  assert.equal(historical.service.view().personal.roster.length, 1)
})
test('Raid-only separate key has no independent guild binding and remains explicit', async () => {
  const f = fixture(['Guild Raid'])
  const view = await f.service.connect({ requested: ['Guild Raid'] })
  assert.equal(view.status, 'player-required')
  assert.equal(view.capabilities['Guild Raid'], 'guild-binding-unavailable')
})

test('historical imports reject nested credential fields without writing or deleting original data', () => {
  const f = fixture()
  assert.throws(
    () =>
      f.service.migrateHistorical({
        personal: { roster: [{ apiKey: f.canary }] }
      }),
    /secure native migration/
  )
  assert.deepEqual(f.stored(), {})
})

function replacementFixture() {
  let stored = {},
    next = 'combined',
    guildId = 'SyntheticGuildA'
  const removed = []
  const service = new WorkspaceOnboardingV1({
    now: () => 1767225601000,
    state: {
      read: () => structuredClone(stored),
      write: (value) => {
        stored = structuredClone(value)
      }
    },
    vault: {
      promptAndStoreOfficialRead: async () => next,
      withOfficialRead: async (handle, action) =>
        action(`SyntheticSecret-${handle}`),
      remove: async (handle) => removed.push(handle)
    },
    upstream: {
      get: async (scope, key) => {
        const combined = key === 'SyntheticSecret-combined'
        if (scope === 'Player')
          return {
            player: { details: { name: 'Synthetic Replacement' }, units: [] },
            metaData: {
              scopes: combined ? ['Player', 'Guild', 'Guild Raid'] : ['Player'],
              lastUpdatedOn: 1767225600
            }
          }
        if (scope === 'Guild') return { guild: { guildId } }
        return { season: 1, entries: [] }
      }
    }
  })
  return {
    service,
    stored: () => stored,
    removed,
    next: (value) => {
      next = value
    },
    guild: (value) => {
      guildId = value
    }
  }
}

test('Player reference replacement invalidates optional live access while retaining labeled raid history', async () => {
  const f = replacementFixture()
  await f.service.connect({ requested: ['Player'], confirmPlayer })
  const raid = structuredClone(f.stored().raid)
  f.next('player-only')
  await f.service.connect({ requested: ['Player'], confirmPlayer })
  assert.deepEqual(f.stored().vaultReferences, { Player: 'player-only' })
  assert.equal(
    f.stored().capabilities.Guild,
    'account-changed-offline-readable'
  )
  assert.equal(
    f.stored().capabilities['Guild Raid'],
    'account-changed-offline-readable'
  )
  assert.equal(f.stored().guildId, undefined)
  assert.deepEqual(f.stored().raid, raid)
  assert.equal(raid.guildId, 'SyntheticGuildA')
  assert.deepEqual(f.removed, ['combined'])
})

test('Guild replacement invalidates old Raid binding and disconnect removes each unused separate reference', async () => {
  const f = replacementFixture()
  await f.service.connect({ requested: ['Player'], confirmPlayer })
  f.next('guild-only')
  f.guild('SyntheticGuildB')
  await f.service.connect({ requested: ['Guild'] })
  assert.equal(f.stored().guildId, 'SyntheticGuildB')
  assert.equal(f.stored().vaultReferences['Guild Raid'], undefined)
  assert.equal(
    f.stored().capabilities['Guild Raid'],
    'guild-binding-unavailable'
  )
  assert.equal(f.stored().raid.guildId, 'SyntheticGuildA')
  f.next('raid-and-guild')
  await f.service.connect({ requested: ['Guild Raid'] })
  assert.equal(f.stored().raid.guildId, 'SyntheticGuildB')
  assert.equal(f.stored().vaultReferences.Guild, 'raid-and-guild')
  await f.service.disconnect('Guild')
  assert.equal(f.stored().vaultReferences['Guild Raid'], undefined)
  assert.equal(f.stored().guildId, undefined)
  assert.equal(
    f.stored().capabilities['Guild Raid'],
    'guild-binding-unavailable'
  )
  assert.ok(f.stored().raid)
  assert.ok(f.service.view().personal)
  assert.deepEqual(f.removed, ['guild-only', 'raid-and-guild'])
  await f.service.disconnect('Guild Raid')
  assert.deepEqual(f.removed, ['guild-only', 'raid-and-guild'])
})
