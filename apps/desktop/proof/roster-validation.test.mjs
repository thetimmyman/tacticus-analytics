import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { projectOfficialRoster } from '../launcher/roster-validation.mjs'

import { syntheticRosterUnit } from './synthetic-roster.mjs'

const player = () => ({
  details: { name: 'Synthetic Roster', powerLevel: 1000 },
  units: [syntheticRosterUnit()]
})

test('published roster fields survive while unrelated upstream data is dropped', () => {
  const input = player()
  input.inventory = { arbitrary: 'unused' }
  input.progress = { arbitrary: 'unused' }
  input.userId = 'synthetic-unverified-identity'
  input.units[0].url = 'https://example.invalid/untrusted'
  const result = projectOfficialRoster(input)
  assert.deepEqual(result, {
    playerName: 'Synthetic Roster',
    powerLevel: 1000,
    units: [syntheticRosterUnit()],
    machinesOfWar: []
  })
  assert.equal(result.units[0].name, '<img src=x onerror=alert(1)>')
  assert(!JSON.stringify(result).includes('unused'))
  assert(!JSON.stringify(result).includes('example.invalid'))
})

test('malformed later unit refuses the complete projection', () => {
  const input = player()
  input.units.push({
    ...syntheticRosterUnit(),
    id: 'syntheticSecond',
    rank: 24
  })
  assert.throws(
    () => projectOfficialRoster(input),
    /Existing roster was preserved/
  )
})

test('numeric contract bounds, types, array sizes and duplicate keys are enforced', () => {
  for (const patch of [
    { progressionIndex: 20 },
    { progressionIndex: -1 },
    { rank: '15' },
    { xp: 2147483648 },
    { xp: -1 },
    { xpLevel: 0 },
    { xpLevel: 32768 },
    { shards: 0.5 },
    { mythicShards: -1 },
    { id: 'https://example.invalid' },
    { abilities: [{ id: 'syntheticActive', level: 32768 }] },
    {
      abilities: [
        { id: 'same', level: 1 },
        { id: 'same', level: 2 }
      ]
    },
    { items: [{ id: 'syntheticItem', slotId: 'Slot1', level: 32768 }] },
    { items: [{ id: 'syntheticItem', slotId: 'Slot4', level: 1 }] },
    {
      items: [
        { id: 'syntheticItem', slotId: 'Slot1', level: 1 },
        { id: 'syntheticItem2', slotId: 'Slot1', level: 2 }
      ]
    },
    { upgrades: [0, 0] },
    { upgrades: [6] },
    { upgrades: Array(7).fill(0) },
    { grandAlliance: 'unsupported' },
    { name: 'x'.repeat(129) },
    { faction: 'x\u0000y' }
  ]) {
    const input = player()
    Object.assign(input.units[0], patch)
    assert.throws(() => projectOfficialRoster(input))
  }
  const duplicate = player()
  duplicate.units.push(syntheticRosterUnit())
  assert.throws(() => projectOfficialRoster(duplicate))
  assert.throws(() =>
    projectOfficialRoster({
      ...player(),
      units: Array(1025).fill(syntheticRosterUnit())
    })
  )
})

test('empty rosters are valid; ambiguous machine lists and invalid details are refused', () => {
  assert.deepEqual(projectOfficialRoster({ ...player(), units: [] }).units, [])
  for (const alias of [
    'machinesOfWar',
    'machines_of_war',
    'machineOfWar',
    'machine_of_war'
  ]) {
    const input = player()
    input[alias] = [{ ...syntheticRosterUnit(), id: 'syntheticMow' }]
    assert.equal(
      projectOfficialRoster(input).machinesOfWar[0].id,
      'syntheticMow'
    )
  }
  assert.throws(() =>
    projectOfficialRoster({ ...player(), machinesOfWar: [], machineOfWar: [] })
  )
  assert.throws(() =>
    projectOfficialRoster({
      ...player(),
      details: { name: 'Synthetic', powerLevel: -1 }
    })
  )
  assert.throws(() =>
    projectOfficialRoster({ ...player(), details: { name: '', powerLevel: 1 } })
  )
})

test('Mythic progression, later ranks and levels, and a third machine ability survive snapshot projection', () => {
  const input = player()
  Object.assign(input.units[0], { progressionIndex: 19, rank: 23, xpLevel: 55 })
  input.units[0].abilities[0].level = 55
  input.units[0].items[0].level = 12
  input.machinesOfWar = [
    {
      ...syntheticRosterUnit(),
      id: 'syntheticMow',
      abilities: [
        { id: 'syntheticActive', level: 55 },
        { id: 'syntheticPassive', level: 50 },
        { id: 'syntheticThird', level: 1 }
      ]
    }
  ]
  const projected = projectOfficialRoster(input)
  assert.equal(projected.units[0].progressionIndex, 19)
  assert.equal(projected.units[0].rank, 23)
  assert.equal(projected.units[0].xpLevel, 55)
  assert.equal(projected.machinesOfWar[0].abilities.length, 3)
})
