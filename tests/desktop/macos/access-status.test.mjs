import test from 'node:test'
import assert from 'node:assert/strict'
import { projectCachedPlayer } from '../../../packages/workspace-onboarding/v1.mjs'
import { accessStatus } from '../../../apps/desktop/platform/macos/access-status.mjs'

function personal(progress = {}) {
  return projectCachedPlayer({
    player: {
      details: { name: 'Synthetic Access Player', powerLevel: 10 },
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
      progress: { campaigns: [], legendaryEvents: [], ...progress }
    },
    updatedOn: 1767225600
  })
}

test('a holding workspace without Player access is not ready', () => {
  assert.deepEqual(
    accessStatus({
      status: 'player-required',
      capabilities: {},
      personal: null
    }),
    {
      demo: false,
      playerReady: false,
      guildReady: false,
      tokens: null,
      bombs: null,
      updatedAt: null
    }
  )
})

test('cached Player data unlocks personal pages with its saved counts', () => {
  const status = accessStatus({
    status: 'active',
    capabilities: { Player: 'verified-scope' },
    personal: personal({
      guildRaid: {
        tokens: { current: 2, max: 3, regenDelayInSeconds: 0 },
        bombTokens: { current: 1, max: 2, regenDelayInSeconds: 0 }
      }
    })
  })
  assert.equal(status.playerReady, true)
  assert.equal(status.guildReady, false)
  assert.equal(status.tokens, 2)
  assert.equal(status.bombs, 1)
  assert.equal(status.updatedAt, '2026-01-01T00:00:00.000Z')
})

test('guild pages need both verified Guild scopes, never one alone', () => {
  const cached = personal()
  for (const [capabilities, ready] of [
    [{ Guild: 'verified-scope' }, false],
    [
      { Guild: 'verified-scope', 'Guild Raid': 'guild-binding-unavailable' },
      false
    ],
    [{ Guild: 'verified-scope', 'Guild Raid': 'verified-scope' }, true]
  ])
    assert.equal(
      accessStatus({ status: 'active', capabilities, personal: cached })
        .guildReady,
      ready
    )
  assert.equal(
    accessStatus({
      status: 'player-required',
      capabilities: { Guild: 'verified-scope', 'Guild Raid': 'verified-scope' },
      personal: null
    }).guildReady,
    false
  )
})

test('only synthetic qualification is reported as the sample workspace', () => {
  const view = { status: 'player-required', capabilities: {}, personal: null }
  assert.equal(accessStatus(view).demo, false)
  assert.equal(accessStatus(view, { synthetic: true }).demo, true)
})
