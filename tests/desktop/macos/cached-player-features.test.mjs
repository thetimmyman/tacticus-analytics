import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import {
  inventoryRows,
  mountCachedPlayerFeatures,
  playerSummary
} from '../../../apps/desktop/platform/macos/cached-player-features.mjs'
import {
  projectCachedPlayer,
  WorkspaceOnboardingV1
} from '../../../packages/workspace-onboarding/v1.mjs'
import { privateState } from '../../../apps/desktop/platform/macos/state.mjs'

const page = await readFile(
  new URL(
    '../../../apps/desktop/platform/macos/personal.html',
    import.meta.url
  ),
  'utf8'
)

function fixture(count = 2) {
  return {
    details: { name: 'Synthetic Cached Player', powerLevel: 12 },
    units: Array.from({ length: count }, (_, index) => ({
      id: `synthetic-unit-${String(index).padStart(3, '0')}`,
      name: index === 0 ? 'Synthetic Alpha' : `Synthetic Unit ${index}`,
      faction: index === 0 ? 'Synthetic Faction' : 'Other Synthetic Faction',
      grandAlliance: index % 2 ? 'Xenos' : 'Imperial',
      rank: index % 18,
      xpLevel: (index % 50) + 1,
      xp: index * 10,
      progressionIndex: index % 16,
      shards: index + 1,
      mythicShards: index,
      abilities: [{ id: 'synthetic-ability', level: 7 }],
      items: [
        {
          id: 'synthetic-equipped-item',
          name: 'Synthetic Equipped Item',
          slotId: 'Slot2',
          rarity: 'Rare',
          level: 4
        }
      ],
      upgrades: [1, 0, 2]
    })),
    inventory: {
      items: [
        {
          id: 'synthetic-spare-item',
          name: 'Synthetic Spare',
          level: 3,
          amount: 2
        }
      ],
      upgrades: [
        { id: 'synthetic-upgrade', name: 'Synthetic Upgrade', amount: 5 }
      ],
      shards: [
        { id: 'synthetic-unit-000', name: 'Synthetic Alpha', amount: 9 }
      ],
      mythicShards: [{ id: 'synthetic-unit-000', amount: 3 }],
      xpBooks: [{ id: 'xpRare', rarity: 'Rare', amount: 4 }],
      abilityBadges: {
        Imperial: [{ name: 'Synthetic Badge', rarity: 'Rare', amount: 6 }]
      },
      components: [
        { name: 'Synthetic Component', grandAlliance: 'Imperial', amount: 8 }
      ],
      forgeBadges: [
        { name: 'Synthetic Forge Badge', rarity: 'Epic', amount: 7 }
      ],
      orbs: { Xenos: [{ rarity: 'Uncommon', amount: 11 }] },
      requisitionOrders: { regular: 2, blessed: 1 },
      resetStones: 1
    },
    progress: {
      arena: {
        tokens: {
          current: 5,
          max: 10,
          nextTokenInSeconds: 123,
          regenDelayInSeconds: 60
        }
      },
      guildRaid: {
        tokens: {
          current: 2,
          max: 3,
          nextTokenInSeconds: 75,
          regenDelayInSeconds: 60
        },
        bombTokens: { current: 1, max: 2, regenDelayInSeconds: 60 }
      },
      onslaught: { tokens: { current: 1, max: 3, regenDelayInSeconds: 60 } },
      salvageRun: { tokens: { current: 2, max: 2, regenDelayInSeconds: 60 } },
      campaigns: [
        {
          id: 'synthetic-campaign',
          name: 'Synthetic Campaign',
          type: 'Standard',
          battles: [
            { battleIndex: 0, attemptsLeft: 3, attemptsUsed: 1 },
            { battleIndex: 1, attemptsLeft: 2, attemptsUsed: 2 }
          ]
        }
      ],
      legendaryEvents: [
        {
          id: 'synthetic-legendary-event',
          currentClaimedChestIndex: 2,
          currentPoints: 100,
          currentCurrency: 8,
          currentShards: 4,
          currentEvent: {
            run: 1,
            extraCurrencyPerPayout: 3,
            hasUsedAdForExtraTokenToday: false
          },
          lanes: [
            {
              id: 1,
              name: 'Synthetic Lane',
              battleConfigs: [
                {
                  numEnemies: 3,
                  disallowedFactions: [],
                  objectives: [
                    {
                      objectiveType: 'Synthetic Objective',
                      objectiveTarget: 'Synthetic Target',
                      score: 1
                    }
                  ]
                }
              ],
              progress: [
                { objectivesCleared: [0], encounterPoints: 5, highScore: 5 }
              ]
            }
          ]
        }
      ]
    }
  }
}

