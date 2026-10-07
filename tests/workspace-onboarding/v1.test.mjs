import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WorkspaceOnboardingV1,
  projectCachedPlayer
} from '../../packages/workspace-onboarding/v1.mjs'

function syntheticPlayer(units = []) {
  return {
    details: { name: 'Synthetic Player', powerLevel: 10 },
    units,
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
  }
}

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
          player:
            mode === 'missing-inventory'
              ? {
                  details: { name: 'Synthetic Player', powerLevel: 10 },
                  units: []
                }
              : syntheticPlayer([
                  {
                    id: 'SyntheticUnit',
                    rank: 1,
                    xp: 0,
                    xpLevel: 1,
                    progressionIndex: 0,
                    abilities: [],
                    items: [],
                    upgrades: [],
                    shards: 0,
                    mythicShards: 0,
                    apiKey: canary
                  }
                ]),
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
      return mode === 'malformed-raid'
        ? { season: 1 }
        : { season: 1, seasonConfigId: 'SyntheticSeason', entries: [] }
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

test('offline projection validates the entire cached schema without granting capabilities', () => {
  const personal = projectCachedPlayer({
    player: syntheticPlayer(),
    updatedOn: 1767225600
  })
  assert.equal(personal.apiData.inventory.resetStones, 1)
  assert.equal(personal.capabilities, undefined)
  assert.equal(personal.upstreamUpdatedAt, 1767225600000)
  assert.throws(() =>
    projectCachedPlayer({
      player: { details: { name: 'Synthetic Player' }, units: [] },
      updatedOn: 1767225600
    })
  )
  assert.throws(() =>
    projectCachedPlayer({
      player: syntheticPlayer(),
      updatedOn: Number.MAX_SAFE_INTEGER
    })
  )
})

test('native setup errors retain only an allowlisted category and never native error text', async () => {
  const service = new WorkspaceOnboardingV1({
    vault: {
      promptAndStoreOfficialRead: async () => {
        throw Object.assign(
          new Error('Synthetic raw diagnostic must not escape'),
          { code: 'EVAULTLOCKED' }
        )
      }
    },
    state: { read: () => ({}), write: () => assert.fail('Must not write') },
    upstream: { get: () => assert.fail('Must not read') }
  })
  await assert.rejects(
    service.connect({ requested: ['Player'], confirmPlayer }),
    (error) =>
      error.code === 'EVAULTLOCKED' && !error.message.includes('raw diagnostic')
  )
})

test('complete allowed Player inventory/progress is projected while unknown credential fields are excluded', async () => {
  const f = fixture()
  const view = await f.service.connect({ requested: ['Player'], confirmPlayer })
  assert.equal(view.personal.apiData.inventory.resetStones, 1)
  assert.equal(view.personal.apiData.units[0].xp, 0)
  assert.equal(view.personal.apiData.units[0].apiKey, undefined)
  assert.equal(JSON.stringify(view).includes(f.canary), false)
  const invalid = fixture()
  invalid.mode('missing-inventory')
  assert.equal(
    (await invalid.service.connect({ requested: ['Player'], confirmPlayer }))
      .status,
    'player-required'
  )
})

test('a successful malformed Raid payload cannot claim a verified scope', async () => {
  const f = fixture(['Player', 'Guild', 'Guild Raid'])
  f.mode('malformed-raid')
  const view = await f.service.connect({ requested: ['Player'], confirmPlayer })
  assert.equal(view.capabilities.Guild, 'verified-scope')
  assert.equal(view.capabilities['Guild Raid'], 'unavailable')
  assert.equal(f.stored().raid, undefined)
})

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

test('expiry on refresh retains its distinct status and the original offline personal snapshot', async () => {
  const f = fixture()
  await f.service.connect({ requested: ['Player'], confirmPlayer })
  const original = f.service.view().personal
  f.mode('expired')
  const view = await f.service.connect({
    requested: ['Player'],
    reuseHandle: 'opaque-vault-reference',
    confirmPlayer
  })
  assert.equal(view.capabilities.Player, 'expired-offline-readable')
  assert.deepEqual(view.personal, original)
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
            player: syntheticPlayer(),
            metaData: {
              scopes: combined ? ['Player', 'Guild', 'Guild Raid'] : ['Player'],
              lastUpdatedOn: 1767225600
            }
          }
        if (scope === 'Guild') return { guild: { guildId } }
        return { season: 1, seasonConfigId: 'SyntheticSeason', entries: [] }
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

test('declined Player confirmation stops optional scope discovery and drops the credential', async () => {
  const { service, stored, revoked } = fixture([
    'Player',
    'Guild',
    'Guild Raid'
  ])
  await service.connect({ confirmPlayer: async () => false })
  assert.equal(stored().vaultReferences?.Guild, undefined)
  assert.equal(stored().guildId, undefined)
  assert.equal(stored().personal, undefined)
  assert.deepEqual(revoked(), ['opaque-vault-reference'])
})
test('historical imports reject credential aliases', () => {
  const { service } = fixture()
  for (const key of [
    'accessToken',
    'refreshToken',
    'password',
    'bearerToken',
    'x-api-key'
  ])
    assert.throws(
      () => service.migrateHistorical({ personal: { [key]: 'synthetic' } }),
      /secure native migration/
    )
})
test('a failed vault removal keeps a pending cleanup handle that a later disconnect retries', async () => {
  const f = fixture()
  await f.service.connect({ confirmPlayer })
  const original = f.service.vault.remove
  f.service.vault.remove = async () => {
    throw new Error('synthetic vault locked')
  }
  await assert.rejects(f.service.disconnect('Player'))
  assert.deepEqual(f.stored().pendingVaultRemovals, ['opaque-vault-reference'])
  f.service.vault.remove = original
  await f.service.disconnect('Player')
  assert.equal(f.stored().pendingVaultRemovals, undefined)
  assert.deepEqual(f.revoked(), ['opaque-vault-reference'])
})

test('historical game resource counts remain importable without accepting credential aliases', () => {
  for (const value of [null, { current: 2, max: 3, nextTokenInSeconds: 0 }]) {
    const { service } = fixture()
    service.migrateHistorical({
      personal: { resources: { guildRaidTokens: value } }
    })
    assert.deepEqual(service.view().personal.resources.guildRaidTokens, value)
  }
  for (const key of [
    'idToken',
    'Id-Token',
    'encryptedIdToken',
    'encryptedidtokenvalue'
  ]) {
    const { service } = fixture()
    assert.throws(
      () =>
        service.migrateHistorical({
          personal: { resources: { [key]: 'synthetic' } }
        }),
      /secure native migration/
    )
  }
  for (const value of [
    'synthetic',
    { current: 'synthetic' },
    { current: -1 },
    { max: -0 },
    { current: 2, idToken: 'synthetic' }
  ]) {
    const { service } = fixture()
    assert.throws(
      () =>
        service.migrateHistorical({
          personal: { resources: { guildRaidTokens: value } }
        }),
      /secure native migration/
    )
  }
  const { service } = fixture()
  assert.throws(
    () =>
      service.migrateHistorical({
        personal: { guildRaidTokens: { current: 2 } }
      }),
    /secure native migration/
  )
})

test('historical migration stores exactly the profile it validated', () => {
  const { service, stored } = fixture()
  let reads = 0
  const counts = {
    get current() {
      return ++reads === 1 ? 2 : 'SYNTHETIC-SWAPPED-CANARY'
    }
  }
  try {
    service.migrateHistorical({
      personal: { resources: { guildRaidTokens: counts } }
    })
  } catch {}
  assert.equal(JSON.stringify(stored() ?? {}).includes('CANARY'), false)
})
