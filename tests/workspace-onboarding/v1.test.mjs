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