function projected(count) {
  return projectCachedPlayer({ player: fixture(count), updatedOn: 1767225600 })
}

function dom() {
  const window = new Window({
    url: 'http://localhost/',
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true
    }
  })
  window.document.write(page)
  return window
}

function event(window, control, kind, value) {
  control.value = value
  control.dispatchEvent(new window.Event(kind))
}

function open(window, detail) {
  detail.open = true
  detail.dispatchEvent(new window.Event('toggle'))
}

function scopedButton(root, label) {
  return [...root.querySelectorAll('button')].find(
    (button) => button.textContent === label
  )
}

test('cached summaries use returned quantities and preserve the full projected snapshot', () => {
  const input = projected(),
    before = JSON.stringify(input),
    summary = playerSummary(input.apiData)
  assert.deepEqual(
    {
      units: summary.units,
      shards: summary.unitShards,
      mythic: summary.unitMythicShards,
      battles: summary.campaignBattles,
      left: summary.campaignAttemptsLeft,
      used: summary.campaignAttemptsUsed
    },
    { units: 2, shards: '3', mythic: '1', battles: 2, left: '5', used: '3' }
  )
  assert.deepEqual(
    summary.inventory.find((entry) => entry.category === 'Requisition orders'),
    { category: 'Requisition orders', amount: '3' }
  )
  assert.equal(
    inventoryRows(input.apiData.inventory).find(
      (row) => row.category === 'Orbs'
    ).group,
    'Xenos'
  )
  assert.equal(JSON.stringify(input), before)
  const large = structuredClone(input.apiData)
  large.inventory.items = [
    { id: 'synthetic-one', level: 1, amount: Number.MAX_SAFE_INTEGER },
    { id: 'synthetic-two', level: 1, amount: Number.MAX_SAFE_INTEGER }
  ]
  assert.equal(
    playerSummary(large).inventory.find((entry) => entry.category === 'Items')
      .amount,
    '18014398509481982'
  )
  assert.equal(playerSummary(null), null)
})

test('roster search, alliance filtering, sorting and paging stay bounded and expose actual unit detail', async () => {
  const window = dom(),
    document = window.document,
    feature = mountCachedPlayerFeatures(document),
    input = projected(60).apiData,
    root = document.querySelector('#roster-feature')
  try {
    feature.update(input)
    assert.equal(root.querySelectorAll('[data-cached-unit]').length, 25)
    assert.equal(root.querySelectorAll('details dl').length, 0)
    scopedButton(root, 'Next').click()
    assert.equal(root.querySelectorAll('[data-cached-unit]').length, 25)
    scopedButton(root, 'Next').click()
    assert.equal(root.querySelectorAll('[data-cached-unit]').length, 10)
    assert.equal(scopedButton(root, 'Next').disabled, true)
    const query = root.querySelector('[aria-label="Search cached units"]')
    event(window, query, 'input', 'Synthetic Alpha')
    assert.equal(root.querySelectorAll('[data-cached-unit]').length, 1)
    const detail = root.querySelector('details')
    open(window, detail)
    assert.match(detail.textContent, /synthetic-abilityLevel7/)
    assert.match(
      detail.textContent,
      /Slot2Item IDsynthetic-equipped-itemNameSynthetic Equipped ItemLevel4RarityRare/
    )
    assert.match(detail.textContent, /Progression index0Shards1Mythic shards0/)
    detail.open = false
    detail.dispatchEvent(new window.Event('toggle'))
    assert.equal(detail.querySelectorAll('dl').length, 0)
    event(window, query, 'input', '')
    event(
      window,
      root.querySelector('[aria-label="Filter units by grand alliance"]'),
      'change',
      'Xenos'
    )
    event(
      window,
      root.querySelector('[aria-label="Sort cached units"]'),
      'change',
      'xpLevel'
    )
    assert.equal(
      root.querySelector('[data-cached-unit] h3').textContent,
      'Synthetic Unit 49'
    )
    assert.match(root.querySelector('[role="status"]').textContent, /of 30/)
    feature.update(input)
    assert.equal(
      root.querySelector('[aria-label="Filter units by grand alliance"]').value,
      'Xenos'
    )
    event(
      window,
      root.querySelector('[aria-label="Search cached units"]'),
      'input',
      'no matching synthetic unit'
    )
    assert.equal(root.querySelectorAll('[data-cached-unit]').length, 0)
    assert.match(root.textContent, /No matching entries/)
  } finally {
    await window.happyDOM.close()
  }
})

test('resource and campaign details expose snapshot values without invented timers, costs or HTML execution', async () => {
  const window = dom(),
    document = window.document,
    feature = mountCachedPlayerFeatures(document),
    input = projected().apiData
  try {
    input.units[0].name = '<img src="https://example.com" onerror="throw 1">'
    input.inventory.items[0].name = '<script>throw 1</script>'
    feature.update(input)
    assert.equal(document.querySelectorAll('img').length, 0)
    assert.equal(
      document.querySelectorAll('#resource-feature script').length,
      0
    )
    assert.match(
      document.querySelector('#resource-feature').textContent,
      /Timers do not count down while offline/
    )
    assert.equal(
      document.querySelector('#resource-feature tbody tr').textContent,
      'Arena51012360'
    )
    const resources = document.querySelector('#resource-feature')
    event(
      window,
      resources.querySelector('[aria-label="Filter inventory category"]'),
      'change',
      'Ability badges'
    )
    assert.equal(resources.querySelectorAll('[data-cached-resource]').length, 1)
    assert.match(
      resources.querySelector('[data-cached-resource]').textContent,
      /Reported amount6/
    )
    assert.match(
      resources.querySelector('[data-cached-resource]').textContent,
      /GroupImperial/
    )
    const campaign = document.querySelector('#progress-feature details')
    open(window, campaign)
    assert.match(
      campaign.textContent,
      /Battle index0Attempts left3Attempts used1/
    )
    assert.match(
      document.querySelector('#progress-feature').textContent,
      /Extra token ad used today at snapshotfalse/
    )
    assert.equal(document.querySelectorAll('input[type="password"]').length, 0)
    assert.equal(document.querySelectorAll('input[type="search"]').length, 2)
    assert.equal(
      document.querySelector('#roster-heading').textContent,
      'Cached roster'
    )
  } finally {
    await window.happyDOM.close()
  }
})

test('large inventory, equipment, abilities and campaign battle lists render bounded pages', async () => {
  const window = dom(),
    document = window.document,
    player = fixture(1)
  try {
    player.inventory.items = Array.from({ length: 80 }, (_, index) => ({
      id: `synthetic-inventory-${index}`,
      level: 1,
      amount: index
    }))
    player.units[0].abilities = Array.from({ length: 70 }, (_, index) => ({
      id: `synthetic-ability-${index}`,
      level: index % 51
    }))
    player.units[0].items = Array.from({ length: 70 }, (_, index) => ({
      id: `synthetic-equipped-${index}`,
      slotId: 'Slot1',
      level: 1
    }))
    player.units[0].upgrades = Array.from({ length: 70 }, (_, index) => index)
    player.progress.campaigns[0].battles = Array.from(
      { length: 75 },
      (_, index) => ({
        battleIndex: index,
        attemptsLeft: 1,
        attemptsUsed: 2
      })
    )
    mountCachedPlayerFeatures(document).update(
      projectCachedPlayer({
        player,
        updatedOn: 1767225600
      }).apiData
    )
    const resources = document.querySelector('#resource-feature')
    event(
      window,
      resources.querySelector('[aria-label="Filter inventory category"]'),
      'change',
      'Items'
    )
    assert.equal(
      resources.querySelectorAll('[data-cached-resource]').length,
      25
    )
    scopedButton(resources, 'Next').click()
    assert.match(
      resources.querySelector('[data-cached-resource]').textContent,
      /synthetic-inventory-25/
    )
    const unit = document.querySelector('#roster-feature details')
    open(window, unit)
    const abilities = [...unit.querySelectorAll('section')].find(
        (section) => section.querySelector('h4')?.textContent === 'Abilities'
      ),
      equipment = [...unit.querySelectorAll('section')].find(
        (section) => section.querySelector('h4')?.textContent === 'Equipment'
      ),
      upgrades = [...unit.querySelectorAll('section')].find(
        (section) =>
          section.querySelector('h4')?.textContent === 'Upgrade entries'
      )
    for (const section of [abilities, equipment, upgrades]) {
      assert.equal(section.querySelectorAll('dl').length, 25)
      scopedButton(section, 'Next').click()
      assert.equal(section.querySelectorAll('dl').length, 25)
      assert.match(
        section.querySelector('[role="status"]').textContent,
        /26–50 of 70/
      )
    }
    const campaign = document.querySelector('#progress-feature details')
    open(window, campaign)
    assert.equal(campaign.querySelectorAll('dl').length, 26)
    scopedButton(campaign, 'Next').click()
    assert.match(
      campaign.querySelector('[role="status"]').textContent,
      /26–50 of 75/
    )
    assert.equal(campaign.querySelectorAll('dl').length, 26)
  } finally {
    await window.happyDOM.close()
  }
})

test('complete projected cache remains readable after native access disconnect and actual file reopen without key material', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'synthetic cached features ')),
    key = 'SYNTHETIC-FEATURE-KEY-CANARY',
    path = join(directory, 'personal.json'),
    window = dom()
  let upstreamCalls = 0,
    vaultCalls = 0
  try {
    const state = privateState(path),
      player = fixture(),
      onboarding = new WorkspaceOnboardingV1({
        now: () => 1767225600000,
        state,
        vault: {
          promptAndStoreOfficialRead: async () => {
            vaultCalls += 1
            return 'synthetic-native-handle'
          },
          withOfficialRead: async (_handle, action) => {
            vaultCalls += 1
            return action(key)
          },
          remove: async () => {}
        },
        upstream: {
          get: async () => {
            upstreamCalls += 1
            return {
              metaData: { scopes: ['Player'], lastUpdatedOn: 1767225600 },
              player
            }
          }
        }
      })
    player.apiKey = key
    player.units[0].authorization = key
    await onboarding.connect({
      requested: ['Player'],
      confirmPlayer: async () => true
    })
    const expected = playerSummary(onboarding.view().personal.apiData)
    await onboarding.disconnect('Player')
    const reopened = new WorkspaceOnboardingV1({
        state: privateState(path),
        upstream: {
          get: () => {
            throw new Error('Disconnected upstream must not be called')
          }
        },
        vault: {
          withOfficialRead: () => {
            throw new Error('Disconnected vault must not be called')
          }
        }
      }),
      view = reopened.view()
    assert.equal(view.capabilities.Player, 'disconnected-offline-readable')
    assert.equal(view.freshness.offlineReadable, true)
    assert.deepEqual(playerSummary(view.personal.apiData), expected)
    mountCachedPlayerFeatures(window.document).update(view.personal.apiData)
    assert.match(
      window.document.querySelector('#roster-feature').textContent,
      /Synthetic Alpha/
    )
    for (const bytes of [
      JSON.stringify(view),
      await readFile(path, 'utf8'),
      window.document.body.textContent
    ])
      for (const canary of [
        key,
        Buffer.from(key).toString('base64'),
        Buffer.from(key).toString('hex'),
        encodeURIComponent(key)
      ])
        assert.equal(bytes.includes(canary), false)
    assert.equal(
      window.document.body.textContent.includes('synthetic-native-handle'),
      false
    )
    assert.equal(upstreamCalls, 1)
    assert.equal(vaultCalls, 2)
  } finally {
    await window.happyDOM.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('personal page fetches only its local cached endpoint and retains all snapshot fields', async () => {
  const window = dom(),
    source = await readFile(
      new URL(
        '../../../apps/desktop/platform/macos/personal.js',
        import.meta.url
      ),
      'utf8'
    ),
    calls = [],
    input = projected(),
    view = {
      personal: input,
      requestedCapabilities: ['Player', 'Guild', 'Guild Raid'],
      capabilities: { Player: 'disconnected' },
      freshness: { syncedAt: input.upstreamUpdatedAt },
      limitation: 'Synthetic native qualification remains open'
    }
  try {
    runInNewContext(source.replace(/^import[^\n]+\n/, ''), {
      document: window.document,
      window,
      mountCachedPlayerFeatures,
      fetch: async (path, options) => {
        calls.push({ path, options })
        return { ok: true, status: 200, json: async () => view }
      }
    })
    await new Promise((accept) => setImmediate(accept))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].path, '/api/desktop/personal')
    assert.equal(calls[0].options.cache, 'no-store')
    const snapshot = window.document.querySelector('#snapshot')
    assert.deepEqual(
      [...snapshot.querySelectorAll(':scope > details > summary')].map(
        (entry) => entry.textContent
      ),
      ['details', 'units', 'inventory', 'progress']
    )
    assert.match(
      window.document.querySelector('#roster-feature').textContent,
      /Synthetic Alpha/
    )
    assert.match(
      window.document.querySelector('#status').textContent,
      /cached personal data/
    )
    const script = window.document.querySelector(
      'script[src="/desktop/personal.js"]'
    )
    assert.equal(script.type, 'module')
  } finally {
    await window.happyDOM.close()
  }
})
